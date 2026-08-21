import { toKronor, type EngineResult, type PartyId } from "@/lib/engine";
import { fmtAndel, fmtDate, fmtEnheter, fmtKr } from "@/lib/format";
import type { DocumentContext } from "./documents";

/**
 * Slutberäkningsprotokollet enligt avtalets bilaga 3.
 *
 * Protokollet är den handling parterna undertecknar när avräkningen är klar.
 * Det innehåller därför både uppgifterna beräkningen vilar på och de
 * kontroller som visar att den går ihop – annars går det inte att granska i
 * efterhand.
 */

export type ValueBasis = "extern-forsaljning" | "utkopsvardering" | "annan";

const BASIS_LABEL: Record<ValueBasis, string> = {
  "extern-forsaljning": "Extern försäljning",
  utkopsvardering: "Utköpsvärdering",
  annan: "Annan grund",
};

export type SettlementFacts = {
  /** Datum för det undertecknade huvudavtalet. */
  agreementSignedOn: string | null;
  endDate: string;
  basis: ValueBasis;
  endValue: number;
  endLoan: number;
  saleCosts: number;
  /** Underlag och kommentarer som parterna vill föra in i protokollet. */
  notes: string | null;
  /** Checksumma över frysta indata och resultat. */
  checksum: string;
};

function nameOf(names: Record<PartyId, string>, party: PartyId): string {
  return names[party] ?? party;
}

function table(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

export function settlementMarkdown(
  context: DocumentContext,
  result: EngineResult,
  facts: SettlementFacts,
): string {
  const { agreement, names } = context;
  const [a, b] = agreement.parties;
  const checks = result.settlement.checks;

  return [
    "# Slutberäkningsprotokoll",
    "",
    `**Hushåll:** ${context.householdName}`,
    context.propertyAddress ? `**Bostad:** ${context.propertyAddress}` : null,
    `**Framställt:** ${fmtDate(context.generatedAt)}`,
    "",
    "## Uppgifter beräkningen vilar på",
    "",
    table(
      ["Fält", "Uppgift"],
      [
        ["Huvudavtalets datum", facts.agreementSignedOn ? fmtDate(facts.agreementSignedOn) : "–"],
        ["Startdag", fmtDate(agreement.startDate)],
        ["Startvärde", fmtKr(toKronor(agreement.startValue))],
        ["Slutdag", fmtDate(facts.endDate)],
        ["Slutvärdets grund", BASIS_LABEL[facts.basis]],
        ["Slutvärde", fmtKr(toKronor(facts.endValue))],
        ["Kvarvarande externa lån", fmtKr(toKronor(facts.endLoan))],
        ["Faktiska direkta försäljningskostnader", fmtKr(toKronor(facts.saleCosts))],
        ["Försäljningsnetto", fmtKr(toKronor(result.settlement.saleNet))],
        ["Totalt antal andelsenheter", fmtEnheter(agreement.totalUnits)],
        ["Beräkningsmotor", result.engineVersion],
        ["Checksumma", facts.checksum],
      ],
    ),
    "",
    facts.basis === "utkopsvardering"
      ? "> Vid utköp dras inget hypotetiskt mäklararvode av, eftersom kostnaden inte\n> faktiskt uppkommer."
      : null,
    "",
    "## Slutlig fördelning",
    "",
    table(
      ["Post", nameOf(names, a), nameOf(names, b)],
      [
        [
          "Slutliga andelsenheter",
          fmtEnheter(result.finalUnits[a]),
          fmtEnheter(result.finalUnits[b]),
        ],
        [
          "Slutlig intern ekonomisk andel",
          fmtAndel(result.finalShares[a]),
          fmtAndel(result.finalShares[b]),
        ],
        [
          "Andel av försäljningsnettot",
          fmtKr(toKronor(result.settlement.byShare[a])),
          fmtKr(toKronor(result.settlement.byShare[b])),
        ],
        [
          "Personliga fordringar, netto",
          fmtKr(toKronor(result.settlement.claimsNet[a])),
          fmtKr(toKronor(result.settlement.claimsNet[b])),
        ],
        [
          "Kostnader utanför enhetsmodellen, netto",
          fmtKr(toKronor(result.settlement.outsideNet[a])),
          fmtKr(toKronor(result.settlement.outsideNet[b])),
        ],
        [
          "Slutposition före individuell skatt",
          fmtKr(toKronor(result.settlement.finalPosition[a])),
          fmtKr(toKronor(result.settlement.finalPosition[b])),
        ],
      ],
    ),
    "",
    "## Kontroller",
    "",
    table(
      ["Kontroll", "Ska vara", "Utfall"],
      [
        [
          "Totalt antal andelsenheter oförändrat",
          fmtEnheter(agreement.totalUnits),
          fmtEnheter(result.finalUnits[a] + result.finalUnits[b]),
        ],
        [
          "Andelarna summerar till 100 %",
          "100,0000 %",
          fmtAndel(result.finalShares[a] + result.finalShares[b]),
        ],
        [
          "Slutpositionerna summerar till försäljningsnettot",
          fmtKr(toKronor(result.settlement.saleNet)),
          fmtKr(toKronor(result.settlement.finalPosition[a] + result.settlement.finalPosition[b])),
        ],
      ],
    ),
    "",
    checks.ok
      ? "Samtliga kontroller stämmer."
      : "**En eller flera kontroller avviker. Protokollet får inte undertecknas förrän avvikelsen är utredd.**",
    "",
    "## Behandlade betalningsdagar",
    "",
    result.events.length === 0
      ? "Inga godkända poster har påverkat andelarna."
      : table(
          ["Betalningsdag", "Poster", "Nettokapital", "Värde/enhet", "Överbetalning", "Enheter"],
          result.events.map((event) => [
            fmtDate(event.date),
            event.transactionIds.join(", "),
            fmtKr(toKronor(event.netEquity)),
            event.unitValue === null ? "–" : fmtKr(event.unitValue / 100, 4),
            event.overpayment === 0 ? "–" : fmtKr(toKronor(event.overpayment)),
            event.transferredUnits === 0 ? "–" : fmtEnheter(event.transferredUnits),
          ]),
        ),
    "",
    "## Underlag och kommentarer",
    "",
    facts.notes?.trim() ? facts.notes.trim() : "–",
    "",
    "## Skatt",
    "",
    "Skattemässig vinst eller förlust beräknas och deklareras separat enligt lag.",
    "Den kan följa formell ägarandel och respektive parts skattemässiga historik,",
    "och beräknas därför inte här.",
    "",
    "## Bekräftelse",
    "",
    "Parterna bekräftar att godkända transaktioner, lånesaldon och slutvärde har",
    "kontrollerats, att samma belopp inte har räknats både som andelsenheter och",
    "fordran, och att protokollet visar den slutliga interna avräkningen.",
    "",
    table(
      [nameOf(names, a), nameOf(names, b)],
      [
        [
          "Ort och datum: ............................",
          "Ort och datum: ............................",
        ],
        ["Underskrift: ............................", "Underskrift: ............................"],
        [`Namnförtydligande: ${nameOf(names, a)}`, `Namnförtydligande: ${nameOf(names, b)}`],
      ],
    ),
    "",
    `*Framställt ur Mitt & Ditt. Beräkningen kan när som helst räknas om ur frysta indata och ska då ge exakt samma resultat.*`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}
