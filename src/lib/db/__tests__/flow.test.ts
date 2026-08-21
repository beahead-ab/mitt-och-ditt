import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asUser, appSql, isRejected, ownerSql } from "./helpers";

/**
 * Hela godkännandeflödet mot en riktig Postgres. Övergången till "gäller"
 * drivs av databasen, så det är där den måste bevisas.
 */
const DB = "mittochditt_flow_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = { caesar: "", felicia: "", household: "" };

async function newTransaction(
  creator: string,
  reference: string,
  overrides: {
    status?: string;
    payments?: string;
    voids?: string | null;
    corrects?: string | null;
    reason?: string;
  } = {},
) {
  const [tx] = await owner`
    insert into transactions (household_id, reference, created_by)
    values (${ids.household}, ${reference}, ${creator}) returning id`;
  const [version] = await owner`
    insert into transaction_versions
      (transaction_id, version, status, payment_date, category, payments,
       voids_transaction_id, corrects_transaction_id, reason, created_by)
    values (${tx.id}, 1, ${overrides.status ?? "pending"}, '2026-09-01', 'Reparation',
            ${overrides.payments ?? '{"caesar": {"gross": 500000}}'}::jsonb,
            ${overrides.voids ?? null}, ${overrides.corrects ?? null},
            ${overrides.reason ?? null}, ${creator})
    returning id`;
  return { transactionId: tx.id as string, versionId: version.id as string };
}

async function approve(userId: string, partyId: string, versionId: string) {
  return asUser(
    app,
    userId,
    (tx) => tx`insert into transaction_approvals
      (transaction_version_id, user_id, party_id, decision)
      values (${versionId}, ${userId}, ${partyId}, 'approved')`,
  );
}

async function versionState(versionId: string) {
  const [row] = await owner<{ status: string; effective_at: Date | null }[]>`
    select status, effective_at from transaction_versions where id = ${versionId}`;
  return row;
}

