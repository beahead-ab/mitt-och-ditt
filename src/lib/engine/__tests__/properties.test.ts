import { describe, expect, it } from "vitest";

import { calculate } from "../engine";
import { addDays } from "../dates";
import { kr } from "../money";
import type { EngineInput, Transaction } from "../types";
import { AGREEMENT, CAESAR, FELICIA, RULES, START_DATE, flatEndpoint, input, tx } from "./fixtures";

/** Ett blandat, realistiskt underlag som används av flera egenskapstester. */
function mixedTransactions(): Transaction[] {
  return [
    tx({
      id: "T1",
      paymentDate: addDays(START_DATE, 30),
      category: "Ränta",
      payments: {
        [CAESAR]: { gross: kr(4_000), taxEffect: kr(1_200) },
        [FELICIA]: { gross: kr(6_000), taxEffect: kr(1_800) },
      },
    }),
    tx({
      id: "T2",
      paymentDate: addDays(START_DATE, 30),
      category: "Amortering",
      payments: { [FELICIA]: { gross: kr(10_000) } },
    }),
    tx({
      id: "T3",
      paymentDate: addDays(START_DATE, 200),
      category: "Reparation",
      payments: { [CAESAR]: { gross: kr(25_000), discount: kr(2_500) } },
    }),
    tx({
      id: "T4",
      paymentDate: addDays(START_DATE, 400),
      category: "Vitvara/fast utrustning",
      payments: { [FELICIA]: { gross: kr(18_000) } },
    }),
    tx({
      id: "T5",
      paymentDate: addDays(START_DATE, 400),
      category: "BRF-avgift",
      payments: { [CAESAR]: { gross: kr(4_200) } },
    }),
  ];
}

describe("Egenskaper som alltid måste gälla", () => {
  it("registreringsordningen påverkar aldrig resultatet", () => {
    const base = mixedTransactions();
    const shuffled = [base[3], base[0], base[4], base[2], base[1]];

    const a = calculate(input({ transactions: base }));
    const b = calculate(input({ transactions: shuffled }));

    expect(b.finalUnits).toEqual(a.finalUnits);
    expect(b.settlement.finalPosition).toEqual(a.settlement.finalPosition);
    expect(b.outside.balance).toEqual(a.outside.balance);
  });

  it("modellen är symmetrisk: byter parterna plats speglas resultatet", () => {
    const forward = calculate(input({ transactions: mixedTransactions() }));

    // Samma scenario med parternas roller och startenheter utbytta.
    const mirrored: EngineInput = {
      agreement: {
        ...AGREEMENT,
        parties: [FELICIA, CAESAR],
        startUnits: { [FELICIA]: 1_200_000, [CAESAR]: 180_000 },
      },
      endpoint: flatEndpoint(),
      categoryRules: RULES,
      transactions: mixedTransactions().map((t) => ({
        ...t,
        payments: { [CAESAR]: t.payments[FELICIA], [FELICIA]: t.payments[CAESAR] },
      })),
    };
    const backward = calculate(mirrored);

    expect(backward.finalUnits[FELICIA]).toBeCloseTo(forward.finalUnits[CAESAR], 6);
    expect(backward.finalUnits[CAESAR]).toBeCloseTo(forward.finalUnits[FELICIA], 6);
    expect(backward.settlement.finalPosition[FELICIA]).toBe(
      forward.settlement.finalPosition[CAESAR],
    );
  });

  it("det totala antalet enheter är alltid oförändrat", () => {
    for (const endValue of [kr(3_000_000), kr(4_495_000), kr(6_000_000)]) {
      const result = calculate(
        input({ endpoint: flatEndpoint({ endValue }), transactions: mixedTransactions() }),
      );
      expect(result.finalUnits[CAESAR] + result.finalUnits[FELICIA]).toBeCloseTo(
        AGREEMENT.totalUnits,
        6,
      );
      expect(result.settlement.checks.unitsBalance).toBeCloseTo(0, 6);
    }
  });

  it("andelarna summerar alltid till 100 procent och slutpositionerna till försäljningsnettot", () => {
    const result = calculate(input({ transactions: mixedTransactions() }));
    expect(result.finalShares[CAESAR] + result.finalShares[FELICIA]).toBeCloseTo(1, 12);
    expect(result.settlement.checks.positionsBalance).toBe(0);
    expect(result.settlement.checks.ok).toBe(true);
  });

  it("samma andelar används även när slutresultatet är negativt", () => {
    const result = calculate(
      input({
        endpoint: flatEndpoint({ endValue: kr(2_900_000), saleCosts: kr(80_000) }),
        transactions: mixedTransactions(),
      }),
    );
    expect(result.settlement.saleNet).toBeLessThan(0);
    expect(result.settlement.byShare[CAESAR]).toBeLessThan(0);
    expect(result.settlement.byShare[FELICIA]).toBeLessThan(0);
    expect(result.settlement.checks.positionsBalance).toBe(0);
  });

  it("ett belopp räknas aldrig både som enheter och som fordran", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            category: "Förbättring",
            payments: { [CAESAR]: { gross: kr(1_000_000) } },
            specialKey: { [CAESAR]: 0, [FELICIA]: 1 },
          }),
        ],
      }),
    );
    const event = result.events[0];
    expect(event.convertedAmount + (event.personalClaim?.amount ?? 0)).toBe(event.overpayment);
  });

  it("beräkningen är deterministisk", () => {
    const one = calculate(input({ transactions: mixedTransactions() }));
    const two = calculate(input({ transactions: mixedTransactions() }));
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });
});
