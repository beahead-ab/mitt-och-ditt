import { describe, expect, it } from "vitest";

import { normalizeSpaces } from "@/lib/__tests__/normalize";
import { settlementMarkdown, type SettlementFacts } from "@/lib/export/settlement";
import type { DocumentContext } from "@/lib/export/documents";
import { calculate, defaultCategoryRules, kr, type AgreementParams } from "@/lib/engine";

const AGREEMENT: AgreementParams = {
  startDate: "2026-08-17",
  startValue: kr(4_495_000),
  initialLoan: kr(3_115_000),
  parties: ["caesar", "felicia"],
  startUnits: { caesar: 1_200_000, felicia: 180_000 },
  totalUnits: 1_380_000,
};

const CONTEXT: DocumentContext = {
  householdName: "Caesar & Felicia",
  propertyAddress: "Exempelgatan 12",
  agreement: AGREEMENT,
  names: { caesar: "Caesar", felicia: "Felicia" },
  generatedAt: "2031-08-20T10:00:00Z",
  engineVersion: "1.0.0",
};

function settle(overrides: Partial<SettlementFacts> = {}) {
  const facts: SettlementFacts = {
    agreementSignedOn: "2026-08-10",
    endDate: "2031-08-17",
    basis: "extern-forsaljning",
    endValue: kr(5_500_000),
    endLoan: kr(2_800_000),
    saleCosts: kr(80_000),
    notes: null,
    checksum: "abc123def456",
    ...overrides,
  };
  const result = calculate({
    agreement: AGREEMENT,
    endpoint: {
      mode: "slutlig",
      endDate: facts.endDate,
      endValue: facts.endValue,
      endLoan: facts.endLoan,
      saleCosts: facts.saleCosts,
    },
    categoryRules: defaultCategoryRules(AGREEMENT.startDate),
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
  return { markdown: normalizeSpaces(settlementMarkdown(CONTEXT, result, facts)), result };
}

describe("Slutberäkningsprotokollet", () => {
  it("innehåller bilaga 3:s uppgiftsfält", () => {
    const { markdown } = settle();
    for (const field of [
      "Huvudavtalets datum",
      "Startdag",
      "Startvärde",
      "Slutdag",
      "Slutvärdets grund",
      "Slutvärde",
      "Kvarvarande externa lån",
      "Faktiska direkta försäljningskostnader",
      "Försäljningsnetto",
      "Checksumma",
    ]) {
      expect(markdown, field).toContain(field);
    }
  });

  it("visar försäljningsnettot enligt avtalets formel", () => {
    const { markdown, result } = settle();
    // 5 500 000 − 2 800 000 − 80 000 = 2 620 000 kr.
    expect(result.settlement.saleNet).toBe(kr(2_620_000));
    expect(markdown).toContain("2 620 000");
  });

  it("redovisar kontrollerna med både förväntat och faktiskt värde", () => {
    const { markdown } = settle();
    expect(markdown).toContain("Totalt antal andelsenheter oförändrat");
    expect(markdown).toContain("100,0000 %");
    expect(markdown).toContain("Samtliga kontroller stämmer.");
  });

  it("nämner att hypotetiskt mäklararvode inte dras av vid utköp", () => {
    const { markdown } = settle({ basis: "utkopsvardering", saleCosts: 0 });
    expect(markdown).toContain("Utköpsvärdering");
    expect(markdown).toContain("hypotetiskt mäklararvode");
  });

  it("nämner det inte vid extern försäljning", () => {
    const { markdown } = settle();
    expect(markdown).not.toContain("hypotetiskt mäklararvode");
  });

  it("håller skatten utanför beräkningen", () => {
    const { markdown } = settle();
    expect(markdown).toContain("deklareras separat enligt lag");
  });

  it("har underskriftsrader för båda parter", () => {
    const { markdown } = settle();
    expect(markdown).toContain("Namnförtydligande: Caesar");
    expect(markdown).toContain("Namnförtydligande: Felicia");
    expect(markdown).toContain("Underskrift:");
  });

  it("tar med parternas anteckningar när de finns", () => {
    const { markdown } = settle({ notes: "Mäklararvodet enligt faktura 4711." });
    expect(markdown).toContain("Mäklararvodet enligt faktura 4711.");
  });

  it("visar betalningsdagarna som påverkat andelarna", () => {
    const { markdown } = settle();
    expect(markdown).toContain("Behandlade betalningsdagar");
    expect(markdown).toContain("T-0001");
  });
});
