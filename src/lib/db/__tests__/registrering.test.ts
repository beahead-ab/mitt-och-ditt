import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { newEncryptionKey } from "../../mail/crypto";
import { hashToken, newToken } from "../../auth/tokens";
import { asUser, appSql, databaseAvailable, isRejected, ownerSql } from "./helpers";

/**
 * Öppen registrering.
 *
 * Det som prövas är gränsen som gör tjänsten möjlig att öppna: att en obekräftad
 * adress inte kan göra något alls, att den som skapar ett hushåll blir dess
 * enda part, och att ingen kan lägga till sig själv i ett hushåll som redan
 * finns. Varje villkor prövas mot radnivåsäkerheten och inte mot koden - koden
 * går att kringgå, policyn gör det inte.
 */
const DB = "mittochditt_registrering_test";

let owner: postgres.Sql;
let admin: postgres.Sql;
let app: postgres.Sql;

const ids = { bekraftad: "", obekraftad: "", annan: "" };

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

let reg: typeof import("../../auth/register.server");
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

  const [b] = await owner`
    insert into users (email, name, email_verified_at)
    values ('bekraftad@x.se', 'Bekräftad', now()) returning id`;
  const [o] = await owner`
    insert into users (email, name) values ('obekraftad@x.se', 'Obekräftad') returning id`;
  const [a] = await owner`
    insert into users (email, name, email_verified_at)
    values ('annan@x.se', 'Annan', now()) returning id`;
  ids.bekraftad = b.id;
  ids.obekraftad = o.id;
  ids.annan = a.id;

  // Den nyskapade användaren i migreringen fick email_verified_at satt; den
  // obekräftade nollställs här för att motsvara en färsk registrering.
  await owner`update users set email_verified_at = null where id = ${ids.obekraftad}`;

  process.env.MAIL_QUEUE_ENCRYPTION_KEY = newEncryptionKey();
  process.env.DATABASE_URL = ownerUrl(DB);
  process.env.APP_URL = "https://x.se";
  reg = await import("../../auth/register.server");
  stangKopplingar = (await import("../client.server")).closeConnections;

  app = appSql(DB);
}, 120_000);

afterAll(async () => {
  if (!available) return;
  await stangKopplingar?.();
  await app?.end();
  await owner?.end();
  await admin`drop database if exists ${admin.unsafe(DB)}`;
  await admin?.end();
});

beforeEach(async () => {
  if (!available) return;
  await owner`delete from auth_throttle`;
});

/** Skapar ett hushåll som en inloggad användare, precis som appen gör. */
function skapaHushall(userId: string, namn: string, skapare = userId) {
  return asUser(
    app,
    userId,
    (tx) => tx`insert into households (name, party_a, party_b, created_by)
      values (${namn}, 'a', 'b', ${skapare}) returning id`,
  );
}

function blivPart(userId: string, householdId: string, roll = "a") {
  return asUser(
    app,
    userId,
    (tx) => tx`insert into household_members (household_id, user_id, party_id, display_name)
      values (${householdId}, ${userId}, ${roll}, 'Namn')`,
  );
}

describeDb("Bekräftad adress är villkoret för att göra något", () => {
  it("en obekräftad adress kan inte skapa ett hushåll", async () => {
    const avvisad = await isRejected(() => skapaHushall(ids.obekraftad, "Obekräftat"));
    expect(avvisad).toBe(true);
  });

  it("en bekräftad adress kan", async () => {
    const [rad] = await skapaHushall(ids.bekraftad, "Mitt hushåll");
    expect(rad.id).toBeTruthy();
  });

  it("en obekräftad adress kan inte heller bli part", async () => {
    const [rad] = await skapaHushall(ids.bekraftad, "För partsprovet");
    const avvisad = await isRejected(() => blivPart(ids.obekraftad, rad.id));
    expect(avvisad).toBe(true);
  });

  it("ingen kan skapa ett hushåll i någon annans namn", async () => {
    // created_by måste vara den inloggade. Annars kunde någon fylla en annan
    // persons tak och stänga ute hen.
    const avvisad = await isRejected(() => skapaHushall(ids.bekraftad, "I annans namn", ids.annan));
    expect(avvisad).toBe(true);
  });
});

describeDb("Den som skapar hushållet blir dess enda part", () => {
  it("får bli part i ett tomt hushåll", async () => {
    const [h] = await skapaHushall(ids.bekraftad, "Tomt att gå in i");
    await blivPart(ids.bekraftad, h.id);
    const rader = await owner`
      select user_id from household_members where household_id = ${h.id}`;
    expect(rader).toHaveLength(1);
  });

  it("kan inte lägga till sig själv i ett hushåll som redan har en part", async () => {
    // Det här är spärren som gör att ingen kan tränga sig in i ett par.
    const [h] = await skapaHushall(ids.bekraftad, "Redan bebott");
    await blivPart(ids.bekraftad, h.id);
    const avvisad = await isRejected(() => blivPart(ids.annan, h.id, "b"));
    expect(avvisad).toBe(true);
  });

  it("kan inte lägga in någon annan som part", async () => {
    const [h] = await skapaHushall(ids.bekraftad, "Ingen annans namn");
    const avvisad = await isRejected(() =>
      asUser(
        app,
        ids.bekraftad,
        (tx) => tx`insert into household_members (household_id, user_id, party_id, display_name)
            values (${h.id}, ${ids.annan}, 'a', 'Annan')`,
      ),
    );
    expect(avvisad).toBe(true);
  });
});

