/**
 * Vilket hushåll som är aktivt.
 *
 * Ren logik med egna prov, eftersom reglerna är fler än de ser ut: valet ska
 * överleva en omladdning, men ett hushåll som tagits bort eller som användaren
 * inte längre når får aldrig ligga kvar som aktivt. Ett sparat id som pekar på
 * något otillgängligt är värre än inget sparat val alls - då visas ett tomt
 * läge som ser ut som ett fel i tjänsten.
 */

export const LAGRINGSNYCKEL = "mittochditt.aktivt-hushall";

export type Hushallsval<T extends { id: string }> = {
  aktivt: T | null;
  /**
   * Det sparade valet gick inte att använda och bör rensas. Sant både när
   * hushållet försvunnit och när det aldrig fanns.
   */
  rensaSparat: boolean;
  /** Väljaren visas bara när det finns något att välja mellan. */
  visaValjare: boolean;
};

export function valjAktivt<T extends { id: string }>(
  hushall: readonly T[],
  sparatId: string | null,
): Hushallsval<T> {
  const visaValjare = hushall.length > 1;

  if (hushall.length === 0) {
    // Inget att välja på. Ett sparat id från ett tidigare konto ska bort.
    return { aktivt: null, rensaSparat: sparatId !== null, visaValjare: false };
  }

  const sparat = sparatId ? (hushall.find((h) => h.id === sparatId) ?? null) : null;
  if (sparat) return { aktivt: sparat, rensaSparat: false, visaValjare };

  // Faller tillbaka på det första. Ordningen kommer från servern och är
  // densamma mellan laddningar, så återfallet är förutsägbart.
  return { aktivt: hushall[0], rensaSparat: sparatId !== null, visaValjare };
}

/** Läser det sparade valet. Tål att lagringen är avstängd eller full. */
export function lasSparatVal(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAGRINGSNYCKEL) ?? null;
  } catch {
    // Privat läge eller blockerade kakor. Valet försvinner vid omladdning,
    // vilket är sämre men inte trasigt.
    return null;
  }
}

export function sparaVal(id: string | null): void {
  try {
    if (id === null) globalThis.localStorage?.removeItem(LAGRINGSNYCKEL);
    else globalThis.localStorage?.setItem(LAGRINGSNYCKEL, id);
  } catch {
    // Se ovan.
  }
}
