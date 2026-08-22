import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newEncryptionKey } from "../../mail/crypto";
import { databaseAvailable, ownerSql } from "./helpers";

/**
 * Skydden kring inloggning och återställning.
 *
 * Det som prövas här går inte att pröva i ren kod: att svaret är detsamma för
 * känt, okänt och avstängt konto även i tid, att spärren släpper av sig själv,
 * och att en återställningslänk bara duger en gång.
 */
const DB = "mittochditt_auth_test";

let owner: postgres.Sql;
let admin: postgres.Sql;

const ids = { caesar: "", avstangd: "" };
const LOSENORD = "ett riktigt bra losenord";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

let login: typeof import("../../auth/login.server");
let reset: typeof import("../../auth/reset.server");
let throttle: typeof import("../../auth/throttle.server");
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

  process.env.MAIL_QUEUE_ENCRYPTION_KEY = newEncryptionKey();
  process.env.APP_URL = "https://mittochditt.example";
  process.env.DATABASE_URL = ownerUrl(DB);

  const password = await import("../../auth/password");
  login = await import("../../auth/login.server");
  reset = await import("../../auth/reset.server");
  throttle = await import("../../auth/throttle.server");
  stangKopplingar = (await import("../client.server")).closeConnections;

  const hash = await password.hashPassword(LOSENORD);
  const [caesar] = await owner`
    insert into users (email, name, password_hash) values ('caesar@x.se', 'Caesar', ${hash})
    returning id`;
  const [avstangd] = await owner`
    insert into users (email, name, password_hash, disabled_at)
    values ('avstangd@x.se', 'Avstängd', ${hash}, now()) returning id`;
  ids.caesar = caesar.id;
  ids.avstangd = avstangd.id;
}, 180_000);

