/**
 * CSV som svenska Excel öppnar rätt utan importguide.
 *
 * Tre detaljer avgör det: semikolon som avgränsare (svensk Excel läser komma
 * som decimaltecken), decimalkomma i talen, och en byte order mark så att
 * å, ä och ö inte blir kråkfötter.
 */

export const DELIMITER = ";";
// Byte order mark, så att svenska Excel läser filen som UTF-8.
const BOM = "\uFEFF";

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
};

/**
 * Ett fält citeras när det innehåller avgränsare, citattecken eller
 * radbrytning. Citattecken inuti fältet dubbleras.
 */
export function escapeField(value: string): string {
  if (value === "") return "";
  const needsQuotes = /[";\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Tal skrivs med decimalkomma och utan tusentalsavgränsare. */
export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(decimals).replace(".", ",");
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return escapeField(typeof value === "number" ? formatNumber(value) : value);
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const head = columns.map((column) => escapeField(column.header)).join(DELIMITER);
  const body = rows.map((row) => columns.map((column) => cell(column.value(row))).join(DELIMITER));
  // Radbrytning enligt CSV-standarden, som Excel förväntar sig.
  return BOM + [head, ...body].join("\r\n") + "\r\n";
}

/** Filnamn med datum, utan tecken som ställer till det i filsystem. */
export function exportFilename(base: string, extension: string, stamp: string): string {
  const safe = base
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${safe}-${stamp.slice(0, 10)}.${extension}`;
}
