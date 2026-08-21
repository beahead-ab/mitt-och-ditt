/**
 * Ekonomiska datum är kalenderdatum (YYYY-MM-DD), aldrig tidsstämplar. All
 * räkning sker i UTC så att en betalningsdag inte kan glida en dag åt något
 * håll beroende på var användaren eller servern befinner sig.
 */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value: IsoDate): number {
  if (!ISO_DATE.test(value)) {
    throw new Error(`Ogiltigt datum: ${value}. Formatet ska vara YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    throw new Error(`Datumet finns inte: ${value}.`);
  }
  return ms;
}

const DAY_MS = 86_400_000;

/** Antal hela kalenderdagar från a till b. Negativt om b ligger före a. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return (parseDate(b) - parseDate(a)) / DAY_MS;
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return parseDate(a) - parseDate(b);
}

export function isOnOrBefore(a: IsoDate, b: IsoDate): boolean {
  return compareDates(a, b) <= 0;
}

export function isOnOrAfter(a: IsoDate, b: IsoDate): boolean {
  return compareDates(a, b) >= 0;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIsoDate(parseDate(date) + days * DAY_MS);
}

/** Lägger till kalendermånader; klipper till månadens sista dag vid behov. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const ms = parseDate(date);
  const d = new Date(ms);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toIsoDate(target.getTime());
}

export function toIsoDate(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}