afterAll(async () => {
  if (!available) return;
  await stangKopplingar?.();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

/** Rensar spärrarna mellan proven, så de inte smittar varandra. */
async function nollställSpärrar() {
  await owner`delete from auth_throttle`;
}

describeDb("Inloggningen avslöjar inte vilka konton som finns", () => {
  it("ger samma text för okänt konto, fel lösenord och avstängt konto", async () => {
    await nollställSpärrar();
    const svar: string[] = [];
    for (const [epost, losen] of [
      ["finns-inte@x.se", LOSENORD],
      ["caesar@x.se", "fel losenord alls"],
      ["avstangd@x.se", LOSENORD],
    ] as const) {
      const fel = await login.autentisera(epost, losen, "203.0.113.5").catch((e: Error) => e);
      svar.push((fel as Error).message);
    }
    // Jämförs som lista, så att ett avvikande meddelande syns i felutskriften.
    expect(svar).toEqual([login.AVVISAD, login.AVVISAD, login.AVVISAD]);
  });

  it("tar ungefär lika lång tid för okänt som för känt konto", async () => {
    await nollställSpärrar();

    // Värm upp, så att den första scrypt-körningen inte färgar mätningen.
    await login.autentisera("caesar@x.se", "fel", "203.0.113.6").catch(() => {});

    async function mät(epost: string): Promise<number> {
      const start = process.hrtime.bigint();
      await login.autentisera(epost, "fel losenord alls", "203.0.113.6").catch(() => {});
      return Number(process.hrtime.bigint() - start) / 1e6;
    }

    const kant: number[] = [];
    const okant: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      await nollställSpärrar();
      kant.push(await mät("caesar@x.se"));
      await nollställSpärrar();
      okant.push(await mät("finns-verkligen-inte@x.se"));
    }

    const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
    const kvot = median(okant) / median(kant);

    // Före härdningen hoppades scrypt över helt för okända konton, och kvoten
    // låg nära noll. Nu ska tiderna ligga i samma härad.
    expect(kvot).toBeGreaterThan(0.5);
    expect(kvot).toBeLessThan(2);
  }, 120_000);

  it("släpper igenom rätt lösenord", async () => {
    await nollställSpärrar();
    const { userId } = await login.autentisera("caesar@x.se", LOSENORD, "203.0.113.7");
    expect(userId).toBe(ids.caesar);
  });

  it("loggar händelsen utan lösenord, utan adress i klartext och utan hela IP:t", async () => {
    await nollställSpärrar();
    await login.autentisera("caesar@x.se", LOSENORD, "203.0.113.9").catch(() => {});
    const [rad] = await owner`
      select event_type, email_hash, ip_prefix, detail from security_events
      order by occurred_at desc limit 1`;
    expect(rad.event_type).toBe("login.ok");
    expect(rad.email_hash).not.toContain("caesar");
    expect(rad.ip_prefix).toBe("203.0.113.0/24");
    expect(JSON.stringify(rad)).not.toContain(LOSENORD);
  });
});

describeDb("Försöksspärren", () => {
  it("stänger efter tillräckligt många försök och håller sedan stängt", async () => {
    await nollställSpärrar();
    const ip = "198.51.100.4";

    let spärrad = false;
    for (let i = 0; i < 12; i += 1) {
      const fel = await login
        .autentisera("caesar@x.se", "fel losenord alls", ip)
        .catch((e: Error) => e);
      expect((fel as Error).message).toBe(login.AVVISAD);
      const [rad] = await owner`
        select blocked_until from auth_throttle
        where blocked_until is not null and blocked_until > now() limit 1`;
      if (rad) {
        spärrad = true;
        break;
      }
    }
    expect(spärrad).toBe(true);

    // Även rätt lösenord avvisas medan spärren gäller.
    const fel = await login.autentisera("caesar@x.se", LOSENORD, ip).catch((e: Error) => e);
    expect((fel as Error).message).toBe(login.AVVISAD);

    const [händelse] = await owner`
      select event_type from security_events where event_type = 'login.spärrad' limit 1`;
    expect(händelse).toBeTruthy();
  }, 180_000);

  it("släpper när fönstret gått ut, i stället för att låsa ute för gott", async () => {
    await nollställSpärrar();
    const ip = "198.51.100.9";
    for (let i = 0; i < 11; i += 1) {
      await login.autentisera("caesar@x.se", "fel losenord alls", ip).catch(() => {});
    }
    // Spola fram tiden i stället för att vänta ut spärren.
    await owner`update auth_throttle set blocked_until = now() - interval '1 minute',
                                         window_started_at = now() - interval '2 hours'`;
    const { userId } = await login.autentisera("caesar@x.se", LOSENORD, ip);
    expect(userId).toBe(ids.caesar);
  }, 180_000);

  it("en rätt inloggning nollställer räknaren", async () => {
    await nollställSpärrar();
    const ip = "198.51.100.20";
    await login.autentisera("caesar@x.se", "fel", ip).catch(() => {});
    await login.autentisera("caesar@x.se", LOSENORD, ip);
    const kvar = await owner`select bucket from auth_throttle where bucket like '%login%'`;
    expect(kvar).toHaveLength(0);
  }, 60_000);

  it("hashar det som identifierar försöket, så tabellen inte blir en adresslista", async () => {
    await nollställSpärrar();
    await login.autentisera("caesar@x.se", "fel", "198.51.100.30").catch(() => {});
    const rader = await owner`select bucket from auth_throttle`;
    const allt = rader.map((r) => r.bucket).join(" ");
    expect(allt).not.toContain("caesar");
    expect(allt).not.toContain("198.51.100");
  });
});

describeDb("Återställning av lösenord", () => {
  /** Plockar fram länken ur det köade mailet, som mottagaren hade gjort. */
  async function senasteLank(): Promise<string> {
    const { decryptParams } = await import("../../mail/crypto");
    const [rad] = await owner`
      select p.params_encrypted from mail_payloads p
      join mail_messages m on m.id = p.message_id
      where m.template = 'losenord_aterstall'
      order by m.created_at desc limit 1`;
    const params = decryptParams(rad.params_encrypted) as { url: string };
    return params.url.split("/").pop() as string;
  }

  it("köar ett mail för ett konto som finns", async () => {
    await nollställSpärrar();
    await reset.begärÅterställning("caesar@x.se", "192.0.2.1");
    const [rad] = await owner`
      select recipient_email, status from mail_messages
      where template = 'losenord_aterstall' order by created_at desc limit 1`;
    expect(rad.recipient_email).toBe("caesar@x.se");
    expect(rad.status).toBe("pending");
  });

  it("köar inget för okänt eller avstängt konto, men syns inte utåt", async () => {
    await nollställSpärrar();
    const innan = await owner`select count(*)::int as antal from mail_messages`;

    await reset.begärÅterställning("finns-inte@x.se", "192.0.2.2");
    await reset.begärÅterställning("avstangd@x.se", "192.0.2.3");

    const efter = await owner`select count(*)::int as antal from mail_messages`;
    expect(efter[0].antal).toBe(innan[0].antal);
  });

  it("går bara att använda en gång", async () => {
    await nollställSpärrar();
    await reset.begärÅterställning("caesar@x.se", "192.0.2.10");
    const token = await senasteLank();

    expect(await reset.tokenÄrGiltig(token)).toBe(true);
    await reset.genomförÅterställning(token, "ett annat bra losenord", "192.0.2.10");
    expect(await reset.tokenÄrGiltig(token)).toBe(false);

    await nollställSpärrar();
    await expect(
      reset.genomförÅterställning(token, "ett tredje losenord", "192.0.2.10"),
    ).rejects.toThrow(/gäller inte längre/);

    // Städa upp: sätt tillbaka lösenordet inför följande prov.
    const { hashPassword } = await import("../../auth/password");
    await owner`update users set password_hash = ${await hashPassword(LOSENORD)} where id = ${ids.caesar}`;
  }, 120_000);

  it("en ny begäran gör den gamla länken oanvändbar", async () => {
    await nollställSpärrar();
    await reset.begärÅterställning("caesar@x.se", "192.0.2.20");
    const gammal = await senasteLank();
    await reset.begärÅterställning("caesar@x.se", "192.0.2.20");
    const ny = await senasteLank();

    expect(gammal).not.toBe(ny);
    expect(await reset.tokenÄrGiltig(gammal)).toBe(false);
    expect(await reset.tokenÄrGiltig(ny)).toBe(true);
  });

  it("en utgången länk duger inte", async () => {
    await nollställSpärrar();
    await reset.begärÅterställning("caesar@x.se", "192.0.2.30");
    const token = await senasteLank();
    await owner`update password_resets set expires_at = now() - interval '1 minute'
                where used_at is null and invalidated_at is null`;
    expect(await reset.tokenÄrGiltig(token)).toBe(false);
  });

  it("avslutar alla sessioner och bekräftar med mail", async () => {
    await nollställSpärrar();
    await owner`
      insert into sessions (user_id, token_hash, expires_at)
      values (${ids.caesar}, 'session-hash-1', now() + interval '30 days'),
             (${ids.caesar}, 'session-hash-2', now() + interval '30 days')`;

    await reset.begärÅterställning("caesar@x.se", "192.0.2.40");
    const token = await senasteLank();
    await reset.genomförÅterställning(token, "ytterligare ett losenord", "192.0.2.40");

    const sessioner = await owner`select token_hash from sessions where user_id = ${ids.caesar}`;
    expect(sessioner).toHaveLength(0);

    const [bekraftelse] = await owner`
      select recipient_email from mail_messages where template = 'losenord_bytt'
      order by created_at desc limit 1`;
    expect(bekraftelse.recipient_email).toBe("caesar@x.se");

    const { hashPassword } = await import("../../auth/password");
    await owner`update users set password_hash = ${await hashPassword(LOSENORD)} where id = ${ids.caesar}`;
  }, 120_000);

  it("spärrar upprepade begäranden utan att säga att de spärrats", async () => {
    await nollställSpärrar();
    const ip = "192.0.2.50";
    for (let i = 0; i < 8; i += 1) {
      await reset.begärÅterställning("caesar@x.se", ip);
    }
    const [rad] = await owner`
      select event_type from security_events where event_type = 'reset.spärrad' limit 1`;
    expect(rad).toBeTruthy();
  }, 60_000);

  it("varken token eller lösenord hamnar i säkerhetsloggen", async () => {
    const rader = await owner`select * from security_events`;
    const allt = JSON.stringify(rader);
    expect(allt).not.toContain(LOSENORD);
    expect(allt).not.toContain("aterstall/");
  });
});

describeDb("Spärrtabellen städas", () => {
  it("tar bort gamla räknare men lämnar dem som fortfarande gäller", async () => {
    await nollställSpärrar();
    await owner`
      insert into auth_throttle (bucket, attempts, window_started_at, blocked_until)
      values ('login:ip:gammal', 3, now() - interval '30 hours', null),
             ('login:ip:aktiv', 3, now(), now() + interval '10 minutes')`;
    const antal = await throttle.städaSpärrar();
    expect(antal).toBe(1);
    const kvar = await owner`select bucket from auth_throttle`;
    expect(kvar.map((r) => r.bucket)).toEqual(["login:ip:aktiv"]);
  });
});
