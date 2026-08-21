import { describe, expect, it } from "vitest";

import { calculate, linearValue } from "../engine";
import { addDays } from "../dates";
import { kr, toKronor } from "../money";
import { AGREEMENT, CAESAR, FELICIA, START_DATE, flatEndpoint, input, tx } from "./fixtures";

/**
 * Avtalets bilaga 1, exempel 1–10. Exemplen är pedagogiska men bygger på
 * avtalets bindande regler, så de fungerar som facit för motorn.
 */
describe("Bilaga 1 – räkneexempel", () => {
  it("Exempel 1: startenheterna ger 86,9565 % och 13,0435 %", () => {
    const result = calculate(input());
    expect(result.finalShares[CAESAR]).toBeCloseTo(0.8695652, 7);
    expect(result.finalShares[FELICIA]).toBeCloseTo(0.1304348, 7);
    expect(result.finalUnits[CAESAR] + result.finalUnits[FELICIA]).toBe(AGREEMENT.totalUnits);
  });

  it("Exempel 2: Felicia betalar tvättmaskinen och får 8 000 enheter", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            description: "Tvättmaskin som lämnas kvar",
            payments: { [FELICIA]: { gross: kr(10_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
        ],
      }),
    );

    const event = result.events[0];
    expect(event.unitValue).toBe(100); // 1,00 kr per enhet
    expect(toKronor(event.overpayment)).toBe(8_000);
    expect(event.overpayer).toBe(FELICIA);
    expect(event.transferredUnits).toBeCloseTo(8_000, 6);
    expect(result.finalUnits[FELICIA]).toBeCloseTo(188_000, 6);
    expect(result.finalUnits[CAESAR]).toBeCloseTo(1_192_000, 6);
    expect(result.claims[FELICIA]).toBe(0);
  });

  it("Exempel 3: räntan räknas efter faktisk skatteeffekt", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            category: "Ränta",
            payments: { [FELICIA]: { gross: kr(10_000), taxEffect: kr(3_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
        ],
      }),
    );

    const event = result.events[0];
    expect(toKronor(event.netCostTotal)).toBe(7_000);
    expect(toKronor(event.owed[FELICIA])).toBe(1_400);
    expect(toKronor(event.overpayment)).toBe(5_600);
    expect(event.transferredUnits).toBeCloseTo(5_600, 6);
  });

  it("Exempel 4: en tidig överbetalning växer när värdet stiger", () => {
    // Slutvärde valt så att den slutliga enheten är värd 1,25 kr.
    const endpoint = flatEndpoint({ endValue: kr(4_840_000) });
    const washingMachine = tx({
      id: "T1",
      payments: { [FELICIA]: { gross: kr(10_000) } },
      specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
    });

    const withTx = calculate(input({ endpoint, transactions: [washingMachine] }));
    const without = calculate(input({ endpoint }));

    expect(withTx.events[0].transferredUnits).toBeCloseTo(8_000, 6);
    const gain =
      toKronor(withTx.settlement.byShare[FELICIA]) - toKronor(without.settlement.byShare[FELICIA]);
    expect(gain).toBeCloseTo(10_000, 2); // 8 000 enheter × 1,25 kr
  });

  it("Exempel 5: samma överbetalning krymper när värdet sjunker", () => {
    // Slutvärde valt så att den slutliga enheten är värd 0,75 kr.
    const endpoint = flatEndpoint({ endValue: kr(4_150_000) });
    const washingMachine = tx({
      id: "T1",
      payments: { [FELICIA]: { gross: kr(10_000) } },
      specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
    });

    const withTx = calculate(input({ endpoint, transactions: [washingMachine] }));
    const without = calculate(input({ endpoint }));

    const gain =
      toKronor(withTx.settlement.byShare[FELICIA]) - toKronor(without.settlement.byShare[FELICIA]);
    expect(gain).toBeCloseTo(6_000, 2); // 8 000 enheter × 0,75 kr
  });

  it("Exempel 6: en sen överbetalning ger färre enheter", () => {
    // Halva vägen till slutdagen är värdet 4 771 000 kr, alltså 1,20 kr per enhet.
    const endpoint = flatEndpoint({ endValue: kr(5_047_000), endLoan: kr(3_322_000) });
    const midpoint = addDays(START_DATE, 913);

    const withTx = calculate(
      input({
        endpoint,
        transactions: [
          tx({
            id: "T1",
            paymentDate: midpoint,
            payments: { [FELICIA]: { gross: kr(10_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
        ],
      }),
    );
    const without = calculate(input({ endpoint }));

    const event = withTx.events[0];
    expect(toKronor(event.linearValue)).toBe(4_771_000);
    expect(event.unitValue).toBe(120); // 1,20 kr per enhet
    expect(event.transferredUnits).toBeCloseTo(6_666.67, 2);

    // Slutlig enhet värd 1,25 kr: 6 666,67 × 1,25 ≈ 8 333 kr.
    const gain =
      toKronor(withTx.settlement.byShare[FELICIA]) - toKronor(without.settlement.byShare[FELICIA]);
    expect(gain).toBeCloseTo(8_333.33, 1);
  });

  it("Exempel 7: samma regel gäller när Caesar överbetalar", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            payments: { [CAESAR]: { gross: kr(10_000) } },
            specialKey: { [CAESAR]: 0.2, [FELICIA]: 0.8 },
          }),
        ],
      }),
    );

    const event = result.events[0];
    expect(event.overpayer).toBe(CAESAR);
    expect(toKronor(event.overpayment)).toBe(8_000);
    expect(event.transferredUnits).toBeCloseTo(8_000, 6);
    expect(result.finalUnits[CAESAR]).toBeCloseTo(1_208_000, 6);
    expect(result.finalUnits[FELICIA]).toBeCloseTo(172_000, 6);
  });

  it("Exempel 8: linjärt mellanvärde räknas per kalenderdag", () => {
    // Bilagans 4 900 000 kr är avrundat och räknat på hela år. Avtalets punkt
    // 8.2 föreskriver dagräkning, och mellan 2026-08-17 och 2031-08-17 ligger
    // ett skottår, så det exakta dagbaserade värdet blir 4 900 328,59 kr.
    const value = linearValue(
      "2026-08-17",
      kr(4_500_000),
      "2031-08-17",
      kr(5_500_000),
      "2028-08-17",
    );
    expect(toKronor(value)).toBeCloseTo(4_900_328.59, 2);
    expect(toKronor(value)).toBeGreaterThan(4_900_000);
    expect(toKronor(value)).toBeLessThan(4_901_000);
  });

  it("Exempel 9: byter man antagandet räknas alla poster om", () => {
    const washingMachine = tx({
      id: "T1",
      paymentDate: addDays(START_DATE, 365),
      payments: { [FELICIA]: { gross: kr(10_000) } },
      specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
    });

    const optimistic = calculate(
      input({
        endpoint: flatEndpoint({ endValue: kr(5_500_000) }),
        transactions: [washingMachine],
      }),
    );
    const pessimistic = calculate(
      input({
        endpoint: flatEndpoint({ endValue: kr(3_800_000) }),
        transactions: [washingMachine],
      }),
    );

    // Enhetsvärdet på betalningsdagen beror på antagandet, så även den
    // historiska enhetsöverföringen ändras (avtal 6.4).
    expect(optimistic.events[0].transferredUnits).not.toBeCloseTo(
      pessimistic.events[0].transferredUnits,
      2,
    );
    expect(optimistic.events[0].transferredUnits).toBeLessThan(
      pessimistic.events[0].transferredUnits,
    );
  });

  it("Exempel 10a: inget nettokapital ger ingen enhetsöverföring", () => {
    const result = calculate(
      input({
        agreement: { ...AGREEMENT, initialLoan: kr(4_600_000) },
        endpoint: flatEndpoint({ endLoan: kr(4_600_000) }),
        transactions: [
          tx({
            id: "T1",
            payments: { [FELICIA]: { gross: kr(10_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
        ],
      }),
    );

    const event = result.events[0];
    expect(event.unitValue).toBeNull();
    expect(event.transferredUnits).toBe(0);
    expect(toKronor(event.personalClaim?.amount ?? 0)).toBe(8_000);
    expect(toKronor(result.claims[FELICIA])).toBe(8_000);
    expect(result.finalUnits[FELICIA]).toBe(180_000);
  });

  it("Exempel 10b: för få enheter ger delvis fordran", () => {
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
    expect(toKronor(event.overpayment)).toBe(1_000_000);
    expect(event.requestedUnits).toBeCloseTo(1_000_000, 6);
    expect(event.transferredUnits).toBe(180_000); // allt Felicia hade
    expect(toKronor(event.convertedAmount)).toBe(180_000);
    expect(toKronor(result.claims[CAESAR])).toBe(820_000);
    expect(result.finalUnits[FELICIA]).toBe(0);
    expect(result.finalUnits[CAESAR]).toBe(1_380_000);
  });
});
