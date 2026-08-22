import { owner } from "../db/client.server";
import { dummyHash, verifyPassword } from "./password";
import { loggaHändelse, nollställ, räknaFörsök } from "./throttle.server";

/**
 * Kontrollen av e-post och lösenord, fri från förfrågan och svar.
 *
 * Ligger skilt från serverfunktionen för att gå att pröva rakt av - särskilt
 * att svaret är detsamma, och tar lika lång tid, oavsett om kontot finns.
 */

/** Samma text oavsett vad som gick fel, så svaret inte avslöjar något. */
export const AVVISAD = "Fel e-postadress eller lösenord.";

export class InloggningAvvisad extends Error {
  constructor() {
    super(AVVISAD);
    this.name = "InloggningAvvisad";
  }
}

export async function autentisera(
  epost: string,
  losenord: string,
  ip?: string,
): Promise<{ userId: string }> {
  const spärr = await räknaFörsök("login", { ip, epost });
  if (!spärr.tillåtet) {
    await loggaHändelse("login.spärrad", { epost, ip });
    // Samma text som vid fel lösenord. Att säga "för många försök" hade
    // bekräftat att adressen är värd att fortsätta gissa på.
    throw new InloggningAvvisad();
  }

  const rader = await owner()<
    { id: string; password_hash: string | null; disabled_at: Date | null }[]
  >`
    select id, password_hash, disabled_at from users where lower(email) = ${epost.toLowerCase()}
  `;
  const user = rader[0];

  // Kontrollen körs alltid, även när kontot inte finns eller är avstängt.
  // Annars hade ett okänt konto svarat direkt medan ett känt först körde
  // scrypt, och skillnaden i svarstid räckt för att lista ut vilka adresser
  // som har konto.
  const hash = user?.password_hash ?? (await dummyHash());
  const rättLösenord = await verifyPassword(losenord, hash);

  if (!user || !user.password_hash || !rättLösenord) {
    await loggaHändelse("login.fel", { userId: user?.id ?? null, epost, ip });
    throw new InloggningAvvisad();
  }
  if (user.disabled_at) {
    await loggaHändelse("login.avstängt_konto", { userId: user.id, epost, ip });
    throw new InloggningAvvisad();
  }

  // En rätt inloggning löser spärren, så den som skrivit fel några gånger inte
  // behöver vänta ut fönstret i onödan.
  await nollställ("login", { ip, epost });
  await loggaHändelse("login.ok", { userId: user.id, epost, ip });

  return { userId: user.id };
}
