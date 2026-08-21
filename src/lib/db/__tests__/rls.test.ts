import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asUser, appSql, databaseAvailable, isRejected, ownerSql } from "./helpers";

const DB = "mittochditt_rls_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

// Två hushåll, tre användare: Caesar och Felicia delar hushåll, Nadia har eget.
const ids = {
  caesar: "",
  felicia: "",
  nadia: "",
  household: "",
  other: "",
  transaction: "",
  version: "",
};

/**
 * Utan databas hoppas sviten över lokalt. I CI kastar databaseAvailable()
 * i stället – säkerhetstester som tyst försvinner är farligare än inga alls.
 */
const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

beforeAll(async () => {
  if (!available) return;
  admin = ownerSql("postgres");
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin`create database ${admin.unsafe(DB)}`;

  owner = ownerSql(DB);
  const directory = "db/migrations";
  const files = (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await owner.unsafe(await readFile(path.join(directory, file), "utf8"));
  }

  const [caesar] = await owner`
    insert into users (email, name) values ('caesar@example.se', 'Caesar') returning id`;
  const [felicia] = await owner`
    insert into users (email, name) values ('felicia@example.se', 'Felicia') returning id`;
  const [nadia] = await owner`
    insert into users (email, name) values ('nadia@example.se', 'Nadia') returning id`;
  ids.caesar = caesar.id;
  ids.felicia = felicia.id;
  ids.nadia = nadia.id;

  const [household] = await owner`
    insert into households (name) values ('Caesar & Felicia') returning id`;
  const [other] = await owner`insert into households (name) values ('Nadia') returning id`;
  ids.household = household.id;
  ids.other = other.id;

  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.household}, ${ids.caesar}, 'caesar', 'Caesar'),
           (${ids.household}, ${ids.felicia}, 'felicia', 'Felicia'),
           (${ids.other}, ${ids.nadia}, 'nadia', 'Nadia')`;

  await owner`insert into properties (household_id, address)
    values (${ids.household}, 'Exempelgatan 12'), (${ids.other}, 'Annan gata 3')`;

  const [tx] = await owner`
    insert into transactions (household_id, reference, created_by)
    values (${ids.household}, 'T-0001', ${ids.caesar}) returning id`;
  ids.transaction = tx.id;
  const [version] = await owner`
    insert into transaction_versions
      (transaction_id, version, status, payment_date, category, created_by)
    values (${ids.transaction}, 1, 'pending', '2025-06-23', 'Reparation', ${ids.caesar})
    returning id`;
  ids.version = version.id;

  app = appSql(DB);
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await app?.end();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

describeDb("Åtkomst till hushåll", () => {
  it("en medlem ser sitt eget hushåll", async () => {
    const rows = await asUser(app, ids.caesar, (tx) => tx`select id from households`);
    expect(rows.map((r) => r.id)).toEqual([ids.household]);
  });

  it("en utomstående ser inte hushållet", async () => {
    const rows = await asUser(app, ids.nadia, (tx) => tx`select id from households`);
    expect(rows.map((r) => r.id)).toEqual([ids.other]);
  });

  it("utan inloggad användare syns ingenting alls", async () => {
    const rows = await asUser(app, null, (tx) => tx`select id from households`);
    expect(rows).toHaveLength(0);
  });

  it("bostaden syns bara för hushållets medlemmar", async () => {
    const mine = await asUser(app, ids.felicia, (tx) => tx`select address from properties`);
    expect(mine.map((r) => r.address)).toEqual(["Exempelgatan 12"]);
    const theirs = await asUser(app, ids.nadia, (tx) => tx`select address from properties`);
    expect(theirs.map((r) => r.address)).toEqual(["Annan gata 3"]);
  });

  it("transaktioner syns bara i det egna hushållet", async () => {
    const mine = await asUser(app, ids.caesar, (tx) => tx`select reference from transactions`);
    expect(mine).toHaveLength(1);
    const theirs = await asUser(app, ids.nadia, (tx) => tx`select reference from transactions`);
    expect(theirs).toHaveLength(0);
  });

  it("en utomstående kan inte skriva in sig i ett hushålls data", async () => {
    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.nadia,
        (tx) => tx`insert into transactions (household_id, reference, created_by)
          values (${ids.household}, 'T-9999', ${ids.nadia})`,
      ),
    );
    expect(rejected).toBe(true);
  });
});

describeDb("Godkännanden", () => {
  it("en part kan godkänna i eget namn", async () => {
    await asUser(
      app,
      ids.felicia,
      (tx) => tx`insert into transaction_approvals
        (transaction_version_id, user_id, party_id, decision)
        values (${ids.version}, ${ids.felicia}, 'felicia', 'approved')`,
    );
    const rows = await asUser(
      app,
      ids.felicia,
      (tx) =>
        tx`select party_id from transaction_approvals where transaction_version_id = ${ids.version}`,
    );
    expect(rows.map((r) => r.party_id)).toContain("felicia");
  });

  it("ingen kan godkänna åt den andra parten", async () => {
    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`insert into transaction_approvals
          (transaction_version_id, user_id, party_id, decision)
          values (${ids.version}, ${ids.felicia}, 'felicia', 'approved')`,
      ),
    );
    expect(rejected).toBe(true);
  });

  it("ingen kan godkänna i eget namn men med motpartens partsroll", async () => {
    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`insert into transaction_approvals
          (transaction_version_id, user_id, party_id, decision)
          values (${ids.version}, ${ids.caesar}, 'felicia', 'approved')`,
      ),
    );
    expect(rejected).toBe(true);
  });

  it("ett avgivet godkännande kan inte ändras eller tas bort", async () => {
    // Två lager skyddar raden. Radnivåsäkerheten filtrerar bort den för
    // applikationsrollen, så försöket träffar ingenting. Ägarrollen kringgår
    // radnivåsäkerheten men stoppas av spärren i databasen.
    await isRejected(() =>
      asUser(
        app,
        ids.felicia,
        (tx) => tx`update transaction_approvals set decision = 'objected'
          where transaction_version_id = ${ids.version}`,
      ),
    );
    await isRejected(() =>
      asUser(
        app,
        ids.felicia,
        (tx) => tx`delete from transaction_approvals where transaction_version_id = ${ids.version}`,
      ),
    );

    const asOwnerChanged = await isRejected(
      () => owner`update transaction_approvals set decision = 'objected'
        where transaction_version_id = ${ids.version}`,
    );
    const asOwnerDeleted = await isRejected(
      () => owner`delete from transaction_approvals where transaction_version_id = ${ids.version}`,
    );
    expect([asOwnerChanged, asOwnerDeleted]).toEqual([true, true]);

    // Det som räknas: godkännandet står kvar oförändrat.
    const rows = await owner`select decision from transaction_approvals
      where transaction_version_id = ${ids.version}`;
    expect(rows.map((r) => r.decision)).toEqual(["approved"]);
  });
});

describeDb("Oföränderliga poster", () => {
  it("en gällande version kan inte ändras, inte ens av ägaren", async () => {
    const [version] = await owner`
      insert into transaction_versions
        (transaction_id, version, status, payment_date, category, created_by, effective_at)
      values (${ids.transaction}, 2, 'approved', '2025-07-01', 'Ränta', ${ids.caesar}, now())
      returning id`;

    // Ägarrollen stoppas av spärren, som gäller alla roller.
    const asOwner = await isRejected(
      () => owner`update transaction_versions set category = 'Annat' where id = ${version.id}`,
    );
    const removed = await isRejected(
      () => owner`delete from transaction_versions where id = ${version.id}`,
    );
    expect([asOwner, removed]).toEqual([true, true]);

    // Applikationsrollen får inte ens syn på raden i en uppdatering, så
    // försöket träffar ingenting i stället för att avvisas högljutt.
    await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`update transaction_versions set category = 'Annat' where id = ${version.id}`,
      ),
    );

    const [row] = await owner`select category from transaction_versions where id = ${version.id}`;
    expect(row.category).toBe("Ränta");
  });

  it("ett eget utkast får ändras och raderas", async () => {
    const [draft] = await owner`
      insert into transaction_versions
        (transaction_id, version, status, payment_date, category, created_by)
      values (${ids.transaction}, 3, 'draft', '2025-07-02', 'Underhåll', ${ids.caesar})
      returning id`;

    await asUser(
      app,
      ids.caesar,
      (tx) => tx`update transaction_versions set category = 'Förbättring' where id = ${draft.id}`,
    );
    const [row] = await owner`select category from transaction_versions where id = ${draft.id}`;
    expect(row.category).toBe("Förbättring");

    await asUser(
      app,
      ids.caesar,
      (tx) => tx`delete from transaction_versions where id = ${draft.id}`,
    );
    const rows = await owner`select id from transaction_versions where id = ${draft.id}`;
    expect(rows).toHaveLength(0);
  });

  it("motpartens utkast går inte att ändra", async () => {
    const [draft] = await owner`
      insert into transaction_versions
        (transaction_id, version, status, payment_date, category, created_by)
      values (${ids.transaction}, 4, 'draft', '2025-07-03', 'Vitvara/fast utrustning', ${ids.caesar})
      returning id`;

    await asUser(
      app,
      ids.felicia,
      (tx) => tx`update transaction_versions set category = 'Mat' where id = ${draft.id}`,
    );
    const [row] = await owner`select category from transaction_versions where id = ${draft.id}`;
    // Policyn filtrerar bort raden, så uppdateringen träffar ingenting.
    expect(row.category).toBe("Vitvara/fast utrustning");
  });

  it("en korrigering utan angivet skäl avvisas", async () => {
    const rejected = await isRejected(
      () => owner`insert into transaction_versions
        (transaction_id, version, status, payment_date, category, created_by, corrects_transaction_id)
        values (${ids.transaction}, 5, 'draft', '2025-07-04', 'Ränta', ${ids.caesar}, ${ids.transaction})`,
    );
    expect(rejected).toBe(true);
  });

  it("en version kan inte både korrigera och makulera", async () => {
    const rejected = await isRejected(
      () => owner`insert into transaction_versions
        (transaction_id, version, status, payment_date, category, created_by,
         corrects_transaction_id, voids_transaction_id, reason)
        values (${ids.transaction}, 6, 'draft', '2025-07-05', 'Ränta', ${ids.caesar},
                ${ids.transaction}, ${ids.transaction}, 'Fel')`,
    );
    expect(rejected).toBe(true);
  });
});

describeDb("Aktivitetsloggen", () => {
  it("kedjas ihop och kan verifieras", async () => {
    await asUser(
      app,
      ids.caesar,
      (tx) => tx`insert into audit_events
        (household_id, event_type, entity_type, entity_id, actor_id, new_value)
        values (${ids.household}, 'transaction.created', 'transaction', ${ids.transaction},
                ${ids.caesar}, '{"reference":"T-0001"}'::jsonb)`,
    );
    await asUser(
      app,
      ids.felicia,
      (tx) => tx`insert into audit_events
        (household_id, event_type, entity_type, entity_id, actor_id, new_value)
        values (${ids.household}, 'transaction.approved', 'transaction', ${ids.transaction},
                ${ids.felicia}, '{"party":"felicia"}'::jsonb)`,
    );

    const rows = await owner<{ sequence: string; prev_hash: string; hash: string }[]>`
      select sequence, prev_hash, hash from audit_events
      where household_id = ${ids.household} order by sequence`;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].prev_hash).toBe("0".repeat(64));
    expect(rows[1].prev_hash).toBe(rows[0].hash);

    const verified = await owner<{ ok: boolean }[]>`
      select ok from verify_audit_chain(${ids.household})`;
    expect(verified.every((row) => row.ok)).toBe(true);
  });

  it("kan inte ändras eller raderas av någon", async () => {
    const changed = await isRejected(
      () => owner`update audit_events set event_type = 'förfalskad'
        where household_id = ${ids.household}`,
    );
    const deleted = await isRejected(
      () => owner`delete from audit_events where household_id = ${ids.household}`,
    );
    expect([changed, deleted]).toEqual([true, true]);
  });

  it("kan inte skrivas i någon annans namn", async () => {
    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`insert into audit_events
          (household_id, event_type, entity_type, actor_id)
          values (${ids.household}, 'påhittad', 'transaction', ${ids.felicia})`,
      ),
    );
    expect(rejected).toBe(true);
  });

  it("syns bara för hushållets medlemmar", async () => {
    const theirs = await asUser(app, ids.nadia, (tx) => tx`select id from audit_events`);
    expect(theirs).toHaveLength(0);
  });
});

describeDb("Sessioner och konton", () => {
  it("en användare ser bara sina egna sessioner", async () => {
    await owner`insert into sessions (token_hash, user_id, expires_at)
      values ('hash-caesar', ${ids.caesar}, now() + interval '30 days'),
             ('hash-nadia', ${ids.nadia}, now() + interval '30 days')`;
    const rows = await asUser(app, ids.caesar, (tx) => tx`select token_hash from sessions`);
    expect(rows.map((r) => r.token_hash)).toEqual(["hash-caesar"]);
  });

  it("man ser sig själv och sin motpart, men inte utomstående", async () => {
    const rows = await asUser(app, ids.caesar, (tx) => tx`select email from users order by email`);
    expect(rows.map((r) => r.email)).toEqual(["caesar@example.se", "felicia@example.se"]);
  });
});
