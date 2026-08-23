import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { newEncryptionKey } from "../../mail/crypto";
import { databaseAvailable, ownerSql } from "./helpers";

/**
 * De dagliga svepen mot riktig data.
 *
 * Det som prövas är att en påminnelse går ut en gång per punkt - inte varje
 * gång svepet kör - och att veckosammanfattningen tiger när det inte finns
 * något att säga. Båda är sådant som bara syns i drift om det är fel, och då
 * som en inkorg full av samma mail.
 */
const DB = "mittochditt_svep_test";

let owner: postgres.Sql;
let admin: postgres.Sql;

const ids = { nora: "", idris: "", ensam: "", hushall: "", andra: "", process: "" };

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

let svep: typeof import("../../mail/svep.server");
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

/**
 * Processdagen 2026-09-01 ger besked om övertagande senast 2026-09-15
 * (fjorton dagar) och genomförd försäljning senast 2026-12-01 (tre månader).
 * Punkterna för övertagandet blir alltså 09-01, 09-08, 09-14 och 09-16.
 */
const PROCESSDAG = "2026-09-01";
const P14 = new Date("2026-09-01T09:00:00Z");
const P7 = new Date("2026-09-08T09:00:00Z");
const MELLAN = new Date("2026-09-05T09:00:00Z");
const FORFALLEN = new Date("2026-09-16T09:00:00Z");
const IDAG = P14;

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
  const [e] = await owner`insert into users (email, name) values ('e@x.se', 'Ensam') returning id`;
  ids.nora = n.id;
  ids.idris = i.id;
  ids.ensam = e.id;

  const [h] = await owner`
    insert into households (name, party_a, party_b) values ('Nora & Idris', 'a', 'b') returning id`;
  ids.hushall = h.id;
  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.hushall}, ${ids.nora}, 'a', 'Nora'),
           (${ids.hushall}, ${ids.idris}, 'b', 'Idris')`;

  // Ett lugnt hushåll utan något att uppmärksamma.
  const [h2] = await owner`
    insert into households (name, party_a, party_b) values ('Lugnt', 'a', 'b') returning id`;
  ids.andra = h2.id;
  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.andra}, ${ids.ensam}, 'a', 'Ensam')`;
  await owner`insert into agreements (household_id) values (${ids.andra})`;

  process.env.MAIL_QUEUE_ENCRYPTION_KEY = newEncryptionKey();
  process.env.DATABASE_URL = ownerUrl(DB);
  process.env.APP_URL = "https://x.se";
  svep = await import("../../mail/svep.server");
  stangKopplingar = (await import("../client.server")).closeConnections;
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await stangKopplingar?.();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

beforeEach(async () => {
  if (!available) return;
  await owner`delete from mail_messages`;
});

async function kon(mall?: string) {
  return mall
    ? owner`select recipient_email, idempotency_key from mail_messages where template = ${mall}`
    : owner`select recipient_email, template, idempotency_key from mail_messages`;
}

describeDb("Fristbevakningen", () => {
  beforeAll(async () => {
    if (!available) return;
    const [p] = await owner`
      insert into exit_processes (household_id, process_date, kind, started_by)
      values (${ids.hushall}, ${PROCESSDAG}, 'utkop', ${ids.nora}) returning id`;
    ids.process = p.id;
  });

  it("skickar ingenting mellan påminnelsepunkterna", async () => {
    // 10 dagar kvar till beskedet om övertagande: ingen punkt träffas.
    expect(await svep.svepFrister(MELLAN)).toBe(0);
    expect(await kon()).toHaveLength(0);
  });

  it("skickar till båda parter på fjortondagarspunkten", async () => {
    const antal = await svep.svepFrister(P14);
    expect(antal).toBe(2);
    const rader = await kon("processdag");
    expect(rader.map((r) => r.recipient_email).sort()).toEqual(["i@x.se", "n@x.se"]);
  });

  it("samma punkt skickar bara en gång, hur många gånger svepet än kör", async () => {
    await svep.svepFrister(P14);
    const efterForsta = (await kon()).length;

    for (let i = 0; i < 3; i += 1) {
      expect(await svep.svepFrister(new Date("2026-09-01T14:00:00Z"))).toBe(0);
    }
    expect(await kon()).toHaveLength(efterForsta);
  });

  it("två samtidiga körningar skickar inte dubbelt", async () => {
    // Rådgivningslåset gör att bara den ena gör arbetet, och nyckeln hindrar
    // dubbletter även om båda skulle hinna.
    const [a, b] = await Promise.all([svep.svepFrister(P14), svep.svepFrister(P14)]);
    expect(a + b).toBe(2);
    expect(await kon()).toHaveLength(2);
  });

  it("nästa punkt är en ny händelse", async () => {
    await svep.svepFrister(P14);
    expect(await svep.svepFrister(P7)).toBe(2);
    expect(await kon()).toHaveLength(4);
  });

  it("skickar ett besked dagen efter förfall", async () => {
    expect(await svep.svepFrister(FORFALLEN)).toBe(2);
    const rader = await kon("processdag");
    expect(rader.every((r) => String(r.idempotency_key).includes(":-1:"))).toBe(true);
  });

  it("tiger när fristen passerats för länge sedan", async () => {
    expect(await svep.svepFrister(new Date("2026-10-01T09:00:00Z"))).toBe(0);
  });

  it("hoppar över avstängda konton", async () => {
    await owner`update users set disabled_at = now() where id = ${ids.idris}`;
    expect(await svep.svepFrister(P14)).toBe(1);
    const rader = await kon();
    expect(rader.map((r) => r.recipient_email)).toEqual(["n@x.se"]);
    await owner`update users set disabled_at = null where id = ${ids.idris}`;
  });

  it("slutar påminna om övertagandet när beskedet lämnats", async () => {
    await owner`update exit_processes set takeover_notified_at = now()
                 where id = ${ids.process}`;
    expect(await svep.svepFrister(P14)).toBe(0);
    await owner`update exit_processes set takeover_notified_at = null
                 where id = ${ids.process}`;
  });
});

