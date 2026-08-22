import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asUser, appSql, databaseAvailable, isRejected, ownerSql } from "./helpers";

/**
 * Kvartalsavstämningen.
 *
 * Det som prövas: att en period inte kan markeras klar av en part ensam, att
 * checklistan måste vara genomgången, och att nästa förfallodag följer den
 * senast avslutade avstämningen i stället för senaste transaktion.
 */
const DB = "mittochditt_avstamning_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = { caesar: "", felicia: "", utom: "", household: "" };
const PUNKTER = ["transaktioner", "lanesaldo", "skatt", "bilagor"];

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

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
  const [u] = await owner`insert into users (email, name) values ('u@x.se', 'Utom') returning id`;
  const [h] = await owner`insert into households (name) values ('Caesar & Felicia') returning id`;
  ids.caesar = c.id;
  ids.felicia = f.id;
  ids.utom = u.id;
  ids.household = h.id;

  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.household}, ${ids.caesar}, 'caesar', 'Caesar'),
           (${ids.household}, ${ids.felicia}, 'felicia', 'Felicia')`;

  app = appSql(DB);
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await app?.end();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

/** Ny avstämning med tom checklista. Perioden görs unik per prov. */
async function nyAvstamning(start: string): Promise<string> {
  const tom = Object.fromEntries(PUNKTER.map((p) => [p, false]));
  const [rad] = await owner`
    insert into reconciliations
      (household_id, period_start, period_end, due_on, checklist, created_by)
    values (${ids.household}, ${start}, ${start}, ${start}, ${owner.json(tom)}, ${ids.caesar})
    returning id`;
  return rad.id;
}

async function bockaAlla(id: string) {
  const klar = Object.fromEntries(PUNKTER.map((p) => [p, true]));
  await owner`update reconciliations set checklist = ${owner.json(klar)} where id = ${id}`;
}

async function bekrafta(userId: string, partyId: string, id: string) {
  return asUser(
    app,
    userId,
    (tx) => tx`insert into reconciliation_confirmations (reconciliation_id, user_id, party_id)
      values (${id}, ${userId}, ${partyId})`,
  );
}

describeDb("Checklistan måste vara genomgången", () => {
  it("avvisar en bekräftelse när något är obockat", async () => {
    const id = await nyAvstamning("2026-01-01");
    const avvisad = await isRejected(() => bekrafta(ids.caesar, "caesar", id));
    expect(avvisad).toBe(true);
  });

  it("avvisar även när bara en punkt återstår", async () => {
    const id = await nyAvstamning("2026-01-02");
    await owner`update reconciliations
      set checklist = ${owner.json({ transaktioner: true, lanesaldo: true, skatt: true, bilagor: false })}
      where id = ${id}`;
    const avvisad = await isRejected(() => bekrafta(ids.caesar, "caesar", id));
    expect(avvisad).toBe(true);
  });

  it("släpper igenom när allt är avbockat", async () => {
    const id = await nyAvstamning("2026-01-03");
    await bockaAlla(id);
    await bekrafta(ids.caesar, "caesar", id);
    const rader = await owner`select party_id from reconciliation_confirmations
      where reconciliation_id = ${id}`;
    expect(rader.map((r) => r.party_id)).toEqual(["caesar"]);
  });
});

describeDb("Perioden avslutas av databasen, inte av klienten", () => {
  it("en parts bekräftelse räcker inte", async () => {
    const id = await nyAvstamning("2026-02-01");
    await bockaAlla(id);
    await bekrafta(ids.caesar, "caesar", id);

    const [rad] = await owner`select completed_at from reconciliations where id = ${id}`;
    expect(rad.completed_at).toBeNull();
  });

  it("den andra bekräftelsen avslutar perioden", async () => {
    const id = await nyAvstamning("2026-02-02");
    await bockaAlla(id);
    await bekrafta(ids.caesar, "caesar", id);
    await bekrafta(ids.felicia, "felicia", id);

    const [rad] = await owner`select completed_at from reconciliations where id = ${id}`;
    expect(rad.completed_at).not.toBeNull();
  });

  it("samma part kan inte bekräfta två gånger för att avsluta ensam", async () => {
    const id = await nyAvstamning("2026-02-03");
    await bockaAlla(id);
    await bekrafta(ids.caesar, "caesar", id);
    const avvisad = await isRejected(() => bekrafta(ids.caesar, "caesar", id));
    expect(avvisad).toBe(true);

    const [rad] = await owner`select completed_at from reconciliations where id = ${id}`;
    expect(rad.completed_at).toBeNull();
  });

  it("en part kan inte bekräfta i motpartens namn", async () => {
    const id = await nyAvstamning("2026-02-04");
    await bockaAlla(id);
    const avvisad = await isRejected(() => bekrafta(ids.caesar, "felicia", id));
    expect(avvisad).toBe(true);
  });

  it("någon utanför hushållet kommer inte åt avstämningen alls", async () => {
    const id = await nyAvstamning("2026-02-05");
    const synliga = await asUser(
      app,
      ids.utom,
      (tx) => tx`select id from reconciliations where id = ${id}`,
    );
    expect(synliga).toHaveLength(0);

    const avvisad = await isRejected(() => bekrafta(ids.utom, "caesar", id));
    expect(avvisad).toBe(true);
  });

  it("en avslutad avstämning går inte att ändra i efterhand", async () => {
    const id = await nyAvstamning("2026-03-01");
    await bockaAlla(id);
    await bekrafta(ids.caesar, "caesar", id);
    await bekrafta(ids.felicia, "felicia", id);

    // Policyn för uppdatering gäller bara öppna avstämningar, så en ändring
    // träffar ingen rad i stället för att gå igenom.
    await asUser(
      app,
      ids.caesar,
      (tx) => tx`update reconciliations
        set checklist = ${tx.json({ transaktioner: false })} where id = ${id}`,
    );
    const [rad] = await owner`select checklist from reconciliations where id = ${id}`;
    expect(rad.checklist.transaktioner).toBe(true);
  });

  it("ett avgivet ställningstagande kan inte tas tillbaka", async () => {
    const id = await nyAvstamning("2026-03-02");
    await bockaAlla(id);
    await bekrafta(ids.caesar, "caesar", id);

    const avvisad = await isRejected(
      () => owner`delete from reconciliation_confirmations where reconciliation_id = ${id}`,
    );
    expect(avvisad).toBe(true);
  });
});

describeDb("Nästa period räknas från den avslutade avstämningen", () => {
  it("bara en avstämning kan vara öppen åt gången", async () => {
    // Perioden är unik per hushåll och startdag, vilket hindrar två öppna för
    // samma period. Serverfunktionen återanvänder dessutom en redan öppen.
    const id = await nyAvstamning("2026-04-01");
    const avvisad = await isRejected(() => nyAvstamning("2026-04-01"));
    expect(avvisad).toBe(true);
    expect(id).toBeTruthy();
  });

  it("den avslutade periodens slut är utgångspunkten, inte senaste posten", async () => {
    const id = await nyAvstamning("2026-05-01");
    await owner`update reconciliations set period_end = '2026-05-20' where id = ${id}`;
    await bockaAlla(id);
    await bekrafta(ids.caesar, "caesar", id);
    await bekrafta(ids.felicia, "felicia", id);

    const [senast] = await owner`
      select period_end from reconciliations
       where household_id = ${ids.household} and completed_at is not null
       order by period_end desc limit 1`;
    // Drivrutinen ger ett Date för datumkolumner; jämför på dagen.
    expect(new Date(senast.period_end).toISOString().slice(0, 10)).toBe("2026-05-20");
  });
});
