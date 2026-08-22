import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newEncryptionKey } from "../../mail/crypto";
import { asUser, appSql, databaseAvailable, isRejected, ownerSql } from "./helpers";

/**
 * Utkorgen mot en riktig databas.
 *
 * Två saker bevisas här som inte går att bevisa i ren kod: att kön håller sitt
 * tillstånd även när två avsändare kör samtidigt, och att innehållet är
 * oåtkomligt för både parter och administratör.
 */
const DB = "mittochditt_mail_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = { admin: "", caesar: "", utomstaende: "", household: "", annatHushall: "" };

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

/** Köns funktioner läser DATABASE_URL, så den pekas om till testdatabasen. */
let queue: typeof import("../../mail/queue.server");
let stangKopplingar: () => Promise<void>;

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
  const [utom] = await owner`
    insert into users (email, name) values ('u@x.se', 'Utomstående') returning id`;
  const [household] = await owner`
    insert into households (name) values ('Caesar & Felicia') returning id`;
  const [annat] = await owner`insert into households (name) values ('Annat') returning id`;
  ids.admin = adminUser.id;
  ids.caesar = caesar.id;
  ids.utomstaende = utom.id;
  ids.household = household.id;
  ids.annatHushall = annat.id;

  await owner`insert into household_members (household_id, user_id, party_id, display_name)
    values (${ids.household}, ${ids.caesar}, 'caesar', 'Caesar'),
           (${ids.annatHushall}, ${ids.utomstaende}, 'caesar', 'Utomstående')`;

  process.env.MAIL_QUEUE_ENCRYPTION_KEY = newEncryptionKey();
  process.env.DATABASE_URL = ownerUrl(DB);
  queue = await import("../../mail/queue.server");
  stangKopplingar = (await import("../client.server")).closeConnections;

  app = appSql(DB);
}, 120_000);

/** Samma anslutningsuppgifter som helpers använder, men som URL. */
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