describeDb("Tidszonen runt midnatt", () => {
  it("sen kväll i UTC räknas som nästa svenska dag", async () => {
    // 22:30 UTC den 7 september är 00:30 den 8 september i Stockholm, och då
    // är det sjudagarspunkten som gäller - inte åtta.
    expect(await svep.svepFrister(new Date("2026-09-07T22:30:00Z"))).toBe(2);
  });
});

describeDb("Veckosammanfattningen", () => {
  it("skickar ingenting till ett hushåll utan något att uppmärksamma", async () => {
    // Det lugna hushållet har inget avtalsutkast, ingen avstämning och ingen
    // process.
    const antal = await svep.svepVeckosammanfattning(IDAG);
    const till = (await kon()).map((r) => r.recipient_email);
    expect(till).not.toContain("e@x.se");
    expect(antal).toBeGreaterThanOrEqual(0);
  });

  it("skickar när en avstämning är försenad", async () => {
    await owner`
      insert into reconciliations
        (household_id, period_start, period_end, due_on, checklist, created_by)
      values (${ids.hushall}, '2026-04-01', '2026-06-30', '2026-07-15',
              '{"transaktioner": false}'::jsonb, ${ids.nora})`;

    const antal = await svep.svepVeckosammanfattning(IDAG);
    expect(antal).toBe(2);
    const rader = await kon("veckosammanfattning");
    expect(rader.map((r) => r.recipient_email).sort()).toEqual(["i@x.se", "n@x.se"]);
  });

  it("skickar en gång per kalendervecka", async () => {
    await svep.svepVeckosammanfattning(IDAG);
    const efter = (await kon()).length;
    // Senare samma vecka.
    expect(await svep.svepVeckosammanfattning(new Date("2026-09-04T09:00:00Z"))).toBe(0);
    expect(await kon()).toHaveLength(efter);
  });

  it("men igen nästa vecka", async () => {
    await svep.svepVeckosammanfattning(IDAG);
    const efter = (await kon()).length;
    expect(await svep.svepVeckosammanfattning(new Date("2026-09-08T09:00:00Z"))).toBe(2);
    expect(await kon()).toHaveLength(efter + 2);
  });

  it("nyckeln skiljer hushåll åt, så den med flera får en per hushåll", async () => {
    // Nora läggs till i det lugna hushållet och det får något att säga.
    await owner`insert into household_members (household_id, user_id, party_id, display_name)
      values (${ids.andra}, ${ids.nora}, 'b', 'Nora')
      on conflict (household_id, user_id) do nothing`;
    await owner`
      insert into reconciliations
        (household_id, period_start, period_end, due_on, checklist, created_by)
      values (${ids.andra}, '2026-04-01', '2026-06-30', '2026-07-15',
              '{"transaktioner": false}'::jsonb, ${ids.nora})
      on conflict do nothing`;

    await svep.svepVeckosammanfattning(IDAG);
    const noras = (await owner`
      select idempotency_key from mail_messages
       where template = 'veckosammanfattning' and recipient_user_id = ${ids.nora}`) as {
      idempotency_key: string;
    }[];

    // Två sammanfattningar, en per hushåll, med skilda nycklar.
    expect(noras).toHaveLength(2);
    expect(new Set(noras.map((r) => r.idempotency_key)).size).toBe(2);
  });
});
