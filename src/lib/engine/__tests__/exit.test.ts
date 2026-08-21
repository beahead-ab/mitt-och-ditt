import { describe, expect, it } from "vitest";

import { determineValuation, exitDeadlines } from "../exit";
import { kr, toKronor } from "../money";

describe("Separationsprocessens frister", () => {
  it("ger både 14-dagarsbeskedet och tremånadersfristen", () => {
    const deadlines = exitDeadlines("2027-03-01");
    expect(deadlines.takeoverNoticeBy).toBe("2027-03-15");
    expect(deadlines.saleOrBuyoutBy).toBe("2027-06-01");
  });

  it("klipper tremånadersfristen till månadens sista dag", () => {
    expect(exitDeadlines("2026-11-30").saleOrBuyoutBy).toBe("2027-02-28");
  });
});

describe("Fastställande av slutvärde utan extern försäljning", () => {
  it("använder genomsnittet när skillnaden är högst 10 procent", () => {
    const outcome = determineValuation([kr(5_000_000), kr(5_400_000)]);
    expect(outcome.method).toBe("genomsnitt");
    expect(toKronor(outcome.value ?? 0)).toBe(5_200_000);
    expect(outcome.spread).toBeCloseTo(0.0769, 4);
  });

  it("kräver en tredje värdering när skillnaden är större", () => {
    const outcome = determineValuation([kr(5_000_000), kr(6_000_000)]);
    expect(outcome.method).toBe("tredje-vardering-kravs");
    expect(outcome.value).toBeNull();
    expect(outcome.spread).toBeCloseTo(0.1818, 4);
  });

  it("hanterar gränsfallet exakt 10 procent som genomsnitt", () => {
    // 4 750 000 och 5 250 000: skillnad 500 000 av genomsnittet 5 000 000.
    const outcome = determineValuation([kr(4_750_000), kr(5_250_000)]);
    expect(outcome.spread).toBeCloseTo(0.1, 10);
    expect(outcome.method).toBe("genomsnitt");
    expect(toKronor(outcome.value ?? 0)).toBe(5_000_000);
  });

  it("använder det mittersta av tre värderingar", () => {
    const outcome = determineValuation([kr(5_000_000), kr(6_000_000), kr(5_300_000)]);
    expect(outcome.method).toBe("median");
    expect(toKronor(outcome.value ?? 0)).toBe(5_300_000);
  });

  it("kräver minst två värderingar", () => {
    expect(() => determineValuation([kr(5_000_000)])).toThrow(/två/);
  });
});
