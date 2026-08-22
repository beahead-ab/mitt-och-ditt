import { describe, expect, it } from "vitest";

import { skrivBelopp, tolkaBelopp } from "@/lib/belopp";

/**
 * Beloppsfältens tolkning.
 *
 * Det viktiga provet är det första: ett tomt fält är inte noll. Med
 * `Number("")` blev det 0, och en prognos föll tyst till noll så fort någon
 * rensade ett fält för att skriva om det.
 */
describe("Att läsa ett belopp", () => {
  it("tomt fält är inget angivet, inte noll", () => {
    expect(tolkaBelopp("")).toBeNull();
    expect(tolkaBelopp("   ")).toBeNull();
  });

  it("läser tusenavgränsare, både vanligt och hårt blanksteg", () => {
    // Kopierar man ett belopp ur tjänsten får man Intl:s hårda blanksteg med
    // sig, inte ett vanligt mellanslag. Ett fält som avvisar sitt eget utdata
    // är svårt att förstå för den som klistrar in.
    expect(tolkaBelopp("4 495 000")).toBe(4_495_000);
    expect(tolkaBelopp("4\u00a0495\u00a0000")).toBe(4_495_000);
    expect(tolkaBelopp("4\u202f495\u202f000")).toBe(4_495_000);
  });

  it("läser svensk decimalkomma", () => {
    expect(tolkaBelopp("1 234,50")).toBe(1234.5);
    expect(tolkaBelopp("1234.50")).toBe(1234.5);
  });

  it("skräp är inget angivet, inte noll", () => {
    expect(tolkaBelopp("abc")).toBeNull();
    expect(tolkaBelopp("12kr")).toBeNull();
  });

  it("noll är noll och skiljer sig från tomt", () => {
    expect(tolkaBelopp("0")).toBe(0);
  });
});

describe("Att skriva ett belopp", () => {
  it("sätter tusenavgränsare", () => {
    expect(skrivBelopp(4_495_000).replace(/[\u00a0\u202f]/g, " ")).toBe("4 495 000");
  });

  it("inget angivet blir tomt fält", () => {
    expect(skrivBelopp(null)).toBe("");
  });

  it("överlever fram och tillbaka", () => {
    for (const tal of [0, 1, 1234.5, 4_495_000]) {
      expect(tolkaBelopp(skrivBelopp(tal))).toBe(tal);
    }
  });
});
