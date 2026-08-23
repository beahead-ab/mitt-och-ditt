import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dodsfallsfrister } from "@/lib/dodsfall";
import { asUser, appSql, databaseAvailable, isRejected, ownerSql } from "./helpers";

/**
 * Dödsfallsprocessen mot databasen.
 *
 * Fristerna i sig prövas i lib/__tests__/dodsfall.test.ts. Här prövas det som
 * bara databasen kan svara på: att dagarna inte kan registreras i orimlig
 * ordning, att bara en pågående process går att fylla i, och att en part i ett
 * annat hushåll inte kommer åt något.
 */
const DB = "mittochditt_dodsfall_db_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = { caesar: "", utom: "", household: "", process: "" };

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
  const [u] = await owner`insert into users (email, name) values ('u@x.se', 'Utom') returning id`;
  const [h] = await owner`
    insert into households (name, party_a, party_b)
    values ('Caesar & Felicia', 'caesar', 'felicia') returning id`;
  ids.caesar = c.id;
  ids.utom = u.id;
  ids.household = h.id;

  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.household}, ${ids.caesar}, 'caesar', 'Caesar')`;

  const [p] = await owner`
    insert into exit_processes (household_id, process_date, kind, started_by)
    values (${ids.household}, '2026-09-01', 'dodsfall', ${ids.caesar}) returning id`;
  ids.process = p.id;

  app = appSql(DB);
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await app?.end();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

describeDb("Dödsfall går att välja som processtyp", () => {
  it("databasen känner till slaget", async () => {
    const [rad] = await owner`select kind from exit_processes where id = ${ids.process}`;
    expect(rad.kind).toBe("dodsfall");
  });
});

describeDb("Dagarna måste komma i rimlig ordning", () => {
  it("meddelandet kan inte ligga före bouppteckningsförrättningen", async () => {
    const avvisad = await isRejected(
      () => owner`update exit_processes
        set estate_inventory_on = '2026-09-10', takeover_declared_on = '2026-09-01'
        where id = ${ids.process}`,
    );
    expect(avvisad).toBe(true);
  });

  it("finansieringen kan inte vara ordnad före värdet fastställdes", async () => {
    const avvisad = await isRejected(
      () => owner`update exit_processes
        set value_established_on = '2026-11-01', financing_arranged_on = '2026-10-01'
        where id = ${ids.process}`,
    );
    expect(avvisad).toBe(true);
  });

  it("släpper igenom en rimlig ordning", async () => {
    await owner`update exit_processes
      set estate_inventory_on = '2026-09-10', takeover_declared_on = '2026-09-20'
      where id = ${ids.process}`;
    const [rad] = await owner`
      select estate_inventory_on::text, takeover_declared_on::text
        from exit_processes where id = ${ids.process}`;
    expect(rad.estate_inventory_on).toBe("2026-09-10");
    expect(rad.takeover_declared_on).toBe("2026-09-20");
  });
});

describeDb("Fristerna räknas ur de registrerade dagarna", () => {
  it("ger samma svar som den rena funktionen", async () => {
    const [rad] = await owner`
      select estate_inventory_on::text, takeover_declared_on::text,
             value_established_on::text, financing_arranged_on::text
        from exit_processes where id = ${ids.process}`;

    const lage = dodsfallsfrister({
      bouppteckningPa: rad.estate_inventory_on,
      meddelatPa: rad.takeover_declared_on,
      vardeFastställtPa: rad.value_established_on,
      finansieringOrdnadPa: rad.financing_arranged_on,
      idag: "2026-09-15",
    });

    // Meddelandet är gjort, så den fristen är uppfylld. Värdet är inte
    // fastställt, så fyramånadersfristen har inte börjat löpa.
    const meddelande = lage.frister.find((f) => f.nyckel === "meddelande")!;
    const finansiering = lage.frister.find((f) => f.nyckel === "finansiering")!;
    expect(meddelande.lage).toBe("uppfylld");
    expect(finansiering.lage).toBe("vantar_pa_underlag");
  });
});

describeDb("Hushållsgränsen", () => {
  it("någon utanför hushållet ser ingen process", async () => {
    const synliga = await asUser(
      app,
      ids.utom,
      (tx) => tx`select id from exit_processes where id = ${ids.process}`,
    );
    expect(synliga).toHaveLength(0);
  });

  it("och kan inte fylla i dagarna", async () => {
    await asUser(
      app,
      ids.utom,
      (tx) => tx`update exit_processes set estate_inventory_on = '2027-01-01'
        where id = ${ids.process}`,
    );
    const [rad] = await owner`
      select estate_inventory_on::text from exit_processes where id = ${ids.process}`;
    expect(rad.estate_inventory_on).toBe("2026-09-10");
  });
});