describeDb("Taket för hur många hushåll en person kan skapa", () => {
  it("släpper igenom några och stoppar sedan", async () => {
    const [egen] = await owner`
      insert into users (email, name, email_verified_at)
      values ('flitig@x.se', 'Flitig', now()) returning id`;

    for (let i = 0; i < 5; i++) {
      await skapaHushall(egen.id, `Hushåll ${i}`);
    }
    const avvisad = await isRejected(() => skapaHushall(egen.id, "Ett för mycket"));
    expect(avvisad).toBe(true);
  });
});

describeDb("Bekräftelsetoken är oåtkomlig för alla utom ägarrollen", () => {
  it("applikationsrollen ser ingenting alls", async () => {
    await owner`
      insert into email_verifications (user_id, token_hash, expires_at)
      values (${ids.bekraftad}, 'en-hash', now() + interval '1 day')`;

    const synliga = await asUser(
      app,
      ids.bekraftad,
      (tx) => tx`select id from email_verifications`,
    );
    expect(synliga).toHaveLength(0);
  });
});

describeDb("Registreringen är stängd om inget annat sägs", () => {
  it("en bortglömd variabel håller dörren stängd", async () => {
    delete process.env.REGISTRATION_OPEN;
    expect(reg.registreringÄrÖppen()).toBe(false);
    const svar = await reg.registrera("ny@x.se", "Ny", "ett-langt-losenord");
    expect(svar.slag).toBe("stängd");

    const rader = await owner`select id from users where email = 'ny@x.se'`;
    expect(rader).toHaveLength(0);
  });

  it("ett annat värde än true räknas inte som öppet", async () => {
    process.env.REGISTRATION_OPEN = "ja";
    expect(reg.registreringÄrÖppen()).toBe(false);
    process.env.REGISTRATION_OPEN = "1";
    expect(reg.registreringÄrÖppen()).toBe(false);
  });
});

describeDb("Registreringen svarar likadant vare sig adressen är ledig", () => {
  beforeEach(() => {
    process.env.REGISTRATION_OPEN = "true";
  });

  it("skapar ett obekräftat konto och lägger en bekräftelse i kön", async () => {
    const svar = await reg.registrera("nora@x.se", "Nora", "ett-langt-losenord");
    expect(svar.slag).toBe("mottagen");

    const [user] = await owner`
      select id, email_verified_at from users where email = 'nora@x.se'`;
    expect(user).toBeTruthy();
    expect(user.email_verified_at).toBeNull();

    const bekraftelser = await owner`
      select id from email_verifications where user_id = ${user.id}`;
    expect(bekraftelser).toHaveLength(1);

    const mail = await owner`
      select template from mail_messages where recipient_user_id = ${user.id}`;
    expect(mail.map((m) => m.template)).toContain("bekrafta_epost");
  });

  it("skapar inget nytt konto för en adress som redan finns, men svarar detsamma", async () => {
    const före = await owner`select count(*)::int as antal from users`;
    const svar = await reg.registrera("bekraftad@x.se", "Någon annan", "ett-langt-losenord");
    expect(svar.slag).toBe("mottagen");

    const efter = await owner`select count(*)::int as antal from users`;
    expect(efter[0].antal).toBe(före[0].antal);

    // Namnet på det befintliga kontot får inte skrivas över av den som gissar.
    const [user] = await owner`select name from users where email = 'bekraftad@x.se'`;
    expect(user.name).toBe("Bekräftad");

    const mail = await owner`
      select template from mail_messages where recipient_user_id = ${ids.bekraftad}`;
    expect(mail.map((m) => m.template)).toContain("konto_finns_redan");
  });

  it("ger samma text i båda fallen", async () => {
    const ledig = await reg.registrera("ledig@x.se", "Ledig", "ett-langt-losenord");
    const upptagen = await reg.registrera("annan@x.se", "Upptagen", "ett-langt-losenord");
    expect(ledig).toEqual(upptagen);
  });

  it("spärrar efter för många försök från samma adress", async () => {
    for (let i = 0; i < 5; i++) {
      await reg.registrera(`spam${i}@x.se`, "Spam", "ett-langt-losenord", "203.0.113.9");
    }
    const svar = await reg.registrera("spam9@x.se", "Spam", "ett-langt-losenord", "203.0.113.9");
    expect(svar.slag).toBe("spärrad");
  });
});

describeDb("Bekräftelselänken", () => {
  async function nyLänk(userId: string, giltigTill = "1 day") {
    const token = newToken();
    await owner`
      insert into email_verifications (user_id, token_hash, expires_at)
      values (${userId}, ${hashToken(token)}, now() + ${giltigTill}::interval)`;
    return token;
  }

  it("bekräftar adressen och går bara att använda en gång", async () => {
    const [u] = await owner`
      insert into users (email, name) values ('engang@x.se', 'Engång') returning id`;
    const token = await nyLänk(u.id);

    expect(await reg.bekräfta(token)).toEqual({ userId: u.id });

    const [efter] = await owner`select email_verified_at from users where id = ${u.id}`;
    expect(efter.email_verified_at).not.toBeNull();

    expect(await reg.bekräfta(token)).toBeNull();
  });

  it("en utgången länk bekräftar ingenting", async () => {
    const [u] = await owner`
      insert into users (email, name) values ('utgangen@x.se', 'Utgången') returning id`;
    const token = await nyLänk(u.id, "-1 hour");

    expect(await reg.bekräfta(token)).toBeNull();
    const [efter] = await owner`select email_verified_at from users where id = ${u.id}`;
    expect(efter.email_verified_at).toBeNull();
  });

  it("en påhittad länk bekräftar ingenting", async () => {
    expect(await reg.bekräfta(newToken())).toBeNull();
  });
});
