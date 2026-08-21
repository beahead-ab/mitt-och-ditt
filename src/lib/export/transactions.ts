import { netPayment, ruleFor, toKronor } from "@/lib/engine";
import type {
  AgreementParams,
  CostCategoryRule,
  DayEvent,
  PartyId,
  Transaction,
} from "@/lib/engine";
import type { CsvColumn } from "./csv";
import type { PartyNames } from "./documents";

/**
 * Transaktionshistoriken och dagsberäkningen som kolumner för CSV-export.
 * Samma uppgifter som rutnätet visar, men i rå form: belopp utan valutatecken
 * och datum som ISO, så att mottagaren kan räkna vidare på dem.
 */

const STATUS: Record<Transaction["status"], string> = {
  draft: "Utkast",
  pending: "Väntar",
  withdrawn: "Återkallad",
  approved: "Godkänd",
  disputed: "Tvistig",
};

function nameOf(names: PartyNames, party: PartyId): string {
  return names[party] ?? party;
}

export function transactionCsvColumns(
  agreement: AgreementParams,
  rules: CostCategoryRule[],
  names: PartyNames,
): CsvColumn<Transaction>[] {
  const parties = agreement.parties;

  return [
    { header: "ID", value: (tx) => tx.id },
    { header: "Betalningsdag", value: (tx) => tx.paymentDate },
    { header: "Kostnadsslag", value: (tx) => tx.category },
    {
      header: "I enhetsmodellen",
      value: (tx) => (ruleFor(rules, tx.category, tx.paymentDate)?.included ? "Ja" : "Nej"),
    },
    { header: "Beskrivning", value: (tx) => tx.description ?? "" },
    { header: "Status", value: (tx) => STATUS[tx.status] },
    ...parties.flatMap((party): CsvColumn<Transaction>[] => [
      {
        header: `Betalt ${nameOf(names, party)}`,
        value: (tx) => toKronor(tx.payments[party]?.gross ?? 0),
      },
      {
        header: `Rabatt ${nameOf(names, party)}`,
        value: (tx) => toKronor(tx.payments[party]?.discount ?? 0),
      },
      {
        header: `Återbetalning ${nameOf(names, party)}`,
        value: (tx) => toKronor(tx.payments[party]?.refund ?? 0),
      },
      {
        header: `Försäkringsersättning ${nameOf(names, party)}`,
        value: (tx) => toKronor(tx.payments[party]?.insurance ?? 0),
      },
      {
        header: `Skatteeffekt ${nameOf(names, party)}`,
        value: (tx) => toKronor(tx.payments[party]?.taxEffect ?? 0),
      },
      {
        header: `Nettobetalning ${nameOf(names, party)}`,
        value: (tx) => toKronor(netPayment(tx.payments[party])),
      },
    ]),
    {
      header: "Preliminär skatteeffekt",
      value: (tx) => (parties.some((p) => tx.payments[p]?.taxPreliminary) ? "Ja" : ""),
    },
    {
      header: "Särskild kostnadsnyckel",
      value: (tx) =>
        tx.specialKey ? parties.map((p) => (tx.specialKey?.[p] ?? 0).toFixed(4)).join(" / ") : "",
    },
    {
      header: "Lånesaldo efter dagens amortering",
      value: (tx) => (tx.loanBalanceAfter == null ? "" : toKronor(tx.loanBalanceAfter)),
    },
    { header: "Korrigerar", value: (tx) => tx.correctsId ?? "" },
    { header: "Makulerar", value: (tx) => tx.voidsId ?? "" },
    { header: "Skäl", value: (tx) => tx.reason ?? "" },
  ];
}

export function dayEventCsvColumns(
  agreement: AgreementParams,
  names: PartyNames,
): CsvColumn<DayEvent>[] {
  const parties = agreement.parties;

  return [
    { header: "Betalningsdag", value: (event) => event.date },
    { header: "Poster", value: (event) => event.transactionIds.join(" ") },
    { header: "Beräknat värde", value: (event) => toKronor(event.linearValue) },
    { header: "Lånesaldo", value: (event) => toKronor(event.loanBalance) },
    { header: "Nettokapital", value: (event) => toKronor(event.netEquity) },
    {
      header: "Värde per enhet",
      value: (event) => (event.unitValue === null ? "" : event.unitValue / 100),
    },
    ...parties.map((party): CsvColumn<DayEvent> => ({
      header: `Kostnadsnyckel ${nameOf(names, party)}`,
      value: (event) => event.keyBefore[party],
    })),
    { header: "Nettokostnad", value: (event) => toKronor(event.netCostTotal) },
    ...parties.map((party): CsvColumn<DayEvent> => ({
      header: `Skillnad ${nameOf(names, party)}`,
      value: (event) => toKronor(event.difference[party]),
    })),
    {
      header: "Överbetalare",
      value: (event) => (event.overpayer ? nameOf(names, event.overpayer) : ""),
    },
    { header: "Överbetalning", value: (event) => toKronor(event.overpayment) },
    { header: "Överförda enheter", value: (event) => event.transferredUnits },
    { header: "Omvandlat belopp", value: (event) => toKronor(event.convertedAmount) },
    {
      header: "Kvarstående fordran",
      value: (event) => toKronor(event.personalClaim?.amount ?? 0),
    },
    ...parties.map((party): CsvColumn<DayEvent> => ({
      header: `Andel efter ${nameOf(names, party)}`,
      value: (event) => event.sharesAfter[party],
    })),
  ];
}
