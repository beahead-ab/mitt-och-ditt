import { toKronor, type AgreementParams, type EngineResult, type PartyId } from "@/lib/engine";
import { fmtAndel, fmtDate, fmtEnheter, fmtKr } from "@/lib/format";

/**
 * Underlagen som dokument. Markdown först, eftersom det är läsbart som text,
 * versionshanterbart och lätt att rendera vidare till PDF.
 */

export type PartyNames = Record<PartyId, string>;

export type DocumentContext = {
  householdName: string;
  propertyAddress: string | null;
  agreement: AgreementParams;
  names: PartyNames;
  /** Tidpunkten dokumentet skapades, i UTC. */
  generatedAt: string;
  engineVersion: string;
};

function nameOf(names: PartyNames, party: PartyId): string {
  return names[party] ?? party;
}

function table(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

/**
 * Den gällande överenskommelsen som dokument. Motsvarar avräkningsunderlagets
 * flik "Gällande överenskommelse".
 */
export function agreementMarkdown(context: DocumentContext): string {
  const { agreement, names } = context;
  const [a, b] = agreement.parties;

  return [
    `# Gällande överenskommelse`,
    "",
    `**Hushåll:** ${context.householdName}`,
    context.propertyAddress ? `**Bostad:** ${context.propertyAddress}` : null,
    `**Framställt:** ${fmtDate(context.generatedAt)}`,
    "",
    "## Grunduppgifter",
    "",
    table(
      ["Uppgift", "Värde"],
      [
        ["Startdag", fmtDate(agreement.startDate)],
        ["Startvärde", fmtKr(toKronor(agreement.startValue))],
        ["Bolån på startdagen", fmtKr(toKronor(agreement.initialLoan))],
        ["Totalt antal andelsenheter", fmtEnheter(agreement.totalUnits)],
      ],
    ),
    "",
    "## Kapitalinsatser och startenheter",
    "",
    table(
      ["Part", "Startenheter", "Intern startandel"],
      [a, b].map((party) => [
        nameOf(names, party),
        fmtEnheter(agreement.startUnits[party] ?? 0),
        fmtAndel((agreement.startUnits[party] ?? 0) / agreement.totalUnits),
      ]),
    ),
    "",
    "En andelsenhet per krona styrkt initialt eget kapital. Kapitalinsatserna",
    "hanteras uteslutande genom startenheterna och registreras aldrig som",
    "transaktioner.",
    "",
    "## Formell ägarandel",
    "",
    agreement.formalOwnership
      ? table(
          ["Part", "Formell ägarandel"],
          [a, b].map((party) => [
            nameOf(names, party),
            fmtAndel(agreement.formalOwnership?.[party] ?? 0),
          ]),
        )
      : "Inte registrerad.",
    "",
    "Följer köpehandlingen och föreningens uppgifter. Den interna ekonomiska",
    "andelen ändrar den aldrig.",
    "",
    "## Ändringar som kräver undertecknat tilläggsavtal",
    "",
    [
      "samboavtalsdelen",
      "formella ägarandelar",
      "startvärdet",
      "startdagen",
      "den linjära beräkningsformeln",
      "slutavräkningsregeln",
      "tremånadersregeln",
    ]
      .map((item) => `- ${item}`)
      .join("\n"),
    "",
    `*Framställt ur Mitt & Ditt. Beräkningsmotor ${context.engineVersion}.*`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Sammanställningen: läget just nu med de antaganden som gäller. Motsvarar
 * arkets flik "Sammanställning".
 */
export function summaryMarkdown(
  context: DocumentContext,
  result: EngineResult,
  endpoint: {
    mode: string;
    endDate: string;
    endValue: number;
    endLoan: number;
    saleCosts?: number;
  },
): string {
  const { agreement, names } = context;
  const [a, b] = agreement.parties;
  const preliminary = endpoint.mode === "prognos";

  return [
    `# Sammanställning`,
    "",
    `**Hushåll:** ${context.householdName}`,
    context.propertyAddress ? `**Bostad:** ${context.propertyAddress}` : null,
    `**Läge:** ${preliminary ? "Prognos" : "Slutavräkning"}`,
    `**Framställt:** ${fmtDate(context.generatedAt)}`,
    "",
    preliminary
      ? "> Detta är en prognos. Resultatet blir bindande enligt avtalet först när\n> verkligt försäljningspris eller fastställt utköpsvärde används i\n> slutavräkningen."
      : "> Slutavräkning med fastställda uppgifter.",
    "",
    "## Antaganden",
    "",
    table(
      ["Uppgift", "Värde"],
      [
        ["Slutdag", fmtDate(endpoint.endDate)],
        [
          preliminary ? "Antaget slutvärde" : "Fastställt slutvärde",
          fmtKr(toKronor(endpoint.endValue)),
        ],
        ["Kvarvarande lån", fmtKr(toKronor(endpoint.endLoan))],
        ["Faktiska försäljningskostnader", fmtKr(toKronor(endpoint.saleCosts ?? 0))],
      ],
    ),
    "",
    "## Utfall",
    "",
    table(
      ["Post", nameOf(names, a), nameOf(names, b)],
      [
        [
          "Slutliga andelsenheter",
          fmtEnheter(result.finalUnits[a]),
          fmtEnheter(result.finalUnits[b]),
        ],
        ["Slutlig intern andel", fmtAndel(result.finalShares[a]), fmtAndel(result.finalShares[b])],
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
          "Utanför enhetsmodellen, netto",
          fmtKr(toKronor(result.settlement.outsideNet[a])),
          fmtKr(toKronor(result.settlement.outsideNet[b])),
        ],
        [
          "Beräknad utbetalning",
          fmtKr(toKronor(result.settlement.finalPosition[a])),
          fmtKr(toKronor(result.settlement.finalPosition[b])),
        ],
      ],
    ),
    "",
    `Försäljningsnetto: ${fmtKr(toKronor(result.settlement.saleNet))}.`,
    "",
    "## Kontroller",
    "",
    table(
      ["Kontroll", "Utfall"],
      [
        [
          "Totalt antal enheter oförändrat",
          Math.abs(result.settlement.checks.unitsBalance) < 1e-6 ? "OK" : "AVVIKER",
        ],
        [
          "Andelarna summerar till 100 %",
          Math.abs(result.settlement.checks.sharesBalance) < 1e-9 ? "OK" : "AVVIKER",
        ],
        [
          "Slutpositionerna summerar till försäljningsnettot",
          result.settlement.checks.positionsBalance === 0 ? "OK" : "AVVIKER",
        ],
      ],
    ),
    "",
    "## Behandlade betalningsdagar",
    "",
    result.events.length === 0
      ? "Inga godkända poster påverkar andelarna än."
      : table(
          [
            "Betalningsdag",
            "Poster",
            "Beräknat värde",
            "Nettokapital",
            "Värde/enhet",
            "Överbetalning",
            "Enheter",
          ],
          result.events.map((event) => [
            fmtDate(event.date),
            event.transactionIds.join(", "),
            fmtKr(toKronor(event.linearValue)),
            fmtKr(toKronor(event.netEquity)),
            event.unitValue === null ? "–" : fmtKr(event.unitValue / 100, 4),
            event.overpayment === 0 ? "–" : fmtKr(toKronor(event.overpayment)),
            event.transferredUnits === 0 ? "–" : fmtEnheter(event.transferredUnits),
          ]),
        ),
    "",
    result.warnings.length > 0
      ? ["## Att kontrollera", "", ...result.warnings.map((warning) => `- ${warning}`), ""].join(
          "\n",
        )
      : null,
    "Mellanvärdena är en avtalad räknemetod, inte historiska marknadsvärderingar.",
    "",
    `*Framställt ur Mitt & Ditt. Beräkningsmotor ${result.engineVersion}.*`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}
