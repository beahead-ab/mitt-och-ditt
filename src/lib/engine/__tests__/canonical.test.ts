import { describe, expect, it } from "vitest";

import { canonicalStringify, sameResult } from "../canonical";

describe("Kanonisk serialisering", () => {
  it("ger samma text oavsett nyckelordning", () => {
    const a = { slutvärde: 100, startvärde: 50, parter: { felicia: 2, caesar: 1 } };
    const b = { parter: { caesar: 1, felicia: 2 }, startvärde: 50, slutvärde: 100 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("bevarar ordningen i listor", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalStringify([1, 2, 3])).not.toBe(canonicalStringify([3, 2, 1]));
  });

  it("behandlar utelämnat och odefinierat lika", () => {
    expect(canonicalStringify({ a: 1 })).toBe(canonicalStringify({ a: 1, b: undefined }));
  });

  it("skiljer på null och utelämnat värde", () => {
    expect(canonicalStringify({ a: 1, b: null })).not.toBe(canonicalStringify({ a: 1 }));
  });

  it("ger samma text för noll och minus noll", () => {
    expect(canonicalStringify({ saldo: -0 })).toBe(canonicalStringify({ saldo: 0 }));
  });

  it("citerar strängar korrekt", () => {
    expect(canonicalStringify({ text: 'med "citat"' })).toBe('{"text":"med \\"citat\\""}');
    expect(canonicalStringify({ text: "å ä ö" })).toContain("å ä ö");
  });

  it("avvisar tal som inte är ändliga", () => {
    expect(() => canonicalStringify({ x: Number.NaN })).toThrow(/ändligt/);
    expect(() => canonicalStringify({ x: Number.POSITIVE_INFINITY })).toThrow(/ändligt/);
  });

  it("hanterar djupt nästlade strukturer", () => {
    const deep = { a: [{ z: 1, y: [{ q: 2, p: 3 }] }] };
    const same = { a: [{ y: [{ p: 3, q: 2 }], z: 1 }] };
    expect(canonicalStringify(deep)).toBe(canonicalStringify(same));
  });
});

describe("Jämförelse av resultat", () => {
  it("ser två likvärdiga resultat som lika", () => {
    expect(sameResult({ enheter: { a: 1, b: 2 } }, { enheter: { b: 2, a: 1 } })).toBe(true);
  });

  it("upptäcker minsta skillnad i belopp", () => {
    expect(sameResult({ belopp: 100_000 }, { belopp: 100_001 })).toBe(false);
  });

  it("upptäcker en tillkommen post", () => {
    expect(sameResult({ poster: ["T-1"] }, { poster: ["T-1", "T-2"] })).toBe(false);
  });
});
