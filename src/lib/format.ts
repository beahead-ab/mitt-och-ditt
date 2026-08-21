/** Formatering: svensk lokal, tabulära siffror sätts med CSS-klassen `tabular`. */

export function fmtKr(amount: number, decimals = 0) {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/** Andelar visas med 4 decimaler, som avtalets 86,9565 %. Indata är kvot 0–1. */
export function fmtAndel(ratio: number, decimals = 4) {
  return new Intl.NumberFormat("sv-SE", {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(ratio);
}

/** Andelsenheter visas med högst 2 decimaler (bilaga 1: 6 666,67 enheter). */
export function fmtEnheter(units: number) {
  return new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(units);
}

export function fmtDate(value: string | Date) {
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" }).format(new Date(value));
}

export function fmtDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  }).format(new Date(value));
}
