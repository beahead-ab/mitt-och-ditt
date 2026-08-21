import { describe, expect, it } from "vitest";

import { defaultEndpoint, run } from "@/lib/calculation";
import { DEMO_AGREEMENT, DEMO_TRANSACTIONS } from "@/lib/demo";
import { defaultCategoryRules, toKronor } from "@/lib/engine";

/**
 * Skyddar kopplingen mellan avtal och kostnadsklassificering. Härleds
 * klassificeringarna från fel startdag gäller ingen av dem, och varje post
 * hamnar tyst utanför enhetsmodellen – ett fel som inte syns i motorn.
 */
describe("Demounderlaget körs genom modellen", () => {
  const rules = defaultCategoryRules(DEMO_AGREEMENT.startDate);
  const endpoint = defaultEndpoint(DEMO_AGREEMENT, rules, DEMO_TRANSACTIONS, "2026-08-21");
  const result = run(DEMO_AGREEMENT, rules, DEMO_TRANSACTIONS, endpoint);

  it("behandlar de inkluderade kostnadsslagen i enhetsmodellen", () => {
    expect(result.events.length).toBeGreaterThan(0);
    const handled = result.events.flatMap((e) => e.transactionIds);
    expect(handled).toContain("T-0001");
    expect(handled).toContain("T-0004");
  });

  it("lägger bara BRF-avgiften utanför modellen", () => {
    expect(result.outside.entries.map((e) => e.transactionId)).toEqual(["T-0005"]);
  });

  it("utesluter posten som väntar på godkännande", () => {
    expect(result.excluded).toContainEqual({
      transactionId: "T-0006",
      reason: "Inte godkänd av båda parter",
    });
  });

  it("bokför ränta och amortering samma dag som en samlad post", () => {
    const sameDay = result.events.find((e) => e.transactionIds.length === 2);
    expect(sameDay?.transactionIds).toEqual(["T-0002", "T-0003"]);
    // Lånet minskar med amorteringen redan samma dag (avtal 9.2).
    expect(toKronor(sameDay?.loanBalance ?? 0)).toBe(3_115_000 - 9_000);
  });

  it("håller summakontrollerna gröna", () => {
    expect(result.settlement.checks.ok).toBe(true);
    expect(result.finalUnits.caesar + result.finalUnits.felicia).toBeCloseTo(1_380_000, 6);
  });
});
