import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { newEncryptionKey } from "../../mail/crypto";
import { databaseAvailable, ownerSql } from "./helpers";

/**
 * Kritiskt svep över koden från förmiddagen.
 *
 * Proven här kom till av att gå igenom de nya committarna som om de skrivits
 * av någon annan. Varje block motsvarar ett fynd eller en fråga som inte gick
 * att svara på utan att pröva.
 */
const DB = "mittochditt_granskning_test";

let owner: postgres.Sql;
let admin: postgres.Sql;

const ids = { nora: "", idris: "", household: "", agreement: "", attachment: "" };
const START = "2026-01-15";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

let tillagg: typeof import("../tillagg.server");
let handelser: typeof import("../../mail/handelser.server");
let svep: typeof import("../../mail/svep.server");
let stangKopplingar: () => Promise<void>;

function ownerUrl(database: string): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const parsed = new URL(url);
    parsed.pathname = `/${database}`;
    return parsed.toString();
  }
  const host = process.env.TEST_PGHOST ?? "/tmp";
  const port = process.env.TEST_PGPORT ?? "5433";
  const user = process.env.TEST_PGUSER ?? "postgres";
  return `postgres://${user}@localhost/${database}?host=${encodeURIComponent(host)}&port=${port}`;
}

beforeAll(async () => {
  if (!available) return;
  admin = ownerSql("postgres");
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin`create database ${admin.unsafe(DB)}`;
  owner = ownerSql(DB);

  const files = (await readdir("db/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await owner.unsafe(await readFile(path.join("db/migrations", file), "utf8"));
  }

  const [n] = await owner`insert into users (email, name) values ('n@x.se', 'Nora') returning id`;
  const [i] = await owner`insert into users (email, name) values ('i@x.se', 'Idris') returning id`;
  const [h] = await owner`
    insert into households (name, party_a, party_b) values ('Nora & Idris', 'a', 'b') returning id`;
  ids.nora = n.id;
  ids.idris = i.id;
  ids.household = h.id;

  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.household}, ${ids.nora}, 'a', 'Nora'),
           (${ids.household}, ${ids.idris}, 'b', 'Idris')`;

  const [ag] = await owner`
    insert into agreements (household_id) values (${ids.household}) returning id`;
  ids.agreement = ag.id;
  await owner`
    insert into agreement_versions
      (agreement_id, version, start_date, start_value_ore, initial_loan_ore, total_units,
       start_units, formal_ownership, created_by, effective_at, checksum)
    values (${ids.agreement}, 1, ${START}, 450000000, 300000000, 1500000,
            '{"a":900000,"b":600000}'::jsonb, '{"a":0.5,"b":0.5}'::jsonb,
            ${ids.nora}, now(), 'summa-v1')`;

  const [b] = await owner`
    insert into attachments
      (household_id, filename, content_type, storage_key, byte_size, sha256, uploaded_by)
    values (${ids.household}, 't.pdf', 'application/pdf', 'a/b', 10, ${"f".repeat(64)}, ${ids.nora})
    returning id`;
  ids.attachment = b.id;

  process.env.MAIL_QUEUE_ENCRYPTION_KEY = newEncryptionKey();
  process.env.DATABASE_URL = ownerUrl(DB);
  process.env.APP_URL = "https://x.se";
  tillagg = await import("../tillagg.server");
  handelser = await import("../../mail/handelser.server");
  svep = await import("../../mail/svep.server");
  stangKopplingar = (await import("../client.server")).closeConnections;
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await stangKopplingar?.();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

function indata(extra: Record<string, unknown> = {}) {
  return {
    householdId: ids.household,
    title: "Tillägg",
    signedOn: "2026-06-01",
    appliesFrom: "2026-06-01",
    summary: "Sammanfattning.",
    affected: ["punkt 12"],
    attachmentId: ids.attachment,
    ...extra,
  } as Parameters<typeof tillagg.registreraTillagg>[1];
}

/** Sätter senaste versionen i kraft, som godkännandemaskinen gör. */
async function satIKraft(versionId: string) {
  await owner`update agreement_versions set effective_at = now() where id = ${versionId}`;
}

describeDb("Flera tillägg efter varandra", () => {
  it("bygger en kedja där varje version utgår från den föregående gällande", async () => {
    const ett = await tillagg.registreraTillagg(
      ids.nora,
      indata({ title: "Ett", initialLoanOre: "250000000", andrarFalt: ["initialLoanOre"] }),
    );
    await satIKraft(ett.versionId);

    const tva = await tillagg.registreraTillagg(
      ids.nora,
      indata({ title: "Två", startValueOre: "500000000", andrarFalt: ["startValueOre"] }),
    );
    await satIKraft(tva.versionId);

    const tre = await tillagg.registreraTillagg(
      ids.nora,
      indata({
        title: "Tre",
        startUnits: { a: 1000000, b: 800000 },
        totalUnits: "1800000",
        andrarFalt: ["startUnits", "totalUnits"],
      }),
    );

    const rader = (await owner`
      select version, start_date::text, start_value_ore, initial_loan_ore, total_units
        from agreement_versions where agreement_id = ${ids.agreement} order by version`) as {
      version: number;
      start_date: string;
      start_value_ore: string;
      initial_loan_ore: string;
      total_units: string;
    }[];

    // Fyra versioner, i nummerordning utan hål.
    expect(rader.map((r) => Number(r.version))).toEqual([1, 2, 3, 4]);

    // Startdagen står still genom hela kedjan.
    expect(new Set(rader.map((r) => r.start_date))).toEqual(new Set([START]));

    // Varje tillägg ärver det föregående. Det tredje ändrar bara enheterna, så
    // lån och startvärde ska vara det andra tilläggets.
    const sista = rader[3];
    expect(String(sista.initial_loan_ore)).toBe("250000000");
    expect(String(sista.start_value_ore)).toBe("500000000");
    expect(Number(sista.total_units)).toBe(1800000);
    expect(tre.version).toBe(4);
  });

  it("före/efter pekar på den närmast föregående versionen, inte på den första", async () => {
    const rader = (await owner`
      select t.title, t.changed_fields,
             fore.version as fore_version, v.version as efter_version,
             fore.start_value_ore as fore_varde, v.start_value_ore as efter_varde
        from agreement_addenda t
        join agreement_versions v on v.addendum_id = t.id
        left join lateral (
          select * from agreement_versions tidigare
           where tidigare.agreement_id = t.agreement_id and tidigare.version < v.version
           order by tidigare.version desc limit 1
        ) fore on true
       where t.title = 'Tre'`) as {
      fore_version: number;
      efter_version: number;
      fore_varde: string;
      efter_varde: string;
    }[];

    const rad = rader[0];
    expect(Number(rad.efter_version) - Number(rad.fore_version)).toBe(1);
    // Det tredje tillägget ändrar inte startvärdet, så före och efter är lika.
    expect(String(rad.fore_varde)).toBe(String(rad.efter_varde));
    expect(String(rad.fore_varde)).toBe("500000000");
  });
});

describeDb("Dödsfall stör inte vanliga försäljnings- och utköpsflöden", () => {
  beforeEach(async () => {
    if (!available) return;
    await owner`delete from mail_messages`;
    await owner`delete from exit_processes where household_id = ${ids.household}`;
  });

  it("en utköpsprocess får inga dödsfallsfrister", async () => {
    await owner`
      insert into exit_processes (household_id, process_date, kind, started_by)
      values (${ids.household}, '2026-09-01', 'utkop', ${ids.nora})`;

    // 2026-09-01 är fjortondagarspunkten för beskedet om övertagande.
    await svep.svepFrister(new Date("2026-09-01T09:00:00Z"));
    const rader = (await owner`
      select idempotency_key from mail_messages`) as { idempotency_key: string }[];

    expect(rader.length).toBeGreaterThan(0);
    // Inga nycklar för meddelande- eller finansieringsfristen, som hör till
    // dödsfall.
    expect(rader.some((r) => r.idempotency_key.includes(":meddelande:"))).toBe(false);
    expect(rader.some((r) => r.idempotency_key.includes(":finansiering:"))).toBe(false);
  });

  it("en dödsfallsprocess får både de vanliga och sina egna frister", async () => {
    const [p] = await owner`
      insert into exit_processes
        (household_id, process_date, kind, started_by, estate_inventory_on)
      values (${ids.household}, '2026-09-01', 'dodsfall', ${ids.nora}, '2026-09-01')
      returning id`;
    expect(p.id).toBeTruthy();

    // Bouppteckningen 2026-09-01 ger meddelandefristen 2026-10-01, vars
    // fjortondagarspunkt är 2026-09-17.
    await svep.svepFrister(new Date("2026-09-17T09:00:00Z"));
    const rader = (await owner`
      select idempotency_key from mail_messages`) as { idempotency_key: string }[];
    expect(rader.some((r) => r.idempotency_key.includes(":meddelande:"))).toBe(true);
  });
});

describeDb("Beskedet till inbjudaren", () => {
  beforeEach(async () => {
    if (!available) return;
    await owner`delete from mail_messages`;
  });

  it("skickas på nytt när någon bjuds in igen efter en återkallad inbjudan", async () => {
    // Nyckeln bar tidigare bara hushållet och inbjudaren, så det andra
    // beskedet tystnade.
    await handelser.notifieraMotpartAccepterade({
      householdId: ids.household,
      inviteId: "inbjudan-1",
      inbjudarensUserId: ids.nora,
      motpartensNamn: "Idris",
    });
    await handelser.notifieraMotpartAccepterade({
      householdId: ids.household,
      inviteId: "inbjudan-2",
      inbjudarensUserId: ids.nora,
      motpartensNamn: "Idris",
    });

    const rader = await owner`
      select id from mail_messages where template = 'motpart_accepterade'`;
    expect(rader).toHaveLength(2);
  });

  it("men samma inbjudan ger bara ett", async () => {
    for (let i = 0; i < 3; i += 1) {
      await handelser.notifieraMotpartAccepterade({
        householdId: ids.household,
        inviteId: "inbjudan-1",
        inbjudarensUserId: ids.nora,
        motpartensNamn: "Idris",
      });
    }
    const rader = await owner`
      select id from mail_messages where template = 'motpart_accepterade'`;
    expect(rader).toHaveLength(1);
  });
});

describeDb("Inbjudningsspärren låser inte ute den inbjudne", () => {
  it("en giltig länk nollställer räknaren", async () => {
    const throttle = await import("../../auth/throttle.server");
    await owner`delete from auth_throttle`;
    const ip = "203.0.113.44";

    // Nio försök: strax under taket på tio.
    for (let i = 0; i < 9; i += 1) await throttle.räknaFörsök("invite", { ip });

    // Så nollställs räknaren, som när ett giltigt uppslag lyckats.
    await throttle.nollställ("invite", { ip });

    // Den inbjudne kan därefter ladda om sidan utan att spärras.
    for (let i = 0; i < 9; i += 1) {
      expect((await throttle.räknaFörsök("invite", { ip })).tillåtet).toBe(true);
    }
  });

  it("men gissning utan giltig länk spärras fortfarande", async () => {
    const throttle = await import("../../auth/throttle.server");
    await owner`delete from auth_throttle`;
    const ip = "203.0.113.45";
    let spärrad = false;
    for (let i = 0; i < 15 && !spärrad; i += 1) {
      spärrad = !(await throttle.räknaFörsök("invite", { ip })).tillåtet;
    }
    expect(spärrad).toBe(true);
  });
});
