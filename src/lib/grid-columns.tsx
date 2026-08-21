import { Badge } from "@/components/ui/badge";
import type { GridColumn } from "@/components/data-grid";
import {
  netPayment,
  ruleFor,
  toKronor,
  type AgreementParams,
  type CostCategoryRule,
  type DayEvent,
  type PartyId,
  type Transaction,
} from "@/lib/engine";
import { fmtAndel, fmtDate, fmtEnheter, fmtKr } from "@/lib/format";
import { PARTY_LABELS } from "@/lib/seed";

const STATUS_LABEL: Record<Transaction["status"], string> = {
  draft: "Utkast",
  pending: "Väntar",
  approved: "Godkänd",
  disputed: "Tvistig",
};

const STATUS_VARIANT: Record<
  Transaction["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  pending: "secondary",
  approved: "default",
  disputed: "destructive",
};

const kr = (ore: number) => fmtKr(toKronor(ore));
/** Nollor visas som tankstreck, precis som i ett välskött kalkylark. */
const krOrDash = (ore: number) => (ore === 0 ? "–" : kr(ore));

function partyName(party: PartyId) {
  return PARTY_LABELS[party] ?? party;
}

function gross(tx: Transaction, parties: readonly PartyId[]) {
  return parties.reduce((sum, p) => sum + (tx.payments[p]?.gross ?? 0), 0);
}

function deductions(tx: Transaction, parties: readonly PartyId[]) {
  return parties.reduce((sum, p) => {
    const payment = tx.payments[p];
    if (!payment) return sum;
    return sum + (payment.discount ?? 0) + (payment.refund ?? 0) + (payment.insurance ?? 0);
  }, 0);
}

function taxEffect(tx: Transaction, parties: readonly PartyId[]) {
  return parties.reduce((sum, p) => sum + (tx.payments[p]?.taxEffect ?? 0), 0);
}

function net(tx: Transaction, parties: readonly PartyId[]) {
  return parties.reduce((sum, p) => sum + netPayment(tx.payments[p]), 0);
}

/**
 * Transaktionsmatrisen. Kolumnerna motsvarar avräkningsarkets registreringsdel
 * så att den som är van vid arket känner igen sig direkt.
 */
export function transactionColumns(
  agreement: AgreementParams,
  rules: CostCategoryRule[],
): GridColumn<Transaction>[] {
  const parties = agreement.parties;

  return [
    {
      key: "id",
      header: "ID",
      width: 5.5,
      text: (tx) => tx.id,
    },
    {
      key: "date",
      header: "Betalningsdag",
      width: 9,
      text: (tx) => fmtDate(tx.paymentDate),
      sortValue: (tx) => tx.paymentDate,
    },
    {
      key: "category",
      header: "Kostnadsslag",
      width: 10,
      text: (tx) => tx.category,
    },
    {
      key: "model",
      header: "I modellen",
      width: 7,
      text: (tx) => (ruleFor(rules, tx.category, tx.paymentDate)?.included ? "Ja" : "Nej"),
      render: (tx) => {
        const included = ruleFor(rules, tx.category, tx.paymentDate)?.included;
        return (
          <span className={included ? undefined : "text-muted-foreground"}>
            {included ? "Ja" : "Nej"}
          </span>
        );
      },
    },
    {
      key: "description",
      header: "Beskrivning",
      width: 18,
      text: (tx) => tx.description ?? "",
    },
    {
      key: "payer",
      header: "Betalare",
      width: 7.5,
      text: (tx) => {
        const payers = parties.filter((p) => (tx.payments[p]?.gross ?? 0) > 0);
        return payers.map(partyName).join(" + ") || "–";
      },
    },
    ...parties.map((party): GridColumn<Transaction> => ({
      key: `gross-${party}`,
      header: `Betalt ${partyName(party)}`,
      width: 8,
      numeric: true,
      text: (tx) => krOrDash(tx.payments[party]?.gross ?? 0),
      sortValue: (tx) => tx.payments[party]?.gross ?? 0,
    })),
    {
      key: "deductions",
      header: "Avdrag",
      width: 7,
      numeric: true,
      text: (tx) => krOrDash(deductions(tx, parties)),
      sortValue: (tx) => deductions(tx, parties),
    },
    {
      key: "tax",
      header: "Skatteeffekt",
      width: 8,
      numeric: true,
      text: (tx) => krOrDash(taxEffect(tx, parties)),
      sortValue: (tx) => taxEffect(tx, parties),
      render: (tx) => {
        const amount = taxEffect(tx, parties);
        const preliminary = parties.some((p) => tx.payments[p]?.taxPreliminary);
        if (amount === 0) return "–";
        return (
          <span className={preliminary ? "text-[color:var(--data-gold)]" : undefined}>
            {kr(amount)}
            {preliminary ? " *" : ""}
          </span>
        );
      },
    },
    {
      key: "net",
      header: "Nettokostnad",
      width: 8,
      numeric: true,
      text: (tx) => kr(net(tx, parties)),
      sortValue: (tx) => net(tx, parties),
    },
    {
      key: "key",
      header: "Särskild nyckel",
      width: 8,
      numeric: true,
      text: (tx) =>
        tx.specialKey ? parties.map((p) => fmtAndel(tx.specialKey?.[p] ?? 0, 0)).join(" / ") : "–",
    },
    {
      key: "loan",
      header: "Lånesaldo",
      width: 8,
      numeric: true,
      text: (tx) => (tx.loanBalanceAfter == null ? "–" : kr(tx.loanBalanceAfter)),
      sortValue: (tx) => tx.loanBalanceAfter ?? null,
    },
    {
      key: "corrects",
      header: "Korrigerar",
      width: 7,
      text: (tx) => tx.correctsId ?? "–",
    },
    {
      key: "status",
      header: "Status",
      width: 7,
      text: (tx) => STATUS_LABEL[tx.status],
      render: (tx) => (
        <Badge variant={STATUS_VARIANT[tx.status]} className="text-[0.7rem]">
          {STATUS_LABEL[tx.status]}
        </Badge>
      ),
    },
    {
      key: "gross-total",
      header: "Bruttobelopp",
      width: 8,
      numeric: true,
      text: (tx) => kr(gross(tx, parties)),
      sortValue: (tx) => gross(tx, parties),
    },
  ];
}

