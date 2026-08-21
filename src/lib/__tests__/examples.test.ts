import { describe, expect, it } from "vitest";

import { normalizeSpaces as normalize } from "@/lib/__tests__/normalize";
import { EXAMPLES } from "@/lib/examples";

/**
 * Exemplen ska stämma med avtalets bilaga 1. Går de isär har antingen en regel
 * ändrats eller exemplet blivit fel – båda är fel som ska fångas här.
 */
const value = (example: { steps: { label: string; value: string }[] }, label: string) =>
  normalize(example.steps.find((step) => step.label === label)?.value ?? "");

describe("Pedagogiska exempel", () => {
  it("tvättmaskinen ger 8 000 kr och 8 000 enheter", () => {
    const example = EXAMPLES.washingMachine();
    expect(value(example, "Överbetalning")).toContain("8");
    expect(value(example, "Din del enligt nyckeln")).toContain("2 000");
    expect(value(example, "Enheter du fick")).toBe("8 000 enheter");
    expect(normalize(example.outcome)).toContain("8 000 enheter");
  });

  it("räntan räknas efter skattereduktionen", () => {
    const example = EXAMPLES.interest();
    expect(value(example, "Kostnad efter skatt")).toContain("7 000");
    expect(value(example, "Din del enligt nyckeln")).toContain("1 400");
    expect(value(example, "Överbetalning")).toContain("5 600");
  });

  it("värdeförändringen visar både uppgång och nedgång", () => {
    const example = EXAMPLES.valueChange();
    expect(value(example, "Om värdet stiger till 4 840 000 kr")).toContain("10 000");
    expect(value(example, "Om värdet är oförändrat")).toContain("8 000");
    expect(value(example, "Om värdet sjunker till 4 150 000 kr")).toContain("6 000");
  });

  it("otillräckliga enheter ger en personlig fordran", () => {
    const example = EXAMPLES.personalClaim();
    expect(value(example, "Överbetalning")).toContain("1 000 000");
    expect(value(example, "Omvandlat till enheter")).toContain("180 000");
    expect(value(example, "Kvar som personlig fordran")).toContain("820 000");
  });

  it("det linjära mellanvärdet räknas per kalenderdag", () => {
    const example = EXAMPLES.linearValue();
    // Bilagan avrundar till 4 900 000 kr på hela år; dagräkning med skottår
    // ger 4 900 329 kr, vilket är det avtalets punkt 8.2 föreskriver.
    expect(value(example, "Beräknat värde efter två år")).toContain("4 900 329");
    expect(value(example, "Nettokapital")).toContain("1 900 329");
  });

  it("alla exempel går att räkna fram", () => {
    for (const [key, build] of Object.entries(EXAMPLES)) {
      const example = build();
      expect(example.outcome, key).toBeTruthy();
      expect(example.steps.length, key).toBeGreaterThan(2);
      for (const step of example.steps) {
        expect(step.value, `${key}: ${step.label}`).not.toBe("");
        expect(step.value, `${key}: ${step.label}`).not.toContain("NaN");
      }
    }
  });
});
