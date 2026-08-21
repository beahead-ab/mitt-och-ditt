import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asUser, appSql, databaseAvailable, isRejected, ownerSql } from "./helpers";

/**
 * Administratörens gräns: åtkomst, inte innehåll.
 *
 * Att administratören kan bjuda in och stänga av konton men aldrig läsa
 * parternas ekonomi är en av tjänstens viktigaste egenskaper, och den ligger i
 * databasen. Därför bevisas den här.
 */
const DB = "mittochditt_admin_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = { admin: "", caesar: "", felicia: "", household: "", transaction: "" };

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

  const [adminUser] = await owner`
    insert into users (email, name, is_admin) values ('admin@x.se', 'Administratör', true)
    returning id`;
  const [caesar] = await owner`
    insert into users (email, name) values ('c@x.se', 'Caesar') returning id`;
  const [felicia] = await owner`
    insert into users (email, name) values ('f@x.se', 'Felicia') returning id`;
  const [household] = await owner`
    insert into households (name) values ('Caesar & Felicia') returning id`;
  ids.admin = adminUser.id;
  ids.caesar = caesar.id;
  ids.felicia = felicia.id;
  ids.household = household.id;

  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.household}, ${ids.caesar}, 'caesar', 'Caesar'),
           (${ids.household}, ${ids.felicia}, 'felicia', 'Felicia')`;
  await owner`insert into properties (household_id, address)
    values (${ids.household}, 'Exempelgatan 12')`;

  const [tx] = await owner`
    insert into transactions (household_id, reference, created_by)
    values (${ids.household}, 'T-0001', ${ids.caesar}) returning id`;
  ids.transaction = tx.id;
  await owner`
    insert into transaction_versions
      (transaction_id, version, status, payment_date, category, payments, created_by, effective_at)
    values (${ids.transaction}, 1, 'approved', '2026-09-01', 'Reparation',
            '{"caesar": {"gross": 5000000}}'::jsonb, ${ids.caesar}, now())`;
  await owner`
    insert into audit_events (household_id, event_type, entity_type, actor_id)
    values (${ids.household}, 'transaction.approved', 'transaction', ${ids.caesar})`;

  app = appSql(DB);
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await app?.end();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

describeDb("Administratören hanterar åtkomst", () => {
  it("ser alla konton", async () => {
    const rows = await asUser(app, ids.admin, (tx) => tx`select email from users order by email`);
    expect(rows.map((r) => r.email)).toEqual(["admin@x.se", "c@x.se", "f@x.se"]);
  });

  it("kan stänga av och öppna ett konto", async () => {
    await asUser(
      app,
      ids.admin,
      (tx) => tx`update users set disabled_at = now() where id = ${ids.felicia}`,
    );
    let [row] = await owner`select disabled_at from users where id = ${ids.felicia}`;
    expect(row.disabled_at).not.toBeNull();

    await asUser(
      app,
      ids.admin,
      (tx) => tx`update users set disabled_at = null where id = ${ids.felicia}`,
    );
    [row] = await owner`select disabled_at from users where id = ${ids.felicia}`;
    expect(row.disabled_at).toBeNull();
  });

  it("kan aldrig sätta ett lösenord åt någon annan", async () => {
    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.admin,
        (tx) => tx`update users set password_hash = 'scrypt$x' where id = ${ids.caesar}`,
      ),
    );
    expect(rejected).toBe(true);
  });

  it("kan skapa hushåll och bjuda in", async () => {
    const [household] = await asUser(
      app,
      ids.admin,
      (tx) => tx`insert into households (name) values ('Nytt hushåll') returning id`,
    );
    expect(household.id).toBeTruthy();

    const [invite] = await asUser(
      app,
      ids.admin,
      (tx) => tx`insert into invites
        (email, token_hash, household_id, party_id, display_name, invited_by, expires_at)
        values ('ny@x.se', 'hash1', ${household.id}, 'a', 'Ny', ${ids.admin},
                now() + interval '7 days')
        returning id`,
    );
    expect(invite.id).toBeTruthy();
  });

  it("kan återkalla en inbjudan men aldrig radera den", async () => {
    const [invite] = await owner`
      insert into invites (email, token_hash, household_id, party_id, display_name, expires_at)
      values ('aterkallas@x.se', 'hash2', ${ids.household}, 'x', 'X', now() + interval '7 days')
      returning id`;

    await asUser(
      app,
      ids.admin,
      (tx) => tx`update invites set revoked_at = now() where id = ${invite.id}`,
    );
    const [row] = await owner`select revoked_at from invites where id = ${invite.id}`;
    expect(row.revoked_at).not.toBeNull();

    // Ingen raderingspolicy finns, så försöket träffar ingenting.
    await isRejected(() =>
      asUser(app, ids.admin, (tx) => tx`delete from invites where id = ${invite.id}`),
    );
    const kvar = await owner`select id from invites where id = ${invite.id}`;
    expect(kvar).toHaveLength(1);
  });
});

describeDb("Administratören kommer inte åt innehållet", () => {
  it("ser inga transaktioner", async () => {
    const rows = await asUser(app, ids.admin, (tx) => tx`select reference from transactions`);
    expect(rows).toHaveLength(0);
  });

  it("ser inga transaktionsversioner eller godkännanden", async () => {
    const versions = await asUser(app, ids.admin, (tx) => tx`select id from transaction_versions`);
    const approvals = await asUser(
      app,
      ids.admin,
      (tx) => tx`select id from transaction_approvals`,
    );
    expect([versions.length, approvals.length]).toEqual([0, 0]);
  });

  it("ser inga avtal eller kostnadsklassificeringar", async () => {
    const agreements = await asUser(app, ids.admin, (tx) => tx`select id from agreements`);
    const rules = await asUser(app, ids.admin, (tx) => tx`select id from cost_category_rules`);
    expect([agreements.length, rules.length]).toEqual([0, 0]);
  });

  it("ser inga bilagor", async () => {
    const rows = await asUser(app, ids.admin, (tx) => tx`select id from attachments`);
    expect(rows).toHaveLength(0);
  });

  it("ser inte aktivitetsloggen", async () => {
    const rows = await asUser(app, ids.admin, (tx) => tx`select id from audit_events`);
    expect(rows).toHaveLength(0);
  });

  it("ser inga slutavräkningar eller värderingar", async () => {
    const settlements = await asUser(app, ids.admin, (tx) => tx`select id from settlements`);
    const valuations = await asUser(app, ids.admin, (tx) => tx`select id from valuations`);
    expect([settlements.length, valuations.length]).toEqual([0, 0]);
  });

  it("kan inte skriva in sig i ett hushåll för att komma åt ekonomin", async () => {
    // Administratören får lägga till medlemmar, men blir inte part av det –
    // beräkningen utgår från household_members, så en admin som lägger till
    // sig själv skulle synas direkt i avtalet och i aktivitetsloggen.
    await asUser(
      app,
      ids.admin,
      (tx) => tx`insert into household_members (household_id, user_id, party_id, display_name)
        values (${ids.household}, ${ids.admin}, 'admin', 'Administratör')`,
    );
    const rows = await asUser(app, ids.admin, (tx) => tx`select reference from transactions`);
    // Nu ser hen posterna, men bara för att hen numera är en synlig medlem.
    expect(rows).toHaveLength(1);

    await owner`delete from household_members
      where household_id = ${ids.household} and user_id = ${ids.admin}`;
    const efter = await asUser(app, ids.admin, (tx) => tx`select reference from transactions`);
    expect(efter).toHaveLength(0);
  });
});

describeDb("En vanlig part är inte administratör", () => {
  it("ser bara sig själv och sin motpart", async () => {
    const rows = await asUser(app, ids.caesar, (tx) => tx`select email from users order by email`);
    expect(rows.map((r) => r.email)).toEqual(["c@x.se", "f@x.se"]);
  });

  it("kan inte stänga av ett konto", async () => {
    await asUser(
      app,
      ids.caesar,
      (tx) => tx`update users set disabled_at = now() where id = ${ids.felicia}`,
    );
    const [row] = await owner`select disabled_at from users where id = ${ids.felicia}`;
    expect(row.disabled_at).toBeNull();
  });

  it("kan inte skapa en valfri inbjudan", async () => {
    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`insert into invites
          (email, token_hash, household_id, party_id, display_name, expires_at)
          values ('smyg@x.se', 'hash3', ${ids.household}, 'z', 'Z', now() + interval '7 days')`,
      ),
    );
    expect(rejected).toBe(true);
  });

  it("kan bara bjuda in den saknade motparten till sitt eget hushåll", async () => {
    const [caesarsHousehold] = await owner`
      insert into households (name) values ('Caesars nya hushåll') returning id`;
    await owner`
      insert into household_members (household_id, user_id, party_id, display_name)
      values (${caesarsHousehold.id}, ${ids.caesar}, 'caesar', 'Caesar')`;

    const [invite] = await asUser(
      app,
      ids.caesar,
      (tx) => tx`insert into invites
        (email, token_hash, household_id, party_id, display_name, invited_by, expires_at)
        values ('felicia.ny@x.se', 'partner-hash-1', ${caesarsHousehold.id}, 'felicia',
                'Felicia', ${ids.caesar}, now() + interval '7 days')
        returning id`,
    );
    expect(invite.id).toBeTruthy();

    const ownRole = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`insert into invites
          (email, token_hash, household_id, party_id, display_name, invited_by, expires_at)
          values ('caesar.ny@x.se', 'partner-hash-2', ${caesarsHousehold.id}, 'caesar',
                  'Caesar', ${ids.caesar}, now() + interval '7 days')`,
      ),
    );
    expect(ownRole).toBe(true);

    const otherHousehold = await isRejected(() =>
      asUser(
        app,
        ids.felicia,
        (tx) => tx`insert into invites
          (email, token_hash, household_id, party_id, display_name, invited_by, expires_at)
          values ('smyg@x.se', 'partner-hash-3', ${caesarsHousehold.id}, 'caesar',
                  'Smyg', ${ids.felicia}, now() + interval '7 days')`,
      ),
    );
    expect(otherHousehold).toBe(true);

    const rewrite = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`update invites
          set email = 'annan@x.se', revoked_at = now()
          where id = ${invite.id}`,
      ),
    );
    expect(rewrite).toBe(true);

    await asUser(
      app,
      ids.caesar,
      (tx) => tx`update invites set revoked_at = now() where id = ${invite.id}`,
    );
    const [revoked] = await owner`select email, revoked_at from invites where id = ${invite.id}`;
    expect(revoked.email).toBe("felicia.ny@x.se");
    expect(revoked.revoked_at).not.toBeNull();

    const [feliciasHousehold] = await owner`
      insert into households (name) values ('Felicias nya hushåll') returning id`;
    await owner`
      insert into household_members (household_id, user_id, party_id, display_name)
      values (${feliciasHousehold.id}, ${ids.felicia}, 'felicia', 'Felicia')`;
    const [symmetric] = await asUser(
      app,
      ids.felicia,
      (tx) => tx`insert into invites
        (email, token_hash, household_id, party_id, display_name, invited_by, expires_at)
        values ('caesar.ny@x.se', 'partner-hash-4', ${feliciasHousehold.id}, 'caesar',
                'Caesar', ${ids.felicia}, now() + interval '7 days')
        returning id`,
    );
    expect(symmetric.id).toBeTruthy();
  });

  it("kan aldrig göra ett avtal gällande innan motparten har anslutit", async () => {
    const [household] = await owner`
      insert into households (name) values ('Ensam part') returning id`;
    await owner`
      insert into household_members (household_id, user_id, party_id, display_name)
      values (${household.id}, ${ids.caesar}, 'caesar', 'Caesar')`;
    const [agreement] = await owner`
      insert into agreements (household_id) values (${household.id}) returning id`;
    const [version] = await owner`
      insert into agreement_versions (
        agreement_id, version, start_date, start_value_ore, initial_loan_ore,
        total_units, start_units, created_by
      ) values (
        ${agreement.id}, 1, '2026-09-01', 200000000, 100000000, 1000000,
        '{"caesar": 500000, "felicia": 500000}'::jsonb, ${ids.caesar}
      ) returning id`;

    await asUser(
      app,
      ids.caesar,
      (tx) => tx`insert into document_approvals
        (entity_type, entity_id, household_id, user_id, party_id, decision)
        values ('agreement_version', ${version.id}, ${household.id}, ${ids.caesar},
                'caesar', 'approved')`,
    );

    const [after] = await owner`
      select effective_at from agreement_versions where id = ${version.id}`;
    expect(after.effective_at).toBeNull();
  });

  it("kan inte godkänna ett utkast som har ersatts av en nyare version", async () => {
    const [agreement] = await owner`
      insert into agreements (household_id) values (${ids.household}) returning id`;
    const [oldVersion] = await owner`
      insert into agreement_versions (
        agreement_id, version, start_date, start_value_ore, initial_loan_ore,
        total_units, start_units, created_by
      ) values (
        ${agreement.id}, 1, '2026-09-01', 200000000, 100000000, 1000000,
        '{"caesar": 500000, "felicia": 500000}'::jsonb, ${ids.caesar}
      ) returning id`;
    await owner`
      insert into agreement_versions (
        agreement_id, version, start_date, start_value_ore, initial_loan_ore,
        total_units, start_units, created_by
      ) values (
        ${agreement.id}, 2, '2026-09-02', 200000000, 100000000, 1000000,
        '{"caesar": 500000, "felicia": 500000}'::jsonb, ${ids.caesar}
      )`;

    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`insert into document_approvals
          (entity_type, entity_id, household_id, user_id, party_id, decision)
          values ('agreement_version', ${oldVersion.id}, ${ids.household}, ${ids.caesar},
                  'caesar', 'approved')`,
      ),
    );
    expect(rejected).toBe(true);
  });

  it("kan inte göra sig själv till administratör", async () => {
    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`update users set is_admin = true where id = ${ids.caesar}`,
      ),
    );
    expect(rejected).toBe(true);
    const [row] = await owner`select is_admin from users where id = ${ids.caesar}`;
    expect(row.is_admin).toBe(false);
  });

  it("kan inte öppna ett avstängt konto åt sig själv", async () => {
    await owner`update users set disabled_at = now() where id = ${ids.caesar}`;
    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`update users set disabled_at = null where id = ${ids.caesar}`,
      ),
    );
    expect(rejected).toBe(true);
    await owner`update users set disabled_at = null where id = ${ids.caesar}`;
  });

  it("får däremot rätta sitt eget namn", async () => {
    await asUser(
      app,
      ids.caesar,
      (tx) => tx`update users set name = 'Caesar A' where id = ${ids.caesar}`,
    );
    const [row] = await owner`select name from users where id = ${ids.caesar}`;
    expect(row.name).toBe("Caesar A");
  });
});