beforeAll(async () => {
  admin = ownerSql("postgres");
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin`create database ${admin.unsafe(DB)}`;
  owner = ownerSql(DB);

  const files = (await readdir("db/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await owner.unsafe(await readFile(path.join("db/migrations", file), "utf8"));
  }

  const [caesar] = await owner`
    insert into users (email, name) values ('caesar@x.se', 'Caesar') returning id`;
  const [felicia] = await owner`
    insert into users (email, name) values ('felicia@x.se', 'Felicia') returning id`;
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
  await app?.end();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

describe("Godkännandeflödet", () => {
  it("posten börjar gälla först när båda godkänt", async () => {
    const { versionId } = await newTransaction(ids.caesar, "T-0001");

    await approve(ids.caesar, "caesar", versionId);
    let state = await versionState(versionId);
    expect(state.effective_at).toBeNull();
    expect(state.status).toBe("pending");

    await approve(ids.felicia, "felicia", versionId);
    state = await versionState(versionId);
    expect(state.status).toBe("approved");
    expect(state.effective_at).not.toBeNull();
  });

  it("en invändning gör posten tvistig och den börjar inte gälla", async () => {
    const { versionId } = await newTransaction(ids.caesar, "T-0002");
    await approve(ids.caesar, "caesar", versionId);
    await asUser(
      app,
      ids.felicia,
      (tx) => tx`insert into transaction_approvals
        (transaction_version_id, user_id, party_id, decision, note)
        values (${versionId}, ${ids.felicia}, 'felicia', 'objected', 'Fel belopp')`,
    );

    const state = await versionState(versionId);
    expect(state.status).toBe("disputed");
    expect(state.effective_at).toBeNull();
  });

  it("samma part kan inte godkänna två gånger för att nå majoritet ensam", async () => {
    const { versionId } = await newTransaction(ids.caesar, "T-0003");
    await approve(ids.caesar, "caesar", versionId);
    const twice = await isRejected(() => approve(ids.caesar, "caesar", versionId));
    expect(twice).toBe(true);

    const state = await versionState(versionId);
    expect(state.effective_at).toBeNull();
  });

  it("en gällande post kan inte sättas ur kraft genom att skriva i tabellen", async () => {
    const { versionId } = await newTransaction(ids.caesar, "T-0004");
    await approve(ids.caesar, "caesar", versionId);
    await approve(ids.felicia, "felicia", versionId);

    const rejected = await isRejected(
      () => owner`update transaction_versions set effective_at = null where id = ${versionId}`,
    );
    expect(rejected).toBe(true);
    expect((await versionState(versionId)).effective_at).not.toBeNull();
  });

  it("ett utkast kan skickas in och sedan dras tillbaka av registratorn", async () => {
    const { versionId } = await newTransaction(ids.caesar, "T-0005", { status: "draft" });

    await asUser(
      app,
      ids.caesar,
      (tx) => tx`update transaction_versions set status = 'pending' where id = ${versionId}`,
    );
    expect((await versionState(versionId)).status).toBe("pending");

    await asUser(
      app,
      ids.caesar,
      (tx) => tx`update transaction_versions set status = 'withdrawn' where id = ${versionId}`,
    );
    expect((await versionState(versionId)).status).toBe("withdrawn");
  });

  it("motparten kan inte dra tillbaka någon annans post", async () => {
    const { versionId } = await newTransaction(ids.caesar, "T-0006");
    await asUser(
      app,
      ids.felicia,
      (tx) => tx`update transaction_versions set status = 'withdrawn' where id = ${versionId}`,
    );
    // Radnivåsäkerheten filtrerar bort raden, så statusen står kvar.
    expect((await versionState(versionId)).status).toBe("pending");
  });

  it("en makuleringspost kräver skäl och tar posten ur kraft när båda godkänt", async () => {
    const target = await newTransaction(ids.caesar, "T-0007");
    await approve(ids.caesar, "caesar", target.versionId);
    await approve(ids.felicia, "felicia", target.versionId);

    const utanSkal = await isRejected(() =>
      newTransaction(ids.caesar, "T-0008", { voids: target.transactionId, payments: "{}" }),
    );
    expect(utanSkal).toBe(true);

    const makulering = await newTransaction(ids.felicia, "T-0009", {
      voids: target.transactionId,
      payments: "{}",
      reason: "Posten hörde inte hit",
    });
    await approve(ids.felicia, "felicia", makulering.versionId);
    expect((await versionState(makulering.versionId)).effective_at).toBeNull();

    await approve(ids.caesar, "caesar", makulering.versionId);
    expect((await versionState(makulering.versionId)).status).toBe("approved");

    // Ursprungsposten finns kvar, oförändrad och gällande – motorn avgör att
    // den inte längre räknas.
    const [original] = await owner`
      select status, effective_at from transaction_versions where id = ${target.versionId}`;
    expect(original.status).toBe("approved");
    expect(original.effective_at).not.toBeNull();
  });
});

describe("Avtal och klassificeringar", () => {
  it("en avtalsversion börjar gälla när båda godkänt", async () => {
    const [agreement] = await owner`
      insert into agreements (household_id) values (${ids.household}) returning id`;
    const [version] = await owner`
      insert into agreement_versions (
        agreement_id, version, start_date, start_value_ore, initial_loan_ore,
        total_units, start_units, created_by
      ) values (
        ${agreement.id}, 1, '2026-08-17', 449500000, 311500000, 1380000,
        '{"caesar": 1200000, "felicia": 180000}'::jsonb, ${ids.caesar}
      ) returning id`;

    await asUser(
      app,
      ids.caesar,
      (tx) => tx`insert into document_approvals
        (entity_type, entity_id, household_id, user_id, party_id, decision)
        values ('agreement_version', ${version.id}, ${ids.household}, ${ids.caesar}, 'caesar', 'approved')`,
    );
    let [row] = await owner`select effective_at from agreement_versions where id = ${version.id}`;
    expect(row.effective_at).toBeNull();

    await asUser(
      app,
      ids.felicia,
      (tx) => tx`insert into document_approvals
        (entity_type, entity_id, household_id, user_id, party_id, decision)
        values ('agreement_version', ${version.id}, ${ids.household}, ${ids.felicia}, 'felicia', 'approved')`,
    );
    [row] = await owner`select effective_at from agreement_versions where id = ${version.id}`;
    expect(row.effective_at).not.toBeNull();
  });

  it("ingen kan godkänna ett avtal med motpartens partsroll", async () => {
    const [agreement] = await owner`
      insert into agreements (household_id) values (${ids.household}) returning id`;
    const [version] = await owner`
      insert into agreement_versions (
        agreement_id, version, start_date, start_value_ore, initial_loan_ore,
        total_units, start_units, created_by
      ) values (
        ${agreement.id}, 1, '2026-08-17', 449500000, 311500000, 1380000,
        '{"caesar": 1200000, "felicia": 180000}'::jsonb, ${ids.caesar}
      ) returning id`;

    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`insert into document_approvals
          (entity_type, entity_id, household_id, user_id, party_id, decision)
          values ('agreement_version', ${version.id}, ${ids.household}, ${ids.caesar}, 'felicia', 'approved')`,
      ),
    );
    expect(rejected).toBe(true);
  });

  it("ett godkännande av ett dokument kan inte tas tillbaka", async () => {
    const rows = await owner<{ id: string }[]>`select id from document_approvals limit 1`;
    const changed = await isRejected(
      () => owner`update document_approvals set decision = 'objected' where id = ${rows[0].id}`,
    );
    const deleted = await isRejected(
      () => owner`delete from document_approvals where id = ${rows[0].id}`,
    );
    expect([changed, deleted]).toEqual([true, true]);
  });
});
