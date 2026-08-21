import { describe, expect, it } from "vitest";

import { normalizeSpaces, parseCsv } from "@/lib/__tests__/normalize";
import { escapeField, exportFilename, formatNumber, toCsv } from "@/lib/export/csv";
import { agreementMarkdown, summaryMarkdown } from "@/lib/export/documents";
import { transactionCsvColumns } from "@/lib/export/transactions";
import {
  calculate,
  defaultCategoryRules,
  kr,
  type AgreementParams,
  type Transaction,
} from "@/lib/engine";

const AGREEMENT: AgreementParams = {
  startDate: "2026-08-17",
  startValue: kr(4_495_000),
  initialLoan: kr(3_115_000),
  parties: ["caesar", "felicia"],
  startUnits: { caesar: 1_200_000, felicia: 180_000 },
  totalUnits: 1_380_000,
};
const RULES = defaultCategoryRules(AGREEMENT.startDate);
const NAMES = { caesar: "Caesar", felicia: "Felicia" };

describe("CSV för svenska Excel", () => {
  it("citerar bara fält som behöver det", () => {
    expect(escapeField("Reparation")).toBe("Reparation");
    expect(escapeField("Badrum; kakel")).toBe('"Badrum; kakel"');
    expect(escapeField('Han sa "nej"')).toBe('"Han sa ""nej"""');
    expect(escapeField("två\nrader")).toBe('"två\nrader"');
    expect(escapeField("")).toBe("");
  });

  it("skriver tal med decimalkomma", () => {
    expect(formatNumber(1234.5)).toBe("1234,50");
    expect(formatNumber(-0.25)).toBe("-0,25");
    expect(formatNumber(0)).toBe("0,00");
    expect(formatNumber(Number.NaN)).toBe("");
  });

  it("inleder filen med byte order mark och använder semikolon", () => {
    const csv = toCsv(
      [
        { header: "Post", value: (row: { a: string }) => row.a },
        { header: "Belopp", value: () => 12.5 },
      ],
      [{ a: "Kvitto" }],
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Post;Belopp");
    expect(csv).toContain("Kvitto;12,50");
    expect(csv).toContain("\r\n");
  });

  it("hanterar tomma värden utan att tappa kolumner", () => {
    const csv = toCsv(
      [
        { header: "A", value: () => null },
        { header: "B", value: () => undefined },
        { header: "C", value: () => "x" },
      ],
      [{}],
    );
    const dataRow = csv.split("\r\n")[1];
    expect(dataRow).toBe(";;x");
  });

  it("bygger filnamn utan å, ä och ö", () => {
    expect(exportFilename("Transaktioner & underlag", "csv", "2026-08-21T10:00:00Z")).toBe(
      "transaktioner-underlag-2026-08-21.csv",
    );
    expect(exportFilename("Slutavräkning", "pdf", "2026-08-21T10:00:00Z")).toBe(
      "slutavrakning-2026-08-21.pdf",
    );
  });
});

describe("Transaktionsexport", () => {
  const transactions: Transaction[] = [
    {
      id: "T-0001",
      paymentDate: "2026-09-07",
      category: "Ränta",
      description: "Kvartalsränta; efter avdrag",
      payments: {
        caesar: { gross: kr(11_200), taxEffect: kr(3_360), taxPreliminary: true },
        felicia: { gross: kr(4_800), taxEffect: kr(1_440) },
      },
      status: "approved",
    },
  ];

  it("tar med varje parts betalning och avdrag var för sig", () => {
    const csv = toCsv(transactionCsvColumns(AGREEMENT, RULES, NAMES), transactions);
    expect(csv).toContain("Betalt Caesar");
    expect(csv).toContain("Skatteeffekt Felicia");
    expect(csv).toContain("11200,00");
    // Nettobetalning efter skatteeffekt.
    expect(csv).toContain("7840,00");
  });

  it("citerar beskrivningen som innehåller semikolon", () => {
    const csv = toCsv(transactionCsvColumns(AGREEMENT, RULES, NAMES), transactions);
    expect(csv).toContain('"Kvartalsränta; efter avdrag"');
  });

  it("markerar preliminär skatteeffekt", () => {
    const [header, row] = parseCsv(
      toCsv(transactionCsvColumns(AGREEMENT, RULES, NAMES), transactions),
    );
    expect(row[header.indexOf("Preliminär skatteeffekt")]).toBe("Ja");
  });

  it("går att läsa tillbaka med lika många fält på varje rad", () => {
    const rows = parseCsv(toCsv(transactionCsvColumns(AGREEMENT, RULES, NAMES), transactions));
    const columns = rows[0].length;
    for (const row of rows) expect(row.length).toBe(columns);
    // Beskrivningen med semikolon ska komma tillbaka hel.
    expect(rows[1][rows[0].indexOf("Beskrivning")]).toBe("Kvartalsränta; efter avdrag");
  });
});

describe("Dokument", () => {
  const context = {
    householdName: "Caesar & Felicia",
    propertyAddress: "Exempelgatan 12",
    agreement: AGREEMENT,
    names: NAMES,
    generatedAt: "2026-08-21T10:00:00Z",
    engineVersion: "1.0.0",
  };

  it("överenskommelsen innehåller grunduppgifterna och låsta fält", () => {
    const markdown = normalizeSpaces(agreementMarkdown(context));
    expect(markdown).toContain("# Gällande överenskommelse");
    expect(markdown).toContain("Startdag");
    expect(markdown).toContain("1 200 000");
    expect(markdown).toContain("86,9565");
    expect(markdown).toContain("tremånadersregeln");
  });

  it("sammanställningen märks som prognos och visar kontrollerna", () => {
    const endpoint = {
      mode: "prognos" as const,
      endDate: "2031-08-17",
      endValue: kr(4_495_000),
      endLoan: kr(3_115_000),
      saleCosts: 0,
    };
    const result = calculate({
      agreement: AGREEMENT,
      endpoint,
      categoryRules: RULES,
      transactions: [
        {
          id: "T-0001",
          paymentDate: "2026-09-07",
          category: "Vitvara/fast utrustning",
          payments: { felicia: { gross: kr(12_400) } },
          status: "approved",
        },
      ],
    });

    const markdown = normalizeSpaces(summaryMarkdown(context, result, endpoint));
    expect(markdown).toContain("**Läge:** Prognos");
    expect(markdown).toContain("Detta är en prognos");
    expect(markdown).toContain("Slutlig intern andel");
    expect(markdown).toContain("Totalt antal enheter oförändrat | OK");
    expect(markdown).toContain("Behandlade betalningsdagar");
    expect(markdown).toContain("Beräkningsmotor 1.0.0");
  });

  it("sammanställningen i slutläge saknar prognosvarningen", () => {
    const endpoint = {
      mode: "slutlig" as const,
      endDate: "2031-08-17",
      endValue: kr(5_500_000),
      endLoan: kr(2_800_000),
      saleCosts: kr(80_000),
    };
    const result = calculate({
      agreement: AGREEMENT,
      endpoint,
      categoryRules: RULES,
      transactions: [],
    });
    const markdown = normalizeSpaces(summaryMarkdown(context, result, endpoint));
    expect(markdown).toContain("**Läge:** Slutavräkning");
    expect(markdown).not.toContain("Detta är en prognos");
  });
});
