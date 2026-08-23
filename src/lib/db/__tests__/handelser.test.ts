import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newEncryptionKey } from "../../mail/crypto";
import { databaseAvailable, ownerSql } from "./helpers";

/**
 * Beskeden om att något hänt.
 *
 * Det som prövas är idempotensen. Nyckeln är härledd ur händelsen, aldrig ur
 * tidpunkten, så ett omladdat formulär, ett nytt försök efter ett avbrott
 * eller två samtidiga anrop ska ge ett mail - inte tre.
 *
 * Och att beskeden går till rätt person: den som registrerat en post ska inte
 * få ett mail om sin egen post.
 */
const DB = "mittochditt_handelser_test";

let owner: postgres.Sql;
let admin: postgres.Sql;

const ids = { nora: "", idris: "", household: "" };

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

let handelser: typeof import("../../mail/handelser.server");
let stangKopplingar: () => Promise<void>;

function ownerUrl(database: string): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const parsed = new URL(url);
    parsed.pathname = `/${database}`;
    return parsed.toString();
  }
  const host = process.env.TEST_PGHOST ?? "/tmp";
  const port = process.env.TEST_PGPORT ?? "5433";
  const user = process.env.TEST_PGUSER ?? "postgres";
  return `postgres://${user}@localhost/${database}?host=${encodeURIComponent(host)}&port=${port}`;
}

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
  const [h] = await owner`
    insert into households (name, party_a, party_b) values ('Nora & Idris', 'a', 'b') returning id`;
  ids.nora = n.id;
  ids.idris = i.id;
  ids.household = h.id;

  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.household}, ${ids.nora}, 'a', 'Nora'),
           (${ids.household}, ${ids.idris}, 'b', 'Idris')`;

  process.env.MAIL_QUEUE_ENCRYPTION_KEY = newEncryptionKey();
  process.env.DATABASE_URL = ownerUrl(DB);
  process.env.APP_URL = "https://x.se";
  handelser = await import("../../mail/handelser.server");
  stangKopplingar = (await import("../client.server")).closeConnections;
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await stangKopplingar?.();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

async function kon(mall?: string) {
  return mall
    ? owner`select recipient_email, idempotency_key from mail_messages
             where template = ${mall} order by idempotency_key`
    : owner`select recipient_email, template from mail_messages`;
}

describeDb("En post som väntar", () => {
  it("går till motparten, inte till den som registrerade", async () => {
    await handelser.notifieraPostVantar({
      householdId: ids.household,
      reference: "T-0001",
      version: 1,
      kostnadsslag: "Reparation",
      registeradAvPartyId: "a",
    });

    const rader = await kon("post_vantar");
    expect(rader).toHaveLength(1);
    // Nora registrerade, så Idris ska få beskedet.
    expect(rader[0].recipient_email).toBe("i@x.se");
  });

  it("samma händelse två gånger ger ett mail", async () => {
    // Ett omladdat formulär eller ett nytt försök efter ett avbrott.
    await handelser.notifieraPostVantar({
      householdId: ids.household,
      reference: "T-0001",
      version: 1,
      kostnadsslag: "Reparation",
      registeradAvPartyId: "a",
    });
    expect(await kon("post_vantar")).toHaveLength(1);
  });

  it("en korrigering är en ny händelse och ger ett nytt besked", async () => {
    await handelser.notifieraPostVantar({
      householdId: ids.household,
      reference: "T-0001",
      version: 2,
      kostnadsslag: "Reparation",
      registeradAvPartyId: "a",
    });
    expect(await kon("post_vantar")).toHaveLength(2);
  });
});

describeDb("Ett beslut om en post", () => {
  it("går till den som väntar på svar", async () => {
    await handelser.notifieraPostBeslutad({
      householdId: ids.household,
      reference: "T-0001",
      version: 1,
      beslut: "godkand",
      beslutadAvPartyId: "b",
    });
    const rader = await kon("post_beslutad");
    expect(rader).toHaveLength(1);
    expect(rader[0].recipient_email).toBe("n@x.se");
  });

  it("godkänt och invänt är två händelser", async () => {
    await handelser.notifieraPostBeslutad({
      householdId: ids.household,
      reference: "T-0001",
      version: 1,
      beslut: "invand",
      beslutadAvPartyId: "b",
    });
    expect(await kon("post_beslutad")).toHaveLength(2);
  });

  it("men samma beslut två gånger är en", async () => {
    await handelser.notifieraPostBeslutad({
      householdId: ids.household,
      reference: "T-0001",
      version: 1,
      beslut: "invand",
      beslutadAvPartyId: "b",
    });
    expect(await kon("post_beslutad")).toHaveLength(2);
  });
});

describeDb("Processdagen och fristerna", () => {
  it("processdagen går till båda parter", async () => {
    await handelser.notifieraProcessdag({
      householdId: ids.household,
      processId: "p1",
      processDate: "2026-09-01",
      slag: "dodsfall",
    });
    const rader = await kon("processdag");
    expect(rader.map((r) => r.recipient_email).sort()).toEqual(["i@x.se", "n@x.se"]);
  });

  it("en frist påminner en gång, inte varje dygn", async () => {
    // Nyckeln bär förfallodagen, inte dagens datum.
    for (let i = 0; i < 3; i += 1) {
      await handelser.notifieraFrist({
        householdId: ids.household,
        processId: "p1",
        frist: "Meddela övertagande",
        forfaller: "2026-10-01",
      });
    }
    const rader = await kon("processdag");
    // Två från processdagen plus två från fristen: en per part.
    expect(rader).toHaveLength(4);
  });
});

describeDb("Kontostatus", () => {
  it("avstängning och återaktivering är två händelser", async () => {
    await handelser.notifieraKontostatus({ userId: ids.nora, avstangt: true });
    await handelser.notifieraKontostatus({ userId: ids.nora, avstangt: true });
    expect(await kon("konto_status")).toHaveLength(1);

    await handelser.notifieraKontostatus({ userId: ids.nora, avstangt: false });
    expect(await kon("konto_status")).toHaveLength(2);
  });
});

describeDb("Avstängda konton får inga besked", () => {
  it("hoppas över som mottagare", async () => {
    await owner`update users set disabled_at = now() where id = ${ids.idris}`;
    await handelser.notifieraPostVantar({
      householdId: ids.household,
      reference: "T-0002",
      version: 1,
      kostnadsslag: "Reparation",
      registeradAvPartyId: "a",
    });

    const rader = await owner`
      select id from mail_messages where idempotency_key like 'post-vantar:T-0002:%'`;
    expect(rader).toHaveLength(0);
    await owner`update users set disabled_at = null where id = ${ids.idris}`;
  });
});

describeDb("Inga namn eller adresser i koden", () => {
  it("mottagarna kommer ur databasen", async () => {
    // Ett prov som skulle falla om någon hårdkodade en adress: hushållet här
    // heter något annat än exempeldatans, och beskeden gick ändå rätt.
    const rader = await owner`select distinct recipient_email from mail_messages`;
    expect(rader.map((r) => r.recipient_email).sort()).toEqual(["i@x.se", "n@x.se"]);
  });
});
