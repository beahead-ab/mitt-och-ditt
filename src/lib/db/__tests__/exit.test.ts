import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asUser, appSql, databaseAvailable, isRejected, ownerSql } from "./helpers";
import { checksumOf } from "@/lib/db/exit.server";
import { calculate, kr, type EngineInput } from "@/lib/engine";

/**
 * Slutavräkningens frysning och omverifiering. Det är den starkaste garantin i
 * hela tjänsten, så den bevisas mot en riktig databas.
 */
const DB = "mittochditt_exit_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = { caesar: "", felicia: "", household: "", settlement: "" };

const AGREEMENT = {
  startDate: "2026-08-17",
  startValue: kr(4_495_000),
  initialLoan: kr(3_115_000),
  parties: ["caesar", "felicia"] as [string, string],
  startUnits: { caesar: 1_200_000, felicia: 180_000 },
  totalUnits: 1_380_000,
};

const INPUT: EngineInput = {
  agreement: AGREEMENT,
  categoryRules: [
    {
      category: "Vitvara/fast utrustning",
      effectiveFrom: "2026-08-17",
      included: true,
      approved: true,
    },
  ],
  transactions: [
    {
      id: "T-0001",
      paymentDate: "2026-09-07",
      category: "Vitvara/fast utrustning",
      payments: { felicia: { gross: kr(12_400) } },
      status: "approved",
    },
  ],
  endpoint: {
    mode: "slutlig",
    endDate: "2031-08-17",
    endValue: kr(5_500_000),
    endLoan: kr(2_800_000),
    saleCosts: kr(80_000),
  },
};

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

  const [caesar] = await owner`
    insert into users (email, name) values ('c@x.se', 'Caesar') returning id`;
  const [felicia] = await owner`
    insert into users (email, name) values ('f@x.se', 'Felicia') returning id`;
  const [household] = await owner`insert into households (name) values ('Test') returning id`;
  ids.caesar = caesar.id;
  ids.felicia = felicia.id;
  ids.household = household.id;

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

async function insertSettlement(lock = false) {
  const result = calculate(INPUT);
  const checksum = checksumOf(INPUT, result);
  const [row] = await owner<{ id: string }[]>`
    insert into settlements (
      household_id, basis, end_date, end_value_ore, end_loan_ore, sale_costs_ore,
      frozen_input, frozen_result, engine_version, checksum, created_by, locked_at
    ) values (
      ${ids.household}, 'extern-forsaljning', '2031-08-17', ${INPUT.endpoint.endValue},
      ${INPUT.endpoint.endLoan}, ${INPUT.endpoint.saleCosts ?? 0},
      ${owner.json(INPUT as never)}, ${owner.json(result as never)},
      ${result.engineVersion}, ${checksum}, ${ids.caesar},
      ${lock ? owner`now()` : null}
    ) returning id`;
  return row.id;
}

