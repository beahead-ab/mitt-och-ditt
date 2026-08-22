import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asUser, appSql, databaseAvailable, isRejected, ownerSql } from "./helpers";

/**
 * Tilläggsavtal.
 *
 * Kärnan som prövas: en ny avtalsversion får inte börja gälla förrän båda
 * parter bekräftat samma handling, administratören kan inte bekräfta åt någon,
 * och ett tillägg som börjat gälla är låst.
 */
const DB = "mittochditt_tillagg_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = {
  admin: "",
  caesar: "",
  felicia: "",
  household: "",
  agreement: "",
  version1: "",
  attachment: "",
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

  const [a] = await owner`
    insert into users (email, name, is_admin) values ('a@x.se', 'Administratör', true) returning id`;
  const [c] = await owner`insert into users (email, name) values ('c@x.se', 'Caesar') returning id`;
  const [f] =
    await owner`insert into users (email, name) values ('f@x.se', 'Felicia') returning id`;
  const [h] = await owner`insert into households (name) values ('Caesar & Felicia') returning id`;
  ids.admin = a.id;
  ids.caesar = c.id;
  ids.felicia = f.id;
  ids.household = h.id;

  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.household}, ${ids.caesar}, 'caesar', 'Caesar'),
           (${ids.household}, ${ids.felicia}, 'felicia', 'Felicia')`;

  const [ag] = await owner`
    insert into agreements (household_id) values (${ids.household}) returning id`;
  ids.agreement = ag.id;

  const [v1] = await owner`
    insert into agreement_versions
      (agreement_id, version, start_date, start_value_ore, initial_loan_ore, total_units,
       start_units, created_by, effective_at, checksum)
    values (${ids.agreement}, 1, '2026-01-01', 500000000, 300000000, 2000000,
            '{"caesar":1200000,"felicia":800000}', ${ids.caesar}, now(), 'summa-v1')
    returning id`;
  ids.version1 = v1.id;

  const [bilaga] = await owner`
    insert into attachments
      (household_id, filename, content_type, storage_key, byte_size, sha256, uploaded_by)
    values (${ids.household}, 'tillagg.pdf', 'application/pdf', 'x/y.pdf', 1024,
            ${"a".repeat(64)}, ${ids.caesar})
    returning id`;
  ids.attachment = bilaga.id;
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await app?.end();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

/** Skapar ett tillägg med en kopplad avtalsversion som utkast. */
async function nyttTillagg(titel: string): Promise<{ tillagg: string; version: string }> {
  const [t] = await owner`
    insert into agreement_addenda
      (agreement_id, household_id, title, signed_on, summary, applies_from, affected,
       document_sha256, attachment_id, created_by)
    values (${ids.agreement}, ${ids.household}, ${titel}, '2026-03-01',
            'Startvärdet justeras.', '2026-04-01', ${["Startvärde"]},
            ${"a".repeat(64)}, ${ids.attachment}, ${ids.caesar})
    returning id`;

  const [v] = await owner`
    insert into agreement_versions
      (agreement_id, version, start_date, start_value_ore, initial_loan_ore, total_units,
       start_units, created_by, addendum_id, checksum)
    values (${ids.agreement}, (select max(version) + 1 from agreement_versions
                                where agreement_id = ${ids.agreement}),
            '2026-04-01', 600000000, 300000000, 2000000,
            '{"caesar":1200000,"felicia":800000}', ${ids.caesar}, ${t.id}, ${"summa-" + titel})
    returning id`;

  return { tillagg: t.id, version: v.id };
}

/** Bekräftar som en part, precis som applikationen gör det. */
async function bekrafta(userId: string, partyId: string, addendumId: string) {
  return asUser(
    app,
    userId,
    (tx) => tx`insert into document_approvals
      (entity_type, entity_id, household_id, user_id, party_id, decision)
      values ('addendum', ${addendumId}, ${ids.household}, ${userId}, ${partyId}, 'approved')`,
  );
}

describeDb("Ett tilläggsavtal börjar gälla först när båda bekräftat", () => {
  beforeAll(() => {
    app = appSql(DB);
  });

  it("den första bekräftelsen sätter varken tillägget eller versionen i kraft", async () => {
    const { tillagg, version } = await nyttTillagg("Ett");
    await bekrafta(ids.caesar, "caesar", tillagg);

    const [t] = await owner`select effective_at from agreement_addenda where id = ${tillagg}`;
    const [v] = await owner`select effective_at from agreement_versions where id = ${version}`;
    expect(t.effective_at).toBeNull();
    expect(v.effective_at).toBeNull();
  });

  it("den andra bekräftelsen sätter både tillägget och versionen i kraft", async () => {
    const { tillagg, version } = await nyttTillagg("Två");
    await bekrafta(ids.caesar, "caesar", tillagg);
    await bekrafta(ids.felicia, "felicia", tillagg);

    const [t] = await owner`select effective_at from agreement_addenda where id = ${tillagg}`;
    const [v] = await owner`select effective_at from agreement_versions where id = ${version}`;
    expect(t.effective_at).not.toBeNull();
    expect(v.effective_at).not.toBeNull();
  });

  it("samma part kan inte bekräfta två gånger för att komma runt kravet", async () => {
    const { tillagg, version } = await nyttTillagg("Tre");
    await bekrafta(ids.caesar, "caesar", tillagg);
    const avvisad = await isRejected(() => bekrafta(ids.caesar, "caesar", tillagg));
    expect(avvisad).toBe(true);

    const [v] = await owner`select effective_at from agreement_versions where id = ${version}`;
    expect(v.effective_at).toBeNull();
  });

  it("en part kan inte bekräfta i motpartens namn", async () => {
    const { tillagg } = await nyttTillagg("Fyra");
    const avvisad = await isRejected(() => bekrafta(ids.caesar, "felicia", tillagg));
    expect(avvisad).toBe(true);
  });

  it("administratören kan varken bekräfta eller kringgå spärren", async () => {
    const { tillagg, version } = await nyttTillagg("Fem");
    await bekrafta(ids.caesar, "caesar", tillagg);

    const avvisad = await isRejected(() => bekrafta(ids.admin, "caesar", tillagg));
    expect(avvisad).toBe(true);

    // Inte heller genom att sätta versionen i kraft direkt.
    const direkt = await isRejected(() =>
      asUser(
        app,
        ids.admin,
        (tx) => tx`update agreement_versions set effective_at = now() where id = ${version}`,
      ),
    );
    const [v] = await owner`select effective_at from agreement_versions where id = ${version}`;
    expect(direkt || v.effective_at === null).toBe(true);
    expect(v.effective_at).toBeNull();
  });
});

describeDb("Ett tillägg som börjat gälla är låst", () => {
  it("kan inte ändras ens av ägaren", async () => {
    const { tillagg } = await nyttTillagg("Sex");
    await bekrafta(ids.caesar, "caesar", tillagg);
    await bekrafta(ids.felicia, "felicia", tillagg);

    const avvisad = await isRejected(
      () => owner`update agreement_addenda set title = 'ändrat' where id = ${tillagg}`,
    );
    expect(avvisad).toBe(true);
  });

  it("kan inte tas bort", async () => {
    const { tillagg } = await nyttTillagg("Sju");
    await bekrafta(ids.caesar, "caesar", tillagg);
    await bekrafta(ids.felicia, "felicia", tillagg);

    const avvisad = await isRejected(
      () => owner`delete from agreement_addenda where id = ${tillagg}`,
    );
    expect(avvisad).toBe(true);
  });
});

describeDb("Godkännandemaskinen gissar inte", () => {
  it("säger ifrån vid ett okänt slag i stället för att uppdatera fel tabell", async () => {
    // Skyddar mot det som en gång hände när slutavräkningar tillkom och hamnade
    // i en else-gren som hörde till något annat.
    const [rad] = await owner`
      select prosrc from pg_proc where proname = 'apply_document_approval'`;
    expect(rad.prosrc).toContain("Okänt slag av godkännande");
    expect(rad.prosrc).toContain("elsif new.entity_type = 'addendum'");
  });
});
