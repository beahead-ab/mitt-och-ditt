/**
 * Att läsa och skriva kronbelopp i formulär.
 *
 * Ren logik, skild från komponenten, eftersom det är här felen bor: en tom
 * sträng är inte noll, ett blanksteg mellan tusentalen ska inte stoppa någon,
 * och svensk decimalkomma ska fungera lika bra som punkt.
 */

/** Tomt fält betyder "inget angivet", aldrig noll. */
export function tolkaBelopp(text: string): number | null {
  const rensat = text.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (rensat === "") return null;
  const tal = Number(rensat);
  return Number.isFinite(tal) ? tal : null;
}

/** Tusenavgränsare vid blur. Ett tal på sju siffror går annars inte att läsa. */
export function skrivBelopp(värde: number | null): string {
  if (värde === null) return "";
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(värde);
}