describeDb("Slutavräkningens frysning", () => {
  it("kan räknas om ur sina egna indata och ge samma resultat", async () => {
    ids.settlement = await insertSettlement();
    const [row] = await owner<
      { frozen_input: EngineInput; frozen_result: unknown; checksum: string }[]
    >`
      select frozen_input, frozen_result, checksum from settlements where id = ${ids.settlement}`;

    const recomputed = calculate(row.frozen_input);
    expect(checksumOf(row.frozen_input, recomputed)).toBe(row.checksum);
    expect(JSON.parse(JSON.stringify(recomputed))).toEqual(row.frozen_result);
  });

  it("checksumman ändras när underlaget ändras", async () => {
    const changed: EngineInput = {
      ...INPUT,
      transactions: [
        {
          ...INPUT.transactions[0],
          payments: { felicia: { gross: kr(12_401) } },
        },
      ],
    };
    expect(checksumOf(changed, calculate(changed))).not.toBe(checksumOf(INPUT, calculate(INPUT)));
  });

  it("checksumman är oberoende av nyckelordning i indata", async () => {
    const reordered = {
      endpoint: INPUT.endpoint,
      transactions: INPUT.transactions,
      categoryRules: INPUT.categoryRules,
      agreement: INPUT.agreement,
    } as EngineInput;
    expect(checksumOf(reordered, calculate(reordered))).toBe(checksumOf(INPUT, calculate(INPUT)));
  });

  it("låses när båda parter godkänt", async () => {
    const settlementId = await insertSettlement();

    await asUser(
      app,
      ids.caesar,
      (tx) => tx`insert into document_approvals
        (entity_type, entity_id, household_id, user_id, party_id, decision)
        values ('settlement', ${settlementId}, ${ids.household}, ${ids.caesar}, 'caesar', 'approved')`,
    );
    let [row] = await owner`select locked_at from settlements where id = ${settlementId}`;
    expect(row.locked_at).toBeNull();

    await asUser(
      app,
      ids.felicia,
      (tx) => tx`insert into document_approvals
        (entity_type, entity_id, household_id, user_id, party_id, decision)
        values ('settlement', ${settlementId}, ${ids.household}, ${ids.felicia}, 'felicia', 'approved')`,
    );
    [row] = await owner`select locked_at from settlements where id = ${settlementId}`;
    expect(row.locked_at).not.toBeNull();
  });

  it("en låst avräkning kan inte ändras eller tas bort av någon roll", async () => {
    const settlementId = await insertSettlement(true);

    const changed = await isRejected(
      () => owner`update settlements set end_value_ore = 1 where id = ${settlementId}`,
    );
    const removed = await isRejected(
      () => owner`delete from settlements where id = ${settlementId}`,
    );
    expect([changed, removed]).toEqual([true, true]);

    const [row] = await owner`select end_value_ore from settlements where id = ${settlementId}`;
    expect(Number(row.end_value_ore)).toBe(INPUT.endpoint.endValue);
  });

  it("ingen kan godkänna slutavräkningen med motpartens partsroll", async () => {
    const settlementId = await insertSettlement();
    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`insert into document_approvals
          (entity_type, entity_id, household_id, user_id, party_id, decision)
          values ('settlement', ${settlementId}, ${ids.household}, ${ids.caesar}, 'felicia', 'approved')`,
      ),
    );
    expect(rejected).toBe(true);
  });

  it("syns bara för hushållets medlemmar", async () => {
    await insertSettlement();
    const [outsider] = await owner`
      insert into users (email, name) values ('utomstaende@x.se', 'Utomstående') returning id`;
    const rows = await asUser(app, outsider.id, (tx) => tx`select id from settlements`);
    expect(rows).toHaveLength(0);
  });
});

describeDb("Exitprocessen", () => {
  it("sparar processdagen och kan bara skrivas av medlemmar", async () => {
    const [row] = await asUser(
      app,
      ids.caesar,
      (tx) => tx`insert into exit_processes (household_id, process_date, kind, started_by)
        values (${ids.household}, '2027-03-01', 'utkop', ${ids.caesar}) returning id`,
    );
    expect(row.id).toBeTruthy();

    const [outsider] = await owner`
      insert into users (email, name) values ('annan@x.se', 'Annan') returning id`;
    const rejected = await isRejected(() =>
      asUser(
        app,
        outsider.id,
        (tx) => tx`insert into exit_processes (household_id, process_date, kind, started_by)
          values (${ids.household}, '2027-03-02', 'utkop', ${outsider.id})`,
      ),
    );
    expect(rejected).toBe(true);
  });

  it("värderingar kräver ett positivt belopp", async () => {
    const [process] = await owner`
      insert into exit_processes (household_id, process_date, started_by)
      values (${ids.household}, '2027-04-01', ${ids.caesar}) returning id`;

    const rejected = await isRejected(
      () => owner`insert into valuations
        (exit_process_id, household_id, broker, valued_on, amount_ore, created_by)
        values (${process.id}, ${ids.household}, 'Mäklare', '2027-04-02', 0, ${ids.caesar})`,
    );
    expect(rejected).toBe(true);
  });
});
