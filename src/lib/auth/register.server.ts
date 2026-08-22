import { owner } from "../db/client.server";
import { enqueue } from "../mail/queue.server";
import { hashPassword } from "./password";
import { loggaHändelse, räknaFörsök } from "./throttle.server";
import { expiresIn, hashToken, isExpired, newToken } from "./tokens";

/**
 * Öppen registrering.
 *
 * Ligger skilt från serverfunktionerna så att flödet går att pröva rakt av:
 * att svaret är detsamma för ledig och upptagen adress, att ett konto utan
 * bekräftad adress inte kan användas till något, och att registreringen går
 * att hålla stängd innan tjänsten är prövad.
 */

/** Bekräftelselänken är kortlivad, men inte så kort att ett mail hinner fastna. */
export const GILTIG_TIMMAR = 24;

/**
 * Samma svar för ledig och upptagen adress.
 *
 * Att skilja på svaren hade gjort formuläret till ett sätt att ta reda på
 * vilka som har konto - och till skillnad från en inloggning kan vem som helst
 * ställa frågan hur många gånger som helst.
 */
export const NEUTRALT_SVAR =
  "Kolla din e-post. Har adressen inget konto sedan tidigare ligger det en bekräftelselänk där.";

export type Registreringssvar =
  { slag: "stängd" } | { slag: "spärrad" } | { slag: "mottagen"; text: string };

/**
 * Är registreringen öppen?
 *
 * Stängd om inget annat sägs. En bortglömd variabel ska hålla dörren stängd,
 * inte öppna den - felet åt det hållet syns direkt och går att rätta, felet åt
 * andra hållet upptäcks av någon annan.
 */
export function registreringÄrÖppen(): boolean {
  return process.env.REGISTRATION_OPEN === "true";
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Skapar ett konto som ännu inte kan användas till något.
 *
 * Kontot får sitt värde först när adressen är bekräftad: utan bekräftelse går
 * det inte att skapa hushåll och inte att bli part i någon annans. Annars
 * kunde vem som helst lägga beslag på en adress som inte är hens, och sedan ta
 * emot en inbjudan avsedd för den personen.
 */
export async function registrera(
  epost: string,
  namn: string,
  lösenord: string,
  ip?: string,
): Promise<Registreringssvar> {
  if (!registreringÄrÖppen()) {
    await loggaHändelse("register.stängd", { epost, ip });
    return { slag: "stängd" };
  }

  const spärr = await räknaFörsök("register", { ip, epost });
  if (!spärr.tillåtet) {
    await loggaHändelse("register.spärrad", { epost, ip });
    return { slag: "spärrad" };
  }

  const adress = epost.trim().toLowerCase();
  const sql = owner();
  const [befintlig] = await sql<{ id: string; email: string; disabled_at: Date | null }[]>`
    select id, email, disabled_at from users where lower(email) = ${adress}
  `;

  if (befintlig) {
    await loggaHändelse("register.befintlig_adress", { userId: befintlig.id, epost: adress, ip });
    // Ett avstängt konto får ingen påminnelse om att det finns.
    if (!befintlig.disabled_at) {
      await enqueue({
        // Ett mail per försök och konto och timme räcker; annars blir
        // formuläret ett sätt att skicka post till någon annan.
        idempotencyKey: `finns:${befintlig.id}:${new Date().toISOString().slice(0, 13)}`,
        template: "konto_finns_redan",
        to: befintlig.email,
        params: { url: `${appUrl()}/auth` },
        recipientUserId: befintlig.id,
      });
    }
    return { slag: "mottagen", text: NEUTRALT_SVAR };
  }

  const hash = await hashPassword(lösenord);
  const token = newToken();
  const giltigTill = expiresIn(GILTIG_TIMMAR / 24);

  const skapad = await sql.begin(async (tx) => {
    const [user] = await tx<{ id: string; email: string }[]>`
      insert into users (email, name, password_hash)
      values (${adress}, ${namn.trim()}, ${hash})
      returning id, email
    `;
    await tx`
      insert into email_verifications (user_id, token_hash, expires_at)
      values (${user.id}, ${hashToken(token)}, ${giltigTill})
    `;
    return user;
  });

  await loggaHändelse("register.skapad", { userId: skapad.id, epost: adress, ip });

  await enqueue({
    idempotencyKey: `bekrafta:${skapad.id}`,
    template: "bekrafta_epost",
    to: skapad.email,
    params: {
      namn: namn.trim(),
      url: `${appUrl()}/bekrafta/${token}`,
      giltigTill: giltigTill.toLocaleDateString("sv-SE"),
    },
    recipientUserId: skapad.id,
  });

  return { slag: "mottagen", text: NEUTRALT_SVAR };
}

/**
 * Löser in en bekräftelselänk.
 *
 * Returnerar användaren så att den som anropar kan skapa en session direkt -
 * den som just bevisat att adressen är hens ska inte behöva logga in på nytt.
 */
export async function bekräfta(token: string, ip?: string): Promise<{ userId: string } | null> {
  const sql = owner();

  const användare = await sql.begin(async (tx) => {
    const [rad] = await tx<
      {
        id: string;
        user_id: string;
        expires_at: Date;
        used_at: Date | null;
        invalidated_at: Date | null;
      }[]
    >`
      select id, user_id, expires_at, used_at, invalidated_at
        from email_verifications where token_hash = ${hashToken(token)}
        for update
    `;
    if (!rad || rad.used_at || rad.invalidated_at || isExpired(rad.expires_at)) return null;

    await tx`update email_verifications set used_at = now() where id = ${rad.id}`;
    // Bekräftelsen är idempotent på användaren: en adress som redan är
    // bekräftad ska inte få sin tidpunkt omskriven av en gammal länk.
    await tx`
      update users set email_verified_at = coalesce(email_verified_at, now())
       where id = ${rad.user_id}
    `;
    return { userId: rad.user_id };
  });

  if (!användare) {
    await loggaHändelse("register.bekräftelse_ogiltig", { ip });
    return null;
  }

  await loggaHändelse("register.bekräftad", { userId: användare.userId, ip });
  return användare;
}
