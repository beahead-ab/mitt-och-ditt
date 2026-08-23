import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { valjAktivt } from "@/lib/aktivt-hushall";
import { asUser, appSql, databaseAvailable, ownerSql } from "./helpers";

/**
 * En användare i två hushåll.
 *
 * Det verkliga fallet: någon äger en bostad med sin partner och en annan med
 * ett syskon. Tjänsten visade tidigare bara det första och det gick inte att
 * byta. Nu finns en väljare - och då måste det bevisas att ingenting blandas.
 *
 * Proven ställer samma frågor som applikationen ställer, en gång per hushåll,
 * och kräver att svaren hålls isär.
 */
const DB = "mittochditt_flera_hushall_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = {
  nora: "",
  partner: "",
  syskon: "",
  hemma: "",
  huset: "",
  hemmaAvtal: "",
  husetAvtal: "",
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

  const [n] = await owner`insert into users (email, name) values ('n@x.se', 'Nora') returning id`;
  const [p] = await owner`insert into users (email, name) values ('p@x.se', 'Idris') returning id`;
  const [sy] =
    await owner`insert into users (email, name) values ('s@x.se', 'Syskon') returning id`;
  ids.nora = n.id;
  ids.partner = p.id;
  ids.syskon = sy.id;

  // Hushåll ett: bostaden med partnern.
  const [h1] = await owner`
    insert into households (name, party_a, party_b)
    values ('Nora & Idris', 'a', 'b') returning id`;
  ids.hemma = h1.id;
  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.hemma}, ${ids.nora}, 'a', 'Nora'),
           (${ids.hemma}, ${ids.partner}, 'b', 'Idris')`;

  // Hushåll två: huset med syskonet.
  const [h2] = await owner`
    insert into households (name, party_a, party_b)
    values ('Syskonens hus', 'a', 'b') returning id`;
  ids.huset = h2.id;
  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.huset}, ${ids.nora}, 'a', 'Nora'),
           (${ids.huset}, ${ids.syskon}, 'b', 'Syskon')`;

  // Ett avtal med olika startvärde i vardera, så en förväxling syns direkt.
  for (const [hushall, startvarde, nyckel] of [
    [ids.hemma, 450000000, "hemmaAvtal"],
    [ids.huset, 900000000, "husetAvtal"],
  ] as const) {
    const [a] = await owner`
      insert into agreements (household_id) values (${hushall}) returning id`;
    ids[nyckel] = a.id;
    await owner`
      insert into agreement_versions
        (agreement_id, version, start_date, start_value_ore, initial_loan_ore, total_units,
         start_units, created_by, effective_at, checksum)
      values (${a.id}, 1, '2026-01-15', ${startvarde}, 100000000, 1000000,
              '{"a":600000,"b":400000}'::jsonb, ${ids.nora}, now(), ${"summa-" + nyckel})`;

    const [tx] = await owner`
      insert into transactions (household_id, reference, created_by)
      values (${hushall}, ${"T-" + nyckel}, ${ids.nora}) returning id`;
    await owner`
      insert into transaction_versions
        (transaction_id, version, status, payment_date, category, payments, created_by,
         effective_at)
      values (${tx.id}, 1, 'approved', '2026-02-01', 'Reparation',
              '{"a": {"gross": 100000}}'::jsonb, ${ids.nora}, now())`;
  }

  app = appSql(DB);
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await app?.end();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

describeDb("Nora ser båda sina hushåll", () => {
  it("listan innehåller båda", async () => {
    const rader = await asUser(
      app,
      ids.nora,
      (tx) => tx`select h.id, h.name from households h
                 join household_members m on m.household_id = h.id
                where m.user_id = ${ids.nora} order by h.name`,
    );
    expect(rader.map((r) => r.name)).toEqual(["Nora & Idris", "Syskonens hus"]);
  });

  it("och väljaren visas därför", () => {
    expect(valjAktivt([{ id: ids.hemma }, { id: ids.huset }], null).visaValjare).toBe(true);
  });
});

describeDb("Uppgifterna hålls isär", () => {
  it("varje hushåll har sitt eget gällande avtal", async () => {
    const [hemma] = await asUser(
      app,
      ids.nora,
      (tx) => tx`select current_agreement_id(${ids.hemma}) as id`,
    );
    const [huset] = await asUser(
      app,
      ids.nora,
      (tx) => tx`select current_agreement_id(${ids.huset}) as id`,
    );
    expect(hemma.id).toBe(ids.hemmaAvtal);
    expect(huset.id).toBe(ids.husetAvtal);
    expect(hemma.id).not.toBe(huset.id);
  });

  it("startvärdet följer det hushåll man frågar om", async () => {
    // Samma fråga som applikationen ställer, en gång per hushåll.
    async function startvarde(hushall: string) {
      const rader = await asUser(
        app,
        ids.nora,
        (tx) => tx`select v.start_value_ore from agreement_versions v
                    where v.agreement_id = current_agreement_id(${hushall})
                      and v.effective_at is not null
                    order by v.version desc limit 1`,
      );
      return String(rader[0].start_value_ore);
    }

    expect(await startvarde(ids.hemma)).toBe("450000000");
    expect(await startvarde(ids.huset)).toBe("900000000");
  });

  it("transaktionerna blandas inte", async () => {
    async function referenser(hushall: string) {
      const rader = await asUser(
        app,
        ids.nora,
        (tx) => tx`select reference from transactions where household_id = ${hushall}`,
      );
      return rader.map((r) => r.reference);
    }

    expect(await referenser(ids.hemma)).toEqual(["T-hemmaAvtal"]);
    expect(await referenser(ids.huset)).toEqual(["T-husetAvtal"]);
  });
});

describeDb("De andra parterna ser bara sitt eget", () => {
  it("Idris når inte syskonens hus", async () => {
    const rader = await asUser(
      app,
      ids.partner,
      (tx) => tx`select id from households where id = ${ids.huset}`,
    );
    expect(rader).toHaveLength(0);
  });

  it("syskonet når inte bostaden med partnern", async () => {
    const rader = await asUser(
      app,
      ids.syskon,
      (tx) => tx`select reference from transactions where household_id = ${ids.hemma}`,
    );
    expect(rader).toHaveLength(0);
  });

  it("och ser därför ingen väljare", () => {
    expect(valjAktivt([{ id: ids.hemma }], null).visaValjare).toBe(false);
  });
});

describeDb("Ett hushåll som försvinner ligger inte kvar som aktivt", () => {
  it("valet faller tillbaka på ett hushåll som finns", async () => {
    // Nora tas bort ur syskonens hus.
    await owner`delete from household_members
                 where household_id = ${ids.huset} and user_id = ${ids.nora}`;

    const rader = await asUser(
      app,
      ids.nora,
      (tx) => tx`select h.id from households h
                 join household_members m on m.household_id = h.id
                where m.user_id = ${ids.nora}`,
    );
    const kvar = rader.map((r) => ({ id: r.id as string }));

    // Det sparade valet pekar på huset, som inte längre finns i listan.
    const val = valjAktivt(kvar, ids.huset);
    expect(val.aktivt?.id).toBe(ids.hemma);
    expect(val.rensaSparat).toBe(true);
    expect(val.visaValjare).toBe(false);
  });
});
