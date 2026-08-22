import { owner } from "../db/client.server";
import { enqueue } from "../mail/queue.server";
import { hashPassword } from "./password";
import { loggaHändelse, nollställ, räknaFörsök } from "./throttle.server";
import { expiresIn, hashToken, isExpired, newToken } from "./tokens";

/**
 * Kärnan i glömt-och-återställ, fri från förfrågan och svar.
 *
 * Ligger skilt från serverfunktionerna så att flödet går att pröva rakt av: att
 * svaret är detsamma för känt, okänt och avstängt konto, att en länk bara går
 * att använda en gång, och att en ny begäran gör den gamla oanvändbar.
 */

/** Länken är kortlivad med flit. */
export const GILTIG_MINUTER = 30;

/** Samma svar i alla lägen. */
export const NEUTRALT_SVAR =
  "Om adressen har ett konto har vi skickat en länk dit. Kolla skräpposten om det dröjer.";

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Begär en återställning. Returnerar alltid detsamma; att skilja på svaren hade
 * gjort formuläret till ett sätt att ta reda på vilka som har konto.
 */
export async function begärÅterställning(epost: string, ip?: string): Promise<void> {
  const spärr = await räknaFörsök("reset", { ip, epost });
  if (!spärr.tillåtet) {
    await loggaHändelse("reset.spärrad", { epost, ip });
    return;
  }

  const sql = owner();
  const rader = await sql<{ id: string; email: string; disabled_at: Date | null }[]>`
    select id, email, disabled_at from users where lower(email) = ${epost.toLowerCase()}
  `;
  const user = rader[0];

  await loggaHändelse("reset.begärd", { userId: user?.id ?? null, epost, ip });

  // Avstängda konton får ingen länk. Svaret utåt är ändå detsamma.
  if (!user || user.disabled_at) return;

  const token = newToken();
  const resetId = await sql.begin(async (tx) => {
    // En ny begäran gör tidigare länkar oanvändbara, så att en gammal länk som
    // ligger kvar i en inkorg inte förblir en väg in.
    await tx`
      update password_resets set invalidated_at = now()
       where user_id = ${user.id} and used_at is null and invalidated_at is null
    `;
    const [rad] = await tx<{ id: string }[]>`
      insert into password_resets (user_id, token_hash, expires_at)
      values (${user.id}, ${hashToken(token)}, ${expiresIn(GILTIG_MINUTER / (24 * 60))})
      returning id
    `;
    return rad.id;
  });

  await enqueue({
    idempotencyKey: `reset:${resetId}`,
    template: "losenord_aterstall",
    to: user.email,
    params: { url: `${appUrl()}/aterstall/${token}` },
    recipientUserId: user.id,
  });
}

/** Går länken att använda? Svaret är magert med flit. */
export async function tokenÄrGiltig(token: string): Promise<boolean> {
  const rader = await owner()<
    { expires_at: Date; used_at: Date | null; invalidated_at: Date | null }[]
  >`
    select expires_at, used_at, invalidated_at
      from password_resets where token_hash = ${hashToken(token)}
  `;
  const rad = rader[0];
  return Boolean(rad && !rad.used_at && !rad.invalidated_at && !isExpired(rad.expires_at));
}

export class ÅterställningAvvisad extends Error {}

/** Genomför bytet. Kastar med en neutral text när länken inte går att använda. */
export async function genomförÅterställning(
  token: string,
  nyttLösenord: string,
  ip?: string,
): Promise<void> {
  const spärr = await räknaFörsök("reset", { ip });
  if (!spärr.tillåtet) {
    throw new ÅterställningAvvisad("För många försök. Vänta en stund och begär en ny länk.");
  }

  const sql = owner();
  const lösenordshash = await hashPassword(nyttLösenord);

  const resultat = await sql.begin(async (tx) => {
    const rader = await tx<
      {
        id: string;
        user_id: string;
        expires_at: Date;
        used_at: Date | null;
        invalidated_at: Date | null;
      }[]
    >`
      select id, user_id, expires_at, used_at, invalidated_at
        from password_resets where token_hash = ${hashToken(token)}
        for update
    `;
    const rad = rader[0];
    if (!rad || rad.used_at || rad.invalidated_at || isExpired(rad.expires_at)) return null;

    const [user] = await tx<{ email: string; disabled_at: Date | null }[]>`
      select email, disabled_at from users where id = ${rad.user_id}
    `;
    if (!user || user.disabled_at) return null;

    await tx`update password_resets set used_at = now() where id = ${rad.id}`;
    await tx`update users set password_hash = ${lösenordshash} where id = ${rad.user_id}`;
    // Ett återställt lösenord avslutar alla sessioner. Har någon annan varit
    // inne ska den vägen stängas i samma stund.
    await tx`delete from sessions where user_id = ${rad.user_id}`;

    return { resetId: rad.id, userId: rad.user_id, epost: user.email };
  });

  if (!resultat) {
    await loggaHändelse("reset.ogiltig_token", { ip });
    throw new ÅterställningAvvisad("Länken gäller inte längre. Begär en ny.");
  }

  await nollställ("reset", { ip, epost: resultat.epost });
  await loggaHändelse("reset.genomförd", { userId: resultat.userId, epost: resultat.epost, ip });

  await enqueue({
    idempotencyKey: `losenord_bytt:${resultat.resetId}`,
    template: "losenord_bytt",
    to: resultat.epost,
    params: {
      epost: resultat.epost,
      tidpunkt: new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }),
      url: `${appUrl()}/auth`,
    },
    recipientUserId: resultat.userId,
  });
}
