import { describe, expect, it } from "vitest";

import { addDays, addMonths, daysBetween, parseDate } from "../dates";
import { kr, roundHalfAwayFromZero, splitExact, toKronor } from "../money";
import { defaultCategoryRules, outsideSplitFor, ruleFor } from "../rules";

describe("Kalenderdatum", () => {
  it("räknar hela kalenderdagar", () => {
    expect(daysBetween("2026-08-17", "2026-08-18")).toBe(1);
    expect(daysBetween("2026-08-17", "2026-08-17")).toBe(0);
    expect(daysBetween("2026-08-18", "2026-08-17")).toBe(-1);
  });

  it("påverkas inte av sommartid", () => {
    // Sommartiden slutar i Sverige natten till 2026-10-25.
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
  });

  it("räknar med skottdagar", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-08-17", "2031-08-17")).toBe(1_826);
  });

  it("lägger till månader och klipper till månadens sista dag", () => {
    expect(addMonths("2026-08-17", 3)).toBe("2026-11-17");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2027-11-30", 3)).toBe("2028-02-29");
  });

  it("lägger till dagar över årsskifte", () => {
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
  });

  it("avvisar ogiltiga datum", () => {
    expect(() => parseDate("2026-13-01")).toThrow();
    expect(() => parseDate("2026-02-30")).toThrow();
    expect(() => parseDate("17/8 2026")).toThrow();
  });
});

describe("Belopp", () => {
  it("räknar i öre utan flyttalsdrift", () => {
    expect(kr(0.1) + kr(0.2)).toBe(kr(0.3));
    expect(kr(4_495_000)).toBe(449_500_000);
    expect(toKronor(kr(1_234.56))).toBe(1_234.56);
  });

  it("avrundar symmetriskt bort från noll", () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
  });

  it("fördelar utan att en öre försvinner", () => {
    for (const total of [1, 7, 333, 100_001, -55]) {
      const [first, second] = splitExact(total, 1 / 3);
      expect(first + second).toBe(total);
    }
  });
});

describe("Kostnadsklassificering", () => {
  const rules = defaultCategoryRules("2026-08-17");

  it("grundklassificeringen följer avtalets punkt 7", () => {
    expect(ruleFor(rules, "Amortering", "2026-09-01")?.included).toBe(true);
    expect(ruleFor(rules, "Ränta", "2026-09-01")?.included).toBe(true);
    expect(ruleFor(rules, "BRF-avgift", "2026-09-01")?.included).toBe(false);
    expect(ruleFor(rules, "Försäkring", "2026-09-01")?.included).toBe(false);
    expect(ruleFor(rules, "Okänt", "2026-09-01")).toBeNull();
  });

  it("amortering är det kostnadsslag som minskar lånet", () => {
    expect(ruleFor(rules, "Amortering", "2026-09-01")?.reducesLoan).toBe(true);
    expect(ruleFor(rules, "Ränta", "2026-09-01")?.reducesLoan).toBe(false);
  });

  it("senaste giltiga klassificering gäller", () => {
    const extended = [
      ...rules,
      { category: "Ränta", effectiveFrom: "2027-01-01", included: false, approved: true },
      { category: "Ränta", effectiveFrom: "2028-01-01", included: true, approved: true },
    ];
    expect(ruleFor(extended, "Ränta", "2026-12-31")?.included).toBe(true);
    expect(ruleFor(extended, "Ränta", "2027-06-01")?.included).toBe(false);
    expect(ruleFor(extended, "Ränta", "2028-06-01")?.included).toBe(true);
  });

  it("en klassificering som inte båda godkänt räknas inte", () => {
    const extended = [
      ...rules,
      { category: "Ränta", effectiveFrom: "2027-01-01", included: false, approved: false },
    ];
    expect(ruleFor(extended, "Ränta", "2027-06-01")?.included).toBe(true);
  });

  it("fördelning utanför modellen är hälften vardera om inget annat avtalats", () => {
    const parties: [string, string] = ["a", "b"];
    expect(outsideSplitFor(null, parties)).toEqual({ a: 0.5, b: 0.5 });
    expect(
      outsideSplitFor(
        {
          category: "x",
          effectiveFrom: "2026-08-17",
          included: false,
          approved: true,
          outsideSplit: { a: 70, b: 30 },
        },
        parties,
      ),
    ).toEqual({ a: 0.7, b: 0.3 });
  });
});