afterAll(async () => {
  if (!available) return;
  await stangKopplingar?.();
  await app?.end();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

describeDb("Kön håller sitt tillstånd", () => {
  it("köar ett mail med innehållet krypterat", async () => {
    const id = await queue.enqueue({
      idempotencyKey: "inbjudan:1",
      template: "inbjudan",
      to: "felicia@x.se",
      params: { url: "https://x.se/i/hemlig-token", namn: "Felicia" },
      householdId: ids.household,
    });
    expect(id).toBeTruthy();

    const [rad] = await owner`select status, attempts from mail_messages where id = ${id}`;
    expect(rad.status).toBe("pending");
    expect(rad.attempts).toBe(0);

    const [innehall] =
      await owner`select params_encrypted from mail_payloads where message_id = ${id}`;
    expect(innehall.params_encrypted).not.toContain("hemlig-token");
  });

  it("lägger inte samma mail två gånger", async () => {
    const forsta = await queue.enqueue({
      idempotencyKey: "dubbel:1",
      template: "inbjudan",
      to: "a@x.se",
      params: { url: "https://x.se/1", namn: "A", hushall: "H", giltigTill: "i morgon" },
    });
    const andra = await queue.enqueue({
      idempotencyKey: "dubbel:1",
      template: "inbjudan",
      to: "a@x.se",
      params: { url: "https://x.se/2", namn: "A", hushall: "H", giltigTill: "i morgon" },
    });
    expect(forsta).toBeTruthy();
    expect(andra).toBeNull();

    const rader = await owner`select id from mail_messages where idempotency_key = 'dubbel:1'`;
    expect(rader).toHaveLength(1);
  });

  it("hämtar mognat mail, låser upp innehållet och markerar det pågående", async () => {
    await queue.enqueue({
      idempotencyKey: "hamta:1",
      template: "losenord_aterstall",
      to: "b@x.se",
      params: { url: "https://x.se/aterstall/token" },
    });

    const tagna = await queue.claimDue(10);
    const mitt = tagna.find((m) => m.recipientEmail === "b@x.se");
    expect(mitt?.params.url).toBe("https://x.se/aterstall/token");

    const [rad] = await owner`select status from mail_messages where idempotency_key = 'hamta:1'`;
    expect(rad.status).toBe("sending");
  });

  it("två samtidiga avsändare tar aldrig samma rad", async () => {
    for (let i = 0; i < 6; i += 1) {
      await queue.enqueue({
        idempotencyKey: `samtidig:${i}`,
        template: "losenord_aterstall",
        to: `s${i}@x.se`,
        params: { url: `https://x.se/${i}` },
      });
    }
    const [a, b] = await Promise.all([queue.claimDue(10), queue.claimDue(10)]);
    const alla = [...a, ...b].map((m) => m.id);
    expect(new Set(alla).size).toBe(alla.length);
  });

  it("tar bort innehållet så snart mailet gått fram", async () => {
    const id = (await queue.enqueue({
      idempotencyKey: "levererat:1",
      template: "losenord_aterstall",
      to: "c@x.se",
      params: { url: "https://x.se/token-som-ska-bort" },
    }))!;
    await queue.markSent(id);

    const [rad] = await owner`select status, sent_at from mail_messages where id = ${id}`;
    expect(rad.status).toBe("sent");
    expect(rad.sent_at).not.toBeNull();
    const innehall = await owner`select 1 from mail_payloads where message_id = ${id}`;
    expect(innehall).toHaveLength(0);
  });

  it("skjuter upp nästa försök längre för varje misslyckande", async () => {
    const id = (await queue.enqueue({
      idempotencyKey: "backoff:1",
      template: "losenord_aterstall",
      to: "d@x.se",
      params: { url: "https://x.se/d" },
    }))!;

    await queue.markFailed(id, "SMTP 451");
    const [ett] = await owner`
      select attempts, status, extract(epoch from (next_attempt_at - now())) as om
      from mail_messages where id = ${id}`;
    expect(ett.attempts).toBe(1);
    expect(ett.status).toBe("pending");
    expect(Number(ett.om)).toBeGreaterThan(30);

    await queue.markFailed(id, "SMTP 451");
    const [tva] = await owner`
      select extract(epoch from (next_attempt_at - now())) as om
      from mail_messages where id = ${id}`;
    expect(Number(tva.om)).toBeGreaterThan(Number(ett.om));
  });

  it("ger upp efter taket och slänger innehållet", async () => {
    const id = (await queue.enqueue({
      idempotencyKey: "ger-upp:1",
      template: "losenord_aterstall",
      to: "e@x.se",
      params: { url: "https://x.se/e" },
    }))!;
    await owner`update mail_messages set max_attempts = 2 where id = ${id}`;

    await queue.markFailed(id, "SMTP 451");
    await queue.markFailed(id, "SMTP 451");

    const [rad] =
      await owner`select status, last_error, failed_at from mail_messages where id = ${id}`;
    expect(rad.status).toBe("failed");
    expect(rad.last_error).toBe("SMTP 451");
    expect(rad.failed_at).not.toBeNull();
    expect(await owner`select 1 from mail_payloads where message_id = ${id}`).toHaveLength(0);
  });

  it("ger upp direkt vid ett fel som ändå inte blir bättre", async () => {
    const id = (await queue.enqueue({
      idempotencyKey: "permanent:1",
      template: "losenord_aterstall",
      to: "f@x.se",
      params: { url: "https://x.se/f" },
    }))!;
    await queue.markFailed(id, "SMTP 550", true);
    const [rad] = await owner`select status, attempts from mail_messages where id = ${id}`;
    expect(rad.status).toBe("failed");
    expect(rad.attempts).toBe(1);
  });

  it("försöker igen bara det som gett upp och har innehåll kvar", async () => {
    const id = (await queue.enqueue({
      idempotencyKey: "igen:1",
      template: "losenord_aterstall",
      to: "g@x.se",
      params: { url: "https://x.se/g" },
    }))!;

    expect(await queue.retry(id)).toBe("fel_status");

    await owner`update mail_messages set status = 'failed', failed_at = now() where id = ${id}`;
    expect(await queue.retry(id)).toBe("koat");
    const [rad] = await owner`select status, attempts from mail_messages where id = ${id}`;
    expect(rad.status).toBe("pending");
    expect(rad.attempts).toBe(0);

    await owner`update mail_messages set status = 'failed' where id = ${id}`;
    await owner`delete from mail_payloads where message_id = ${id}`;
    expect(await queue.retry(id)).toBe("saknar_innehall");
  });

  it("avbryter köade mail när en inbjudan återkallas", async () => {
    await queue.enqueue({
      idempotencyKey: "invite:abc:1",
      template: "inbjudan",
      to: "h@x.se",
      params: { url: "https://x.se/h", namn: "H", hushall: "X", giltigTill: "i morgon" },
    });
    const antal = await queue.cancelByKeyPrefix("invite:abc:");
    expect(antal).toBe(1);

    const [rad] =
      await owner`select status from mail_messages where idempotency_key = 'invite:abc:1'`;
    expect(rad.status).toBe("cancelled");
    expect(
      await owner`select 1 from mail_payloads where message_id =
        (select id from mail_messages where idempotency_key = 'invite:abc:1')`,
    ).toHaveLength(0);
  });
});

describeDb("Ingen kommer åt mailens innehåll", () => {
  it("varken part eller administratör kan läsa innehållet", async () => {
    await queue.enqueue({
      idempotencyKey: "hemligt:1",
      template: "inbjudan",
      to: "i@x.se",
      params: { url: "https://x.se/i/topphemlig", namn: "I", hushall: "X", giltigTill: "i morgon" },
      householdId: ids.household,
    });

    for (const vem of [ids.admin, ids.caesar]) {
      const rader = await asUser(app, vem, (tx) => tx`select * from mail_payloads`);
      expect(rader).toHaveLength(0);
    }
  });

  it("innehållet går inte heller att skriva eller ändra genom applikationen", async () => {
    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.admin,
        (tx) => tx`insert into mail_payloads (message_id, params_encrypted, purge_after)
          select id, 'påhittat', now() + interval '1 day' from mail_messages limit 1`,
      ),
    );
    expect(rejected).toBe(true);
  });

  it("administratören ser leveransen men inget innehåll", async () => {
    const rader = await asUser(
      app,
      ids.admin,
      (tx) => tx`select template, recipient_email, status, attempts, last_error from mail_messages`,
    );
    expect(rader.length).toBeGreaterThan(0);
    expect(Object.keys(rader[0])).not.toContain("params_encrypted");
  });

  it("en part ser sitt eget hushålls mail men inte ett annat hushålls", async () => {
    await queue.enqueue({
      idempotencyKey: "annat:1",
      template: "inbjudan",
      to: "j@x.se",
      params: { url: "https://x.se/j", namn: "J", hushall: "Annat", giltigTill: "i morgon" },
      householdId: ids.annatHushall,
    });

    const mina = await asUser(
      app,
      ids.caesar,
      (tx) => tx`select household_id from mail_messages where household_id is not null`,
    );
    expect(mina.length).toBeGreaterThan(0);
    expect(mina.every((r) => r.household_id === ids.household)).toBe(true);
  });

  it("ingen kan skriva en mailrad i eget namn", async () => {
    const rejected = await isRejected(() =>
      asUser(
        app,
        ids.caesar,
        (tx) => tx`insert into mail_messages (idempotency_key, template, recipient_email)
          values ('forgat:1', 'losenord_aterstall', 'offer@x.se')`,
      ),
    );
    expect(rejected).toBe(true);
  });
});