/**
 * Dagsberäkningen. Speglar avräkningsarkets beräkningskolumner, som annars är
 * dolda i arket, så att varje enhetsöverföring går att följa steg för steg.
 */
export function dayEventColumns(agreement: AgreementParams): GridColumn<DayEvent>[] {
  const parties = agreement.parties;

  return [
    {
      key: "date",
      header: "Betalningsdag",
      width: 9,
      text: (event) => fmtDate(event.date),
      sortValue: (event) => event.date,
    },
    {
      key: "ids",
      header: "Poster",
      width: 10,
      text: (event) => event.transactionIds.join(", "),
    },
    {
      key: "value",
      header: "Beräknat värde",
      width: 9,
      numeric: true,
      text: (event) => kr(event.linearValue),
      sortValue: (event) => event.linearValue,
    },
    {
      key: "loan",
      header: "Lånesaldo",
      width: 8,
      numeric: true,
      text: (event) => kr(event.loanBalance),
      sortValue: (event) => event.loanBalance,
    },
    {
      key: "equity",
      header: "Nettokapital",
      width: 9,
      numeric: true,
      text: (event) => kr(event.netEquity),
      sortValue: (event) => event.netEquity,
    },
    {
      key: "unit-value",
      header: "Värde/enhet",
      width: 7,
      numeric: true,
      text: (event) => (event.unitValue === null ? "–" : fmtKr(event.unitValue / 100, 4)),
      sortValue: (event) => event.unitValue,
    },
    ...parties.map((party): GridColumn<DayEvent> => ({
      key: `key-${party}`,
      header: `Nyckel ${partyName(party)}`,
      width: 8,
      numeric: true,
      text: (event) => fmtAndel(event.keyBefore[party]),
      sortValue: (event) => event.keyBefore[party],
    })),
    {
      key: "net-cost",
      header: "Nettokostnad",
      width: 8,
      numeric: true,
      text: (event) => kr(event.netCostTotal),
      sortValue: (event) => event.netCostTotal,
    },
    ...parties.map((party): GridColumn<DayEvent> => ({
      key: `diff-${party}`,
      header: `Skillnad ${partyName(party)}`,
      width: 9,
      numeric: true,
      text: (event) => krOrDash(event.difference[party]),
      sortValue: (event) => event.difference[party],
    })),
    {
      key: "overpayer",
      header: "Överbetalare",
      width: 8,
      text: (event) => (event.overpayer ? partyName(event.overpayer) : "–"),
    },
    {
      key: "overpayment",
      header: "Överbetalning",
      width: 9,
      numeric: true,
      text: (event) => krOrDash(event.overpayment),
      sortValue: (event) => event.overpayment,
    },
    {
      key: "units",
      header: "Överförda enheter",
      width: 9,
      numeric: true,
      text: (event) => (event.transferredUnits === 0 ? "–" : fmtEnheter(event.transferredUnits)),
      sortValue: (event) => event.transferredUnits,
    },
    {
      key: "claim",
      header: "Kvarstående fordran",
      width: 9,
      numeric: true,
      text: (event) => krOrDash(event.personalClaim?.amount ?? 0),
      sortValue: (event) => event.personalClaim?.amount ?? 0,
      render: (event) => {
        const amount = event.personalClaim?.amount ?? 0;
        if (amount === 0) return "–";
        return <span className="text-[color:var(--data-gold)]">{kr(amount)}</span>;
      },
    },
    ...parties.map((party): GridColumn<DayEvent> => ({
      key: `share-${party}`,
      header: `Andel ${partyName(party)}`,
      width: 8,
      numeric: true,
      text: (event) => fmtAndel(event.sharesAfter[party]),
      sortValue: (event) => event.sharesAfter[party],
    })),
  ];
}

/** Kostnadsslagens klassificeringar som matris. */
export function categoryColumns(): GridColumn<CostCategoryRule>[] {
  return [
    { key: "category", header: "Kostnadsslag", width: 14, text: (rule) => rule.category },
    {
      key: "treatment",
      header: "Behandling",
      width: 16,
      text: (rule) => (rule.included ? "Ingår i enhetsmodellen" : "Delas 50/50 utanför modellen"),
      render: (rule) => (
        <span className={rule.included ? undefined : "text-muted-foreground"}>
          {rule.included ? "Ingår i enhetsmodellen" : "Delas 50/50 utanför modellen"}
        </span>
      ),
    },
    {
      key: "loan",
      header: "Minskar lånet",
      width: 7,
      text: (rule) => (rule.reducesLoan ? "Ja" : "–"),
    },
    {
      key: "from",
      header: "Gäller från",
      width: 8,
      text: (rule) => fmtDate(rule.effectiveFrom),
      sortValue: (rule) => rule.effectiveFrom,
    },
    {
      key: "status",
      header: "Status",
      width: 8,
      text: (rule) => (rule.approved ? "Gäller" : "Inväntar båda"),
      render: (rule) => (
        <Badge variant={rule.approved ? "default" : "secondary"} className="text-[0.7rem]">
          {rule.approved ? "Gäller" : "Inväntar båda"}
        </Badge>
      ),
    },
  ];
}
