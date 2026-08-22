import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asUser, appSql, databaseAvailable, isRejected, ownerSql } from "./helpers";

/**
 * Boendekedjan.
 *
 * Ett par säljer och flyttar vidare, och tjänsten ska hänga med. Det som
 * prövas här är frågan varje anrop annars måste hitta på sitt eget svar på:
 * vilket avtal gäller nu. Och att schemat tillåter det läge som faktiskt
 * uppstår mitt i en flytt - två boenden samtidigt.
 */
const DB = "mittochditt_boendekedja_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = { nora: "", utom: "", household: "" };

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
  const [u] = await owner`insert into users (email, name) values ('u@x.se', 'Utom') returning id`;
  ids.nora = n.id;
  ids.utom = u.id;

  const [h] = await owner`
    insert into households (name, party_a, party_b)
    values ('Nora & Idris', 'nora', 'idris') returning id`;
  ids.household = h.id;
  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.household}, ${ids.nora}, 'nora', 'Nora')`;

  app = appSql(DB);
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await app?.end();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

async function nyttBoende(adress: string, kind: string, från: string | null, till: string | null) {
  const [rad] = await owner`
    insert into properties (household_id, address, kind, acquired_on, disposed_on)
    values (${ids.household}, ${adress}, ${kind}, ${från}, ${till})
    returning id`;
  return rad.id as string;
}

async function nyttAvtal(propertyId: string | null) {
  const [rad] = await owner`
    insert into agreements (household_id, property_id)
    values (${ids.household}, ${propertyId}) returning id`;
  return rad.id as string;
}

/** Samma fråga som applikationen ställer, som en inloggad part. */
async function gällandeAvtal(userId: string) {
  const [rad] = await asUser(
    app,
    userId,
    (tx) => tx`select current_agreement_id(${ids.household}) as id`,
  );
  return rad.id as string | null;
}

async function nollställ() {
  await owner`delete from agreements where household_id = ${ids.household}`;
  await owner`delete from properties where household_id = ${ids.household}`;
}

describeDb("Vilket avtal som gäller nu", () => {
  it("ett boende ger sitt eget avtal", async () => {
    await nollställ();
    const bostad = await nyttBoende("Sjötullsgatan 4", "bostadsratt", "2026-01-01", null);
    const avtal = await nyttAvtal(bostad);
    expect(await gällandeAvtal(ids.nora)).toBe(avtal);
  });

  it("efter en flytt gäller det nya boendets avtal", async () => {
    await nollställ();
    const första = await nyttBoende("Sjötullsgatan 4", "bostadsratt", "2026-01-01", "2029-05-02");
    const gammalt = await nyttAvtal(första);
    const andra = await nyttBoende("Bergsgatan 9", "fastighet", "2029-05-01", null);
    const nytt = await nyttAvtal(andra);

    const gäller = await gällandeAvtal(ids.nora);
    expect(gäller).toBe(nytt);
    expect(gäller).not.toBe(gammalt);
  });

  it("mitt i flytten, med två boenden samtidigt, gäller det senast tillträdda", async () => {
    // Tillträdet till det nya kommer före försäljningen av det gamla. Just
    // därför finns ingen spärr mot två samtidiga boenden - den hade brustit
    // precis här.
    await nollställ();
    const gamla = await nyttBoende("Sjötullsgatan 4", "bostadsratt", "2026-01-01", null);
    await nyttAvtal(gamla);
    const nya = await nyttBoende("Bergsgatan 9", "fastighet", "2029-05-01", null);
    const nyttAvtalId = await nyttAvtal(nya);

    expect(await gällandeAvtal(ids.nora)).toBe(nyttAvtalId);
  });

  it("ett avtal utan bostad gäller innan uppstarten är klar", async () => {
    await nollställ();
    const utanBostad = await nyttAvtal(null);
    expect(await gällandeAvtal(ids.nora)).toBe(utanBostad);
  });

  it("en avyttrad bostad ensam lämnar ändå ett svar", async () => {
    // Mellan försäljning och nästa tillträde finns ingen aktuell bostad. Frågan
    // måste ändå gå att ställa - underlaget ligger kvar och ska gå att läsa.
    await nollställ();
    const såld = await nyttBoende("Sjötullsgatan 4", "bostadsratt", "2026-01-01", "2029-05-02");
    const avtal = await nyttAvtal(såld);
    expect(await gällandeAvtal(ids.nora)).toBe(avtal);
  });

  it("någon utanför hushållet får inget avtal alls", async () => {
    await nollställ();
    const bostad = await nyttBoende("Sjötullsgatan 4", "bostadsratt", "2026-01-01", null);
    await nyttAvtal(bostad);
    expect(await gällandeAvtal(ids.utom)).toBeNull();
  });
});

describeDb("Vad slags bostad", () => {
  it("godtar bostadsrätt och fastighet, men inte något tredje", async () => {
    await nollställ();
    await nyttBoende("Sjötullsgatan 4", "bostadsratt", "2026-01-01", null);
    await nyttBoende("Bergsgatan 9", "fastighet", "2029-05-01", null);
    const avvisad = await isRejected(() => nyttBoende("Månen 1", "rymdstation", null, null));
    expect(avvisad).toBe(true);
  });

  it("förvalet är bostadsrätt, så befintliga bostäder inte byter slag", async () => {
    await nollställ();
    const [rad] = await owner`
      insert into properties (household_id, address) values (${ids.household}, 'Utan slag')
      returning kind`;
    expect(rad.kind).toBe("bostadsratt");
  });

  it("avyttring före tillträde avvisas", async () => {
    const avvisad = await isRejected(() =>
      nyttBoende("Bakvänt 1", "bostadsratt", "2029-05-01", "2026-01-01"),
    );
    expect(avvisad).toBe(true);
  });
});
