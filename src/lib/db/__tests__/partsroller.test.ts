import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asUser, appSql, databaseAvailable, isRejected, ownerSql } from "./helpers";

/**
 * Hushållets partsroller.
 *
 * Tjänsten ska kunna användas av vilket par som helst. Partsnyckeln är en
 * intern nyckel - den står inuti transaktionernas payments och avtalets
 * start_units - och får därför aldrig behöva heta något särskilt.
 *
 * Det som prövas här är just det som en rättad applikationskod inte kan visa
 * på egen hand: att också radnivåsäkerheten släpper fram ett par med andra
 * namn, och fortfarande spärrar det den ska spärra.
 */
const DB = "mittochditt_partsroller_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = { nora: "", idris: "", utom: "", nyttHushall: "", gammaltHushall: "" };

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const OM_ETT_DYGN = new Date(Date.now() + 86_400_000);

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
  const [i] = await owner`insert into users (email, name) values ('i@x.se', 'Idris') returning id`;
  const [u] = await owner`insert into users (email, name) values ('u@x.se', 'Utom') returning id`;
  ids.nora = n.id;
  ids.idris = i.id;
  ids.utom = u.id;

  // Ett par som inte heter som det första hushållet, med egna partsnycklar.
  const [nytt] = await owner`
    insert into households (name, party_a, party_b)
    values ('Nora & Idris', 'nora', 'idris') returning id`;
  ids.nyttHushall = nytt.id;
  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.nyttHushall}, ${ids.nora}, 'nora', 'Nora')`;

  // Och ett hushåll med de gamla nycklarna, som fortfarande ska fungera.
  const [gammalt] = await owner`
    insert into households (name, party_a, party_b)
    values ('Det första', 'caesar', 'felicia') returning id`;
  ids.gammaltHushall = gammalt.id;
  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.gammaltHushall}, ${ids.utom}, 'caesar', 'Utom')`;

  app = appSql(DB);
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await app?.end();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

/** Bjuder in en roll till ett hushåll, som en inloggad part. */
function bjudIn(userId: string, householdId: string, partyId: string, nyckel: string) {
  return asUser(
    app,
    userId,
    (tx) => tx`insert into invites
      (email, token_hash, household_id, party_id, display_name, invited_by, expires_at)
      values ('ny@x.se', ${nyckel}, ${householdId}, ${partyId}, 'Ny', ${userId}, ${OM_ETT_DYGN})`,
  );
}

describeDb("Rollerna står på hushållet", () => {
  it("ett nytt hushåll får två skilda roller utan att någon anger dem", async () => {
    const [rad] = await owner`
      insert into households (name) values ('Utan angivna roller')
      returning party_a, party_b`;
    expect(rad.party_a).toBe("a");
    expect(rad.party_b).toBe("b");
  });

  it("samma roll två gånger avvisas", async () => {
    const avvisad = await isRejected(
      () => owner`insert into households (name, party_a, party_b) values ('Fel', 'x', 'x')`,
    );
    expect(avvisad).toBe(true);
  });
});

describeDb("En part får bjuda in sin motpart, vad rollerna än heter", () => {
  it("släpper igenom motparten i ett hushåll med egna nycklar", async () => {
    await bjudIn(ids.nora, ids.nyttHushall, "idris", "nyckel-idris");
    const rader = await owner`
      select party_id from invites where household_id = ${ids.nyttHushall}`;
    expect(rader.map((r) => r.party_id)).toEqual(["idris"]);
  });

  it("släpper fortfarande igenom det första hushållets nycklar", async () => {
    await bjudIn(ids.utom, ids.gammaltHushall, "felicia", "nyckel-felicia");
    const rader = await owner`
      select party_id from invites where household_id = ${ids.gammaltHushall}`;
    expect(rader.map((r) => r.party_id)).toEqual(["felicia"]);
  });

  it("nekar en roll som inte är hushållets", async () => {
    // Rätten gäller hushållets två roller, inte vilken sträng som helst. Utan
    // det här kunde en part skapa en tredje part i sitt eget hushåll.
    const avvisad = await isRejected(() =>
      bjudIn(ids.nora, ids.nyttHushall, "en_tredje", "nyckel-tredje"),
    );
    expect(avvisad).toBe(true);
  });

  it("nekar sin egen roll", async () => {
    const avvisad = await isRejected(() =>
      bjudIn(ids.nora, ids.nyttHushall, "nora", "nyckel-egen"),
    );
    expect(avvisad).toBe(true);
  });

  it("nekar en roll som redan är upptagen", async () => {
    await owner`insert into household_members (household_id, user_id, party_id, display_name)
      values (${ids.nyttHushall}, ${ids.idris}, 'idris', 'Idris')`;
    const avvisad = await isRejected(() =>
      bjudIn(ids.nora, ids.nyttHushall, "idris", "nyckel-upptagen"),
    );
    expect(avvisad).toBe(true);
  });

  it("nekar någon utanför hushållet", async () => {
    const avvisad = await isRejected(() =>
      bjudIn(ids.utom, ids.nyttHushall, "idris", "nyckel-utom"),
    );
    expect(avvisad).toBe(true);
  });
});

describeDb("Ett hushåll som redan fanns behåller sina nycklar", () => {
  /**
   * Migreringen körs en gång, och gör den fel går det inte att ta tillbaka:
   * nycklarna står inuti transaktionernas payments, så ett hushåll som får
   * 'a' och 'b' påtvingade skulle tappa kontakten med sin egen historik.
   *
   * Satsen läses ur migreringsfilen i stället för att skrivas av, så provet
   * inte kan glida isär från det som faktiskt körs i drift.
   */
  async function ombackfyllningen(): Promise<string> {
    const fil = await readFile("db/migrations/0016_partsroller.sql", "utf8");
    const del = fil.split(/;\s*\n/).find((stycke) => stycke.includes("with slots as"));
    if (!del) throw new Error("Hittade inte ombackfyllningen i migreringen.");
    // Klipp bort kommentarsblocket som står före satsen.
    return del.slice(del.indexOf("with slots as"));
  }

  it("ger tillbaka de gamla nycklarna, i den ordning parterna kom in", async () => {
    // Läget före migreringen: rollerna satta till förvalet, medlemmarna kvar.
    await owner`update households set party_a = 'a', party_b = 'b'
                 where id = ${ids.gammaltHushall}`;

    await owner.unsafe(await ombackfyllningen());

    const [rad] = await owner`
      select party_a, party_b from households where id = ${ids.gammaltHushall}`;
    expect(rad.party_a).toBe("caesar");
    expect(rad.party_b).toBe("felicia");
  });

  it("ger ett halvfärdigt hushåll en andra roll som inte krockar", async () => {
    // Bara den ena parten har anslutit än. Den andra rollen måste ändå bli
    // till, och får inte bli samma som den första.
    const [ensamt] = await owner`
      insert into households (name, party_a, party_b) values ('Ensamt', 'a', 'b') returning id`;
    const [en] = await owner`insert into users (email, name)
      values ('e@x.se', 'En') returning id`;
    await owner`insert into household_members (household_id, user_id, party_id, display_name)
      values (${ensamt.id}, ${en.id}, 'b', 'En')`;

    await owner.unsafe(await ombackfyllningen());

    const [rad] = await owner`select party_a, party_b from households where id = ${ensamt.id}`;
    expect(rad.party_a).toBe("b");
    expect(rad.party_b).not.toBe("b");
  });
});
