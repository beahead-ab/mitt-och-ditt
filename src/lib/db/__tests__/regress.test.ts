import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asUser, appSql, databaseAvailable, isRejected, ownerSql } from "./helpers";

/**
 * Regressfordran och referensräntan.
 *
 * Att framställa ett krav är den enes ensidiga handling - motparten behöver
 * inte godkänna det - men just därför måste spärrarna sitta rätt: ingen ska
 * kunna framställa ett krav i någon annans namn, och en reglering ska inte gå
 * att ta tillbaka.
 */
const DB = "mittochditt_regress_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = { caesar: "", felicia: "", utom: "", adminUser: "", household: "" };

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
  const [a] = await owner`
    insert into users (email, name, is_admin) values ('a@x.se', 'Admin', true) returning id`;
  const [h] = await owner`
    insert into households (name, party_a, party_b)
    values ('Caesar & Felicia', 'caesar', 'felicia') returning id`;
  ids.caesar = c.id;
  ids.felicia = f.id;
  ids.utom = u.id;
  ids.adminUser = a.id;
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

function framstall(userId: string, borgenar: string, gäldenär: string, dag = "2026-06-01") {
  return asUser(
    app,
    userId,
    (tx) => tx`insert into regress_claims
      (household_id, creditor_party_id, debtor_party_id, amount_ore, demanded_on, created_by)
      values (${ids.household}, ${borgenar}, ${gäldenär}, 10000000, ${dag}, ${userId})
      returning id`,
  );
}

describeDb("Att framställa ett krav", () => {
  it("går för egen räkning", async () => {
    const [rad] = await framstall(ids.caesar, "caesar", "felicia", "2026-06-01");
    expect(rad.id).toBeTruthy();
  });

  it("går inte i motpartens namn", async () => {
    // Att kunna registrera en fordran åt någon annan vore att skriva under åt
    // den personen.
    const avvisad = await isRejected(() =>
      framstall(ids.caesar, "felicia", "caesar", "2026-06-02"),
    );
    expect(avvisad).toBe(true);
  });

  it("går inte för någon utanför hushållet", async () => {
    const avvisad = await isRejected(() => framstall(ids.utom, "caesar", "felicia", "2026-06-03"));
    expect(avvisad).toBe(true);
  });

  it("kräver ett belopp större än noll", async () => {
    const avvisad = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`insert into regress_claims
            (household_id, creditor_party_id, debtor_party_id, amount_ore, demanded_on, created_by)
            values (${ids.household}, 'caesar', 'felicia', 0, '2026-06-04', ${ids.caesar})`,
      ),
    );
    expect(avvisad).toBe(true);
  });

  it("syns inte för någon utanför hushållet", async () => {
    const synliga = await asUser(
      app,
      ids.utom,
      (tx) => tx`select id from regress_claims where household_id = ${ids.household}`,
    );
    expect(synliga).toHaveLength(0);
  });
});

describeDb("Att reglera en fordran", () => {
  async function nyFordran(dag: string) {
    const [rad] = await framstall(ids.caesar, "caesar", "felicia", dag);
    return rad.id as string;
  }

  function reglera(userId: string, id: string, belopp = 10000000) {
    return asUser(
      app,
      userId,
      (tx) => tx`update regress_claims
        set settled_on = '2026-08-01', settled_amount_ore = ${belopp}
        where id = ${id}`,
    );
  }

  it("kan göras av borgenären", async () => {
    const id = await nyFordran("2026-07-01");
    await reglera(ids.caesar, id);
    const [rad] = await owner`select settled_on from regress_claims where id = ${id}`;
    expect(rad.settled_on).not.toBeNull();
  });

  it("kan inte göras av gäldenären", async () => {
    // Den som är skyldig ska inte kunna förklara skulden reglerad.
    const id = await nyFordran("2026-07-02");
    await reglera(ids.felicia, id);
    const [rad] = await owner`select settled_on from regress_claims where id = ${id}`;
    expect(rad.settled_on).toBeNull();
  });

  it("går inte att ta tillbaka", async () => {
    const id = await nyFordran("2026-07-03");
    await reglera(ids.caesar, id, 10000000);

    await asUser(
      app,
      ids.caesar,
      (tx) => tx`update regress_claims set settled_on = null, settled_amount_ore = null
        where id = ${id}`,
    );
    const [rad] = await owner`select settled_on from regress_claims where id = ${id}`;
    expect(rad.settled_on).not.toBeNull();
  });

  it("kan inte raderas av någon", async () => {
    const id = await nyFordran("2026-07-04");
    await asUser(app, ids.caesar, (tx) => tx`delete from regress_claims where id = ${id}`);
    const rader = await owner`select id from regress_claims where id = ${id}`;
    expect(rader).toHaveLength(1);
  });
});

describeDb("Referensräntan", () => {
  it("är läsbar för alla, eftersom den är en offentlig uppgift", async () => {
    await owner`insert into reference_rates (from_date, percent, source)
      values ('2026-01-01', 2.0, 'Riksbanken')`;

    const synliga = await asUser(
      app,
      ids.caesar,
      (tx) => tx`select percent from reference_rates where from_date = '2026-01-01'`,
    );
    expect(Number(synliga[0].percent)).toBe(2);
  });

  it("kan inte skrivas av en part", async () => {
    // En part som kan ändra referensräntan kan ändra sin egen skuld.
    const avvisad = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`insert into reference_rates (from_date, percent)
            values ('2027-01-01', 0.1)`,
      ),
    );
    expect(avvisad).toBe(true);
  });

  it("kan skrivas av administratören", async () => {
    await asUser(
      app,
      ids.adminUser,
      (tx) => tx`insert into reference_rates (from_date, percent, source)
        values ('2027-07-01', 4.0, 'Riksbanken')`,
    );
    const [rad] = await owner`select percent from reference_rates where from_date = '2027-07-01'`;
    expect(Number(rad.percent)).toBe(4);
  });

  it("kan inte ha två satser från samma dag", async () => {
    const avvisad = await isRejected(
      () => owner`insert into reference_rates (from_date, percent) values ('2026-01-01', 3.0)`,
    );
    expect(avvisad).toBe(true);
  });
});
