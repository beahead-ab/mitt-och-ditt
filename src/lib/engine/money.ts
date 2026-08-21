/**
 * Alla belopp i motorn är heltal i **öre**. Flyttal används aldrig för pengar,
 * eftersom en avräkning måste kunna räknas om och ge exakt samma resultat.
 * Konvertering till och från kronor sker bara i gränssnittet och vid import.
 */
export type Ore = number;

export const KRONA = 100;

/** Kronor (som användaren skriver dem) till öre. */
export function kr(kronor: number): Ore {
  return roundHalfAwayFromZero(kronor * KRONA);
}

/** Öre till kronor som decimaltal – endast för presentation och export. */
export function toKronor(ore: Ore): number {
  return ore / KRONA;
}

/**
 * Avrundning bort från noll. Math.round() avrundar −0,5 uppåt till −0 och är
 * därmed asymmetrisk; modellen måste behandla båda parter exakt likadant, så
 * halva ören avrundas alltid bort från noll oavsett tecken.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Fördelar ett belopp på två parter enligt en kvot utan att en enda öre
 * försvinner: den första parten avrundas, den andra får återstoden.
 */
export function splitExact(total: Ore, firstRatio: number): [Ore, Ore] {
  const first = roundHalfAwayFromZero(total * firstRatio);
  return [first, total - first];
}
