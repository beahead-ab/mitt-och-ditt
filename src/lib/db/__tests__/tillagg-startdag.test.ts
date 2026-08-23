import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { databaseAvailable, ownerSql } from "./helpers";

/**
 * Tilläggsavtalet och avtalets startdag, hela vägen genom databasen.
 *
 * Den rena sammanslagningen prövas i lib/__tests__/tillaggsavtal.test.ts. Här
 * prövas att serverkoden faktiskt använder den: att raden som skrivs bär
 * bostadsköpets ursprungliga startdag, att bara det tillägget anger ändras,
 * och att ett tillägg som säger en sak och gör en annan avvisas.
 *
 * Provet hade fallit före rättningen. Då sattes den nya avtalsversionens
 * start_date till tilläggets giltighetsdag, och eftersom motorn utesluter
 * poster som betalats före startdagen föll hela historiken ur beräkningen.
 */
const DB = "mittochditt_tillagg_startdag_test";

let owner: postgres.Sql;
let admin: postgres.Sql;

const ids = { caesar: "", felicia: "", household: "", agreement: "", attachment: "" };
const START = "2026-01-15";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

let tillagg: typeof import("../tillagg.server");
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
  const [h] = await owner`
    insert into households (name, party_a, party_b)
    values ('Caesar & Felicia', 'caesar', 'felicia') returning id`;
  ids.caesar = c.id;
  ids.felicia = f.id;
  ids.household = h.id;

  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.household}, ${ids.caesar}, 'caesar', 'Caesar'),
           (${ids.household}, ${ids.felicia}, 'felicia', 'Felicia')`;

  const [ag] = await owner`
    insert into agreements (household_id) values (${ids.household}) returning id`;
  ids.agreement = ag.id;

  // En gällande avtalsversion att bygga tillägget på.
  await owner`
    insert into agreement_versions
      (agreement_id, version, start_date, start_value_ore, initial_loan_ore, total_units,
       start_units, formal_ownership, created_by, effective_at, checksum)
    values (${ids.agreement}, 1, ${START}, 450000000, 300000000, 1500000,
            '{"caesar":900000,"felicia":600000}'::jsonb,
            '{"caesar":0.5,"felicia":0.5}'::jsonb,
            ${ids.caesar}, now(), 'summa-v1')`;

  const [bilaga] = await owner`
    insert into attachments
      (household_id, filename, content_type, storage_key, byte_size, sha256, uploaded_by)
    values (${ids.household}, 'tillagg.pdf', 'application/pdf', 'a/b', 2048,
            ${"d".repeat(64)}, ${ids.caesar})
    returning id`;
  ids.attachment = bilaga.id;

  process.env.DATABASE_URL = ownerUrl(DB);
  tillagg = await import("../tillagg.server");
  stangKopplingar = (await import("../client.server")).closeConnections;
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await stangKopplingar?.();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

/** Grunduppgifter för ett tillägg, med giltighetsdag långt efter startdagen. */
function indata(extra: Partial<Parameters<typeof tillagg.registreraTillagg>[1]> = {}) {
  return {
    householdId: ids.household,
    title: "Tillägg om lånet",
    signedOn: "2026-06-01",
    appliesFrom: "2026-06-01",
    summary: "Parterna har amorterat extra och justerar det ursprungliga lånet.",
    affected: ["punkt 12"],
    attachmentId: ids.attachment,
    ...extra,
  };
}

describeDb("Startdagen efter ett tillägg", () => {
  it("är bostadsköpets, inte tilläggets giltighetsdag", async () => {
    const svar = await tillagg.registreraTillagg(
      ids.caesar,
      indata({
        initialLoanOre: "250000000",
        andrarFalt: ["initialLoanOre"],
      }),
    );

    const [ny] = await owner<{ start_date: string; initial_loan_ore: string }[]>`
      select start_date::text, initial_loan_ore from agreement_versions
       where id = ${svar.versionId}`;

    // Kärnan i provet: giltighetsdagen är 2026-06-01, startdagen ska vara kvar.
    expect(String(ny.start_date).slice(0, 10)).toBe(START);
    expect(String(ny.initial_loan_ore)).toBe("250000000");
  });

  it("ändras bara när tillägget uttryckligen anger en ny", async () => {
    const svar = await tillagg.registreraTillagg(
      ids.caesar,
      indata({
        title: "Rättelse av tillträdesdagen",
        startDate: "2026-02-01",
        andrarFalt: ["startDate"],
      }),
    );

    const [ny] = await owner<{ start_date: string }[]>`
      select start_date::text from agreement_versions where id = ${svar.versionId}`;
    expect(String(ny.start_date).slice(0, 10)).toBe("2026-02-01");
  });
});

describeDb("Bara det tillägget anger får ändras", () => {
  it("lämnar övriga uppgifter orörda", async () => {
    const [fore] = await owner`
      select start_value_ore, total_units, start_units, formal_ownership
        from agreement_versions where agreement_id = ${ids.agreement} and version = 1`;

    const svar = await tillagg.registreraTillagg(
      ids.caesar,
      indata({
        title: "Nytt startvärde",
        startValueOre: "500000000",
        andrarFalt: ["startValueOre"],
      }),
    );

    const [efter] = await owner`
      select start_value_ore, total_units, start_units, formal_ownership, changed_fields
        from agreement_versions v join agreement_addenda t on t.id = v.addendum_id
       where v.id = ${svar.versionId}`;

    expect(String(efter.start_value_ore)).toBe("500000000");
    expect(String(efter.total_units)).toBe(String(fore.total_units));
    expect(efter.start_units).toEqual(fore.start_units);
    expect(efter.formal_ownership).toEqual(fore.formal_ownership);
    expect(efter.changed_fields).toEqual(["startValueOre"]);
  });

  it("skriver före och efter i revisionsloggen", async () => {
    const svar = await tillagg.registreraTillagg(
      ids.caesar,
      indata({
        title: "Justerade andelsenheter",
        startUnits: { caesar: 950000, felicia: 550000 },
        andrarFalt: ["startUnits"],
      }),
    );
    expect(svar.versionId).toBeTruthy();

    const [handelse] = await owner`
      select new_value from audit_events
       where household_id = ${ids.household} and event_type = 'addendum.created'
       order by sequence desc limit 1`;

    // En revisionshändelse som bara säger att något ändrats går inte att granska.
    expect(handelse.new_value.andrade).toEqual(["startUnits"]);
    expect(handelse.new_value.fore.startUnits).toEqual({ caesar: 900000, felicia: 600000 });
    expect(handelse.new_value.efter.startUnits).toEqual({ caesar: 950000, felicia: 550000 });
  });
});

describeDb("Sammanfattningen måste stämma med värdena", () => {
  it("avvisar ett tillägg som påstår en ändring utan att göra den", async () => {
    await expect(
      tillagg.registreraTillagg(ids.caesar, indata({ andrarFalt: ["startValueOre"] })),
    ).rejects.toThrow(/detsamma som i gällande avtal/);
  });

  it("avvisar ett tillägg som ändrar mer än det säger", async () => {
    await expect(
      tillagg.registreraTillagg(
        ids.caesar,
        // Startvärdet ändras utan att anges. Ett ändrat totalantal hade
        // avvisats redan av summakontrollen, och då mätt fel sak.
        indata({
          initialLoanOre: "240000000",
          startValueOre: "460000000",
          andrarFalt: ["initialLoanOre"],
        }),
      ),
    ).rejects.toThrow(/utan att säga det/);
  });

  it("skriver ingenting alls när tillägget avvisas", async () => {
    const [fore] = await owner`select count(*)::int as antal from agreement_addenda`;
    await expect(
      tillagg.registreraTillagg(ids.caesar, indata({ andrarFalt: ["totalUnits"] })),
    ).rejects.toThrow();
    const [efter] = await owner`select count(*)::int as antal from agreement_addenda`;
    expect(efter.antal).toBe(fore.antal);
  });
});

describeDb("Hushållsgränsen", () => {
  it("går inte att knyta en bilaga från ett annat hushåll", async () => {
    const [annat] = await owner`
      insert into households (name, party_a, party_b)
      values ('Annat', 'a', 'b') returning id`;
    const [främmande] = await owner`
      insert into attachments
        (household_id, filename, content_type, storage_key, byte_size, sha256, uploaded_by)
      values (${annat.id}, 'annan.pdf', 'application/pdf', 'x/y', 10, ${"e".repeat(64)},
              ${ids.caesar})
      returning id`;

    await expect(
      tillagg.registreraTillagg(ids.caesar, indata({ attachmentId: främmande.id })),
    ).rejects.toThrow(/hör inte till hushållet/);
  });
});