describeDb("Hela kedjan: från kö till levererat mail", () => {
  it("skickar genom en riktig SMTP-server, markerar levererat och slänger innehållet", async () => {
    const { startSmtpSink } = await import("../../mail/__tests__/smtp-sink");
    const { SmtpTransport } = await import("../../mail/transport");
    const { dispatchOnce } = await import("../../mail/dispatch.server");

    const sink = await startSmtpSink();
    process.env.MAIL_ALLOW_INSECURE = "true";

    try {
      const id = (await queue.enqueue({
        idempotencyKey: "helakedjan:1",
        template: "inbjudan",
        to: "felicia@example.test",
        params: {
          namn: "Felicia",
          hushall: "Caesar & Felicia",
          url: "https://mittochditt.example/inbjudan/token-som-inte-far-lacka",
          giltigTill: "1 september",
        },
        householdId: ids.household,
      }))!;

      const transport = new SmtpTransport({
        host: "127.0.0.1",
        port: sink.port,
        secure: false,
        from: "Mitt & Ditt <ingen@example.test>",
      });

      const svep = await dispatchOnce(transport, 50);
      expect(svep.misslyckade).toBe(0);
      expect(svep.skickade).toBeGreaterThan(0);

      const levererat = sink.mail.find((m) => m.to.includes("felicia@example.test"));
      expect(levererat).toBeDefined();
      // Länken ska finnas i mailet - det är hela poängen med att skicka det.
      expect(levererat!.data).toContain("mittochditt.example");

      const [rad] = await owner`select status, sent_at from mail_messages where id = ${id}`;
      expect(rad.status).toBe("sent");
      expect(rad.sent_at).not.toBeNull();

      // Men den ska inte ligga kvar i databasen efteråt.
      expect(await owner`select 1 from mail_payloads where message_id = ${id}`).toHaveLength(0);
    } finally {
      delete process.env.MAIL_ALLOW_INSECURE;
      await sink.stop();
    }
  });

  it("lämnar mailet i kön när mailservern avvisar tillfälligt", async () => {
    const { startSmtpSink } = await import("../../mail/__tests__/smtp-sink");
    const { SmtpTransport } = await import("../../mail/transport");
    const { dispatchOnce } = await import("../../mail/dispatch.server");

    const sink = await startSmtpSink();
    sink.svaraMed = { kod: 451, text: "4.3.0 Try again later" };
    process.env.MAIL_ALLOW_INSECURE = "true";

    try {
      const id = (await queue.enqueue({
        idempotencyKey: "tillfalligt:1",
        template: "losenord_aterstall",
        to: "k@example.test",
        params: { url: "https://x.example/aterstall/abc" },
      }))!;

      const svep = await dispatchOnce(
        new SmtpTransport({
          host: "127.0.0.1",
          port: sink.port,
          secure: false,
          from: "Mitt & Ditt <ingen@example.test>",
        }),
        50,
      );
      expect(svep.misslyckade).toBeGreaterThan(0);

      const [rad] = await owner`select status, attempts from mail_messages where id = ${id}`;
      expect(rad.status).toBe("pending");
      expect(rad.attempts).toBe(1);
      // Innehållet ligger kvar, annars gick mailet inte att bygga vid nästa försök.
      expect(await owner`select 1 from mail_payloads where message_id = ${id}`).toHaveLength(1);
    } finally {
      delete process.env.MAIL_ALLOW_INSECURE;
      await sink.stop();
    }
  });
});
