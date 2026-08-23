import { createHash } from "node:crypto";

import { owner } from "../db/client.server";

/**
 * Försöksspärr och säkerhetslogg.
 *
 * Spärren ska göra gissning dyr utan att kunna låsa ute den rätta användaren
 * för gott: en angripare som kan sitt offers adress skulle annars kunna stänga
 * hen ute på begäran. Därför en fönsterbaserad spärr som släpper av sig själv,
 * aldrig en permanent låsning.
 */

export type Spärrkategori = "login" | "reset" | "invite" | "register";

const REGLER: Record<Spärrkategori, { tak: number; fönsterMinuter: number; spärrMinuter: number }> =
  {
    // Inloggning: generöst nog för den som skriver fel några gånger.
    login: { tak: 10, fönsterMinuter: 15, spärrMinuter: 15 },
    // Återställning: färre försök, eftersom varje begäran skickar ett mail.
    reset: { tak: 5, fönsterMinuter: 60, spärrMinuter: 60 },
    // Registrering: samma skäl som återställning, och dessutom skapar varje
    // lyckad begäran ett konto. Det ska inte gå att fylla tabellen från en
    // adress eller ett nät.
    register: { tak: 5, fönsterMinuter: 60, spärrMinuter: 60 },
    // Inbjudningsacceptans: gissning av token ska inte löna sig.
    invite: { tak: 10, fönsterMinuter: 60, spärrMinuter: 60 },
  };

/** Hashar det som identifierar försöket, så tabellen aldrig blir en adresslista. */
function nyckel(kategori: Spärrkategori, sort: "ip" | "epost", värde: string): string {
  const hash = createHash("sha256").update(`${sort}:${värde.toLowerCase()}`).digest("hex");
  return `${kategori}:${sort}:${hash.slice(0, 32)}`;
}

/**
 * Nätdelen av en IP-adress. /24 för IPv4 och /48 för IPv6 räcker för att se ett
 * mönster utan att peka ut en enskild uppkoppling.
 */
export function ipPrefix(ip: string | undefined): string | null {
  if (!ip) return null;
  const rent = ip.split(",")[0].trim();
  if (rent.includes(":")) {
    const delar = rent.split(":");
    return delar.slice(0, 3).join(":") + "::/48";
  }
  const delar = rent.split(".");
  if (delar.length !== 4) return null;
  return `${delar[0]}.${delar[1]}.${delar[2]}.0/24`;
}

export function epostHash(epost: string): string {
  return createHash("sha256").update(epost.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export type Spärrsvar = { tillåtet: boolean; spärradTill?: Date };

/**
 * Räknar upp ett försök och säger om det får göras.
 *
 * Räkningen sker före kontrollen med flit: den som redan är spärrad ska inte
 * kunna hålla fönstret öppet genom att fortsätta försöka.
 */
export async function räknaFörsök(
  kategori: Spärrkategori,
  identifierare: { ip?: string; epost?: string },
): Promise<Spärrsvar> {
  const regel = REGLER[kategori];
  const nycklar = [
    identifierare.ip ? nyckel(kategori, "ip", identifierare.ip) : null,
    identifierare.epost ? nyckel(kategori, "epost", identifierare.epost) : null,
  ].filter((n): n is string => n !== null);

  if (nycklar.length === 0) return { tillåtet: true };

  const sql = owner();
  const rader = await sql<{ blocked_until: Date | null }[]>`
    insert into auth_throttle (bucket, attempts, window_started_at)
    select unnest(${nycklar}::text[]), 1, now()
    on conflict (bucket) do update
      set attempts = case
            when auth_throttle.window_started_at < now() - ${`${regel.fönsterMinuter} minutes`}::interval
            then 1
            else auth_throttle.attempts + 1
          end,
          window_started_at = case
            when auth_throttle.window_started_at < now() - ${`${regel.fönsterMinuter} minutes`}::interval
            then now()
            else auth_throttle.window_started_at
          end,
          blocked_until = case
            -- En pågående spärr flyttas aldrig fram. Tidigare sattes
            -- blocked_until om vid varje nytt försök, så fortsatta försök
            -- förlängde spärren i all oändlighet. Det drabbar inte den som
            -- gissar - den kan vänta - utan den riktiga användaren, vars konto
            -- går att hålla utelåst av vem som helst som fortsätter knacka.
            when auth_throttle.blocked_until is not null
             and auth_throttle.blocked_until > now()
            then auth_throttle.blocked_until
            when auth_throttle.window_started_at >= now() - ${`${regel.fönsterMinuter} minutes`}::interval
             and auth_throttle.attempts + 1 >= ${regel.tak}
            then now() + ${`${regel.spärrMinuter} minutes`}::interval
            -- Fönstret har löpt ut: en gammal spärr som redan passerat ska inte
            -- ligga kvar och förvirra.
            when auth_throttle.window_started_at < now() - ${`${regel.fönsterMinuter} minutes`}::interval
            then null
            else auth_throttle.blocked_until
          end
    returning blocked_until
  `;

  const spärrad = rader
    .map((r) => r.blocked_until)
    .filter((d): d is Date => d !== null && d.getTime() > Date.now())
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return spärrad ? { tillåtet: false, spärradTill: spärrad } : { tillåtet: true };
}

/** Nollställer efter ett lyckat försök, så en rätt inloggning löser spärren. */
export async function nollställ(
  kategori: Spärrkategori,
  identifierare: { ip?: string; epost?: string },
): Promise<void> {
  const nycklar = [
    identifierare.ip ? nyckel(kategori, "ip", identifierare.ip) : null,
    identifierare.epost ? nyckel(kategori, "epost", identifierare.epost) : null,
  ].filter((n): n is string => n !== null);
  if (nycklar.length === 0) return;

  const sql = owner();
  await sql`delete from auth_throttle where bucket = any(${nycklar}::text[])`;
}

/** Städar bort räknare vars fönster runnit ut. Körs av mailsvepet. */
export async function städaSpärrar(): Promise<number> {
  const sql = owner();
  const rader = await sql<{ bucket: string }[]>`
    delete from auth_throttle
     where window_started_at < now() - interval '24 hours'
       and (blocked_until is null or blocked_until < now())
    returning bucket
  `;
  return rader.length;
}

export type Säkerhetshändelse =
  | "login.ok"
  | "login.fel"
  | "login.spärrad"
  | "login.avstängt_konto"
  | "reset.begärd"
  | "reset.spärrad"
  | "invite.spärrad"
  | "register.skapad"
  | "register.befintlig_adress"
  | "register.spärrad"
  | "register.stängd"
  | "register.bekräftad"
  | "register.bekräftelse_ogiltig"
  | "reset.genomförd"
  | "reset.ogiltig_token"
  | "losenord.bytt"
  | "invite.accepterad"
  | "invite.ogiltig";

/**
 * Skriver en säkerhetshändelse. Aldrig lösenord, aldrig token, aldrig hela
 * IP-adressen - och adressen bara som hash.
 */
export async function loggaHändelse(
  typ: Säkerhetshändelse,
  data: { userId?: string | null; epost?: string; ip?: string; detalj?: string },
): Promise<void> {
  const sql = owner();
  await sql`
    insert into security_events (event_type, user_id, email_hash, ip_prefix, detail)
    values (${typ}, ${data.userId ?? null},
            ${data.epost ? epostHash(data.epost) : null},
            ${ipPrefix(data.ip)},
            ${data.detalj?.slice(0, 200) ?? null})
  `;
}
