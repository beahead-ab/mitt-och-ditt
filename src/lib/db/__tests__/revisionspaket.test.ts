import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { unzipSync } from "fflate";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { byggRevisionszip } from "../../export/revisionszip";
import { databaseAvailable, ownerSql } from "./helpers";

/**
 * Revisionspaketet.
 *
 * Två saker prövas som inte går att pröva var för sig: att paketets
 * checksummor stämmer med filerna som faktiskt hamnar i zipen, och att inget
 * paket alls byggs när hashkedjan är bruten.
 */
const DB = "mittochditt_paket_test";

let owner: postgres.Sql;
let admin: postgres.Sql;

const ids = { caesar: "", felicia: "", household: "", agreement: "" };

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

let paket: typeof import("../../revisionspaket.server");
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

  const [c] = await owner`insert into users (email, name) values ('c@x.se', 'Caesar') returning id`;
  const [f] =
    await owner`insert into users (email, name) values ('f@x.se', 'Felicia') returning id`;
  const [h] = await owner`insert into households (name) values ('Caesar & Felicia') returning id`;
  ids.caesar = c.id;
  ids.felicia = f.id;
  ids.household = h.id;

  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.household}, ${ids.caesar}, 'caesar', 'Caesar'),
           (${ids.household}, ${ids.felicia}, 'felicia', 'Felicia')`;

  const [ag] = await owner`
    insert into agreements (household_id) values (${ids.household}) returning id`;
  ids.agreement = ag.id;

  await owner`
    insert into agreement_versions
      (agreement_id, version, start_date, start_value_ore, initial_loan_ore, total_units,
       start_units, created_by, effective_at, checksum)
    values (${ids.agreement}, 1, '2026-01-01', 500000000, 300000000, 2000000,
            '{"caesar":1200000,"felicia":800000}', ${ids.caesar}, now(), 'summa-v1')`;

  const [tx] = await owner`
    insert into transactions (household_id, reference, created_by)
    values (${ids.household}, 'T-0001', ${ids.caesar}) returning id`;
  await owner`
    insert into transaction_versions
      (transaction_id, version, status, payment_date, category, payments, description,
       created_by, effective_at)
    values (${tx.id}, 1, 'approved', '2026-02-01', 'Reparation',
            '{"caesar": {"gross": 5000000}}'::jsonb, 'Byte av "kranen"; med tecken',
            ${ids.caesar}, now())`;

  await owner`
    insert into attachments
      (household_id, transaction_id, filename, content_type, storage_key, byte_size, sha256,
       uploaded_by)
    values (${ids.household}, ${tx.id}, 'kvitto.pdf', 'application/pdf', 'a/b', 2048,
            ${"c".repeat(64)}, ${ids.caesar})`;

  await owner`
    insert into audit_events (household_id, event_type, entity_type, actor_id)
    values (${ids.household}, 'transaction.approved', 'transaction', ${ids.caesar}),
           (${ids.household}, 'attachment.uploaded', 'attachment', ${ids.caesar})`;

  process.env.DATABASE_URL = ownerUrl(DB);
  paket = await import("../../revisionspaket.server");
  stangKopplingar = (await import("../client.server")).closeConnections;
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await stangKopplingar?.();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

describeDb("Revisionspaketet", () => {
  it("innehåller alla delar av underlaget", async () => {
    const svar = await paket.byggRevisionspaket(ids.caesar, ids.household);
    expect(svar.ok).toBe(true);
    if (!svar.ok) return;

    const namn = svar.filer.map((f) => f.namn);
    expect(namn).toContain("00-INNEHALL.md");
    expect(namn).toContain("02-avtalsversioner.csv");
    expect(namn).toContain("03-tillaggsavtal.csv");
    expect(namn).toContain("04-transaktioner.csv");
    expect(namn).toContain("05-bilagor.csv");
    expect(namn).toContain("06-aktivitetslogg.csv");
  });

  it("checksummorna stämmer med filernas innehåll", async () => {
    const svar = await paket.byggRevisionspaket(ids.caesar, ids.household);
    if (!svar.ok) throw new Error(svar.skal);

    for (const fil of svar.filer) {
      const raknad = createHash("sha256").update(fil.innehall, "utf8").digest("hex");
      expect(raknad, `${fil.namn} har fel checksumma`).toBe(fil.sha256);
    }
  });

  it("innehållsförteckningen listar varje fil med rätt summa", async () => {
    const svar = await paket.byggRevisionspaket(ids.caesar, ids.household);
    if (!svar.ok) throw new Error(svar.skal);

    const innehall = svar.filer.find((f) => f.namn === "00-INNEHALL.md")!.innehall;
    for (const fil of svar.filer.filter((f) => f.namn !== "00-INNEHALL.md")) {
      expect(innehall).toContain(fil.namn);
      expect(innehall).toContain(fil.sha256);
    }
  });

  it("överlever vägen genom zipen med oförändrat innehåll", async () => {
    const svar = await paket.byggRevisionspaket(ids.caesar, ids.household);
    if (!svar.ok) throw new Error(svar.skal);

    const blob = byggRevisionszip(svar.filer);
    const packad = new Uint8Array(await blob.arrayBuffer());
    const uppackat = unzipSync(packad);

    expect(Object.keys(uppackat).sort()).toEqual(svar.filer.map((f) => f.namn).sort());

    for (const fil of svar.filer) {
      // TextDecoder tar bort en inledande byte order mark som standard, och
      // just den byten är vad som får svenska Excel att öppna filen rätt. Här
      // måste den behållas, annars jämförs något annat än det man får ut.
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(uppackat[fil.namn]);
      expect(text, `${fil.namn} ändrades i zipen`).toBe(fil.innehall);
      // Summan i förteckningen ska gälla filen man faktiskt får ut.
      expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(fil.sha256);
    }

    // Och byten själva: CSV-filerna ska börja med EF BB BF.
    for (const namn of Object.keys(uppackat).filter((n) => n.endsWith(".csv"))) {
      expect([...uppackat[namn].slice(0, 3)], `${namn} saknar byte order mark`).toEqual([
        0xef, 0xbb, 0xbf,
      ]);
    }
  });

  it("csv:n öppnas i svenska Excel och citerar fält med semikolon", async () => {
    const svar = await paket.byggRevisionspaket(ids.caesar, ids.household);
    if (!svar.ok) throw new Error(svar.skal);

    const poster = svar.filer.find((f) => f.namn === "04-transaktioner.csv")!.innehall;
    expect(poster.charCodeAt(0)).toBe(0xfeff); // byte order mark
    expect(poster).toContain(";");
    // Beskrivningen innehåller både semikolon och citattecken.
    expect(poster).toContain('"Byte av ""kranen""; med tecken"');
    // Belopp med decimalkomma.
    expect(poster).toContain("50000,00");
  });

  it("nämner att bilagornas filer inte följer med", async () => {
    const svar = await paket.byggRevisionspaket(ids.caesar, ids.household);
    if (!svar.ok) throw new Error(svar.skal);
    const innehall = svar.filer.find((f) => f.namn === "00-INNEHALL.md")!.innehall;
    expect(innehall).toMatch(/följer inte med/);
  });

  it("bygger inget paket alls när hashkedjan är bruten", async () => {
    // Loggen går inte att ändra genom applikationen, så kedjan bryts här genom
    // att skriva om en hash direkt som ägare - just det en manipulation skulle
    // försöka göra.
    await owner`alter table audit_events disable trigger user`;
    await owner`update audit_events set hash = ${"0".repeat(64)}
                 where household_id = ${ids.household}
                   and sequence = (select min(sequence) from audit_events
                                    where household_id = ${ids.household})`;
    await owner`alter table audit_events enable trigger user`;

    const svar = await paket.byggRevisionspaket(ids.caesar, ids.household);
    expect(svar.ok).toBe(false);
    if (svar.ok) return;
    expect(svar.skal).toMatch(/kedja är bruten/);
    expect(Number(svar.brutenVidSekvens)).toBeGreaterThan(0);
  });
});
