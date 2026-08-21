/**
 * Kanonisk serialisering.
 *
 * En fryst slutavräkning måste kunna räknas om och ge exakt samma checksumma.
 * JSON bevarar inte nyckelordning på ett garanterat sätt mellan körningar och
 * databasrundor, så nycklarna sorteras innan de hashas. Utan det skulle två
 * identiska beräkningar kunna få olika checksumma och verifieringen larma i
 * onödan.
 */

export type CanonicalValue =
  string | number | boolean | null | CanonicalValue[] | { [key: string]: CanonicalValue };

/**
 * Serialiserar med sorterade nycklar. Odefinierade värden utelämnas, precis
 * som JSON.stringify gör, så att ett fält som saknas och ett fält som är
 * undefined ger samma resultat.
 */
export function canonicalStringify(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null";

  if (typeof value === "number") {
    // NaN och oändligheter saknar JSON-representation och ska aldrig
    // förekomma i en beräkning som ska frysas.
    if (!Number.isFinite(value)) {
      throw new Error("Kan inte serialisera ett tal som inte är ändligt.");
    }
    // -0 och 0 är samma tal och ska ge samma text.
    return Object.is(value, -0) ? "0" : String(value);
  }

  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${serialize(item)}`).join(",")}}`;
  }

  throw new Error(`Kan inte serialisera värde av typen ${typeof value}.`);
}

/**
 * Jämför två beräkningsresultat. Används när en fryst slutavräkning räknas om:
 * stämmer inte det nya resultatet med det sparade har något i underlaget
 * ändrats, och det ska synas.
 */
export function sameResult(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}
