/**
 * Hur ofta utkorgen töms, och om den töms alls.
 *
 * Ren logik med egna prov, eftersom felet här inte syns förrän i drift och då
 * som en maskin som går varm. Väntesnurran räknade tidigare `i < intervall`,
 * och varje ogiltigt värde - "0", tom sträng, negativt tal, bokstäver - blev
 * 0 eller NaN. Då kördes noll varv väntan, och avsändaren gick i en loop utan
 * paus mot databasen.
 *
 * Värre var att `.env.example` samtidigt lovade att 0 stänger av avsändaren.
 * Dokumentationen beskrev alltså motsatsen till vad koden gjorde.
 */

/** Standard när variabeln inte är satt alls. */
export const STANDARD_SEKUNDER = 30;

/**
 * Kortaste tillåtna intervall.
 *
 * Under en sekund är inte en inställning någon vill ha, utan ett skrivfel -
 * och skillnaden mot en loop utan paus är för liten för att vara värd något.
 */
export const MINSTA_SEKUNDER = 1;

/** Under det här loggas en varning: det är tillåtet, men sällan avsiktligt. */
export const VARNA_UNDER_SEKUNDER = 5;

export type Avsandarlage =
  /** Den löpande avsändaren är avstängd. Enstaka svep går fortfarande att köra. */
  | { slag: "avstangd" }
  | { slag: "loop"; sekunder: number; varning?: string }
  | { slag: "fel"; skal: string };

/**
 * Tolkar intervallet.
 *
 * Vägrar hellre än gissar. Ett värde som inte går att förstå är nästan alltid
 * ett skrivfel, och att då falla tillbaka på en standard döljer felet tills
 * någon undrar varför mailen kommer i fel takt.
 */
export function tolkaIntervall(varde: string | undefined | null): Avsandarlage {
  // Osatt eller tomt betyder standard. En tom variabel uppstår lätt när någon
  // skriver `MAIL_DISPATCH_INTERVAL_SECONDS=` och menar "som vanligt".
  if (varde === undefined || varde === null || varde.trim() === "") {
    return { slag: "loop", sekunder: STANDARD_SEKUNDER };
  }

  const text = varde.trim();
  if (!/^-?\d+$/.test(text)) {
    return {
      slag: "fel",
      skal: `MAIL_DISPATCH_INTERVAL_SECONDS måste vara ett heltal sekunder, inte "${text}".`,
    };
  }

  const sekunder = Number(text);

  if (sekunder === 0) return { slag: "avstangd" };

  if (sekunder < 0) {
    return {
      slag: "fel",
      skal: `MAIL_DISPATCH_INTERVAL_SECONDS kan inte vara negativt (${sekunder}). Sätt 0 för att stänga av avsändaren.`,
    };
  }

  if (sekunder < MINSTA_SEKUNDER) {
    return {
      slag: "fel",
      skal: `MAIL_DISPATCH_INTERVAL_SECONDS måste vara minst ${MINSTA_SEKUNDER} sekund, inte ${sekunder}.`,
    };
  }

  if (sekunder < VARNA_UNDER_SEKUNDER) {
    return {
      slag: "loop",
      sekunder,
      varning:
        `Avsändaren sveper var ${sekunder}:e sekund. Det är ovanligt tätt och belastar ` +
        `databasen i onödan; ${VARNA_UNDER_SEKUNDER} sekunder eller mer räcker nästan alltid.`,
    };
  }

  return { slag: "loop", sekunder };
}
