import { beforeEach, describe, expect, it } from "vitest";

import { LAGRINGSNYCKEL, lasSparatVal, sparaVal, valjAktivt } from "@/lib/aktivt-hushall";

/**
 * Vilket hushåll som är aktivt.
 *
 * Reglerna är fler än de ser ut. Valet ska överleva en omladdning, men ett
 * hushåll som tagits bort eller som användaren inte längre når får aldrig
 * ligga kvar som aktivt: då visas ett tomt läge som ser ut som ett fel i
 * tjänsten, och frågorna hämtar för ett id som inte finns.
 */
const ETT = { id: "h1", name: "Nora & Idris" };
const TVA = { id: "h2", name: "Syskonens hus" };
const TRE = { id: "h3", name: "Föräldrahemmet" };

describe("Ett enda hushåll", () => {
  it("blir aktivt utan att någon behöver välja", () => {
    const val = valjAktivt([ETT], null);
    expect(val.aktivt).toBe(ETT);
    expect(val.rensaSparat).toBe(false);
  });

  it("visar ingen väljare", () => {
    // Ett val mellan en sak är inget val, bara brus.
    expect(valjAktivt([ETT], null).visaValjare).toBe(false);
  });
});

describe("Flera hushåll", () => {
  it("visar väljaren", () => {
    expect(valjAktivt([ETT, TVA], null).visaValjare).toBe(true);
  });

  it("utan sparat val faller tillbaka på det första", () => {
    expect(valjAktivt([ETT, TVA, TRE], null).aktivt).toBe(ETT);
  });

  it("respekterar ett sparat val", () => {
    expect(valjAktivt([ETT, TVA, TRE], "h3").aktivt).toBe(TRE);
  });

  it("rensar inte ett giltigt sparat val", () => {
    expect(valjAktivt([ETT, TVA], "h2").rensaSparat).toBe(false);
  });
});

describe("Ett borttaget eller otillgängligt hushåll ligger inte kvar", () => {
  it("faller tillbaka på det första och begär att det sparade rensas", () => {
    const val = valjAktivt([ETT, TVA], "h9");
    expect(val.aktivt).toBe(ETT);
    expect(val.rensaSparat).toBe(true);
  });

  it("gäller även när hushållet försvunnit mellan två laddningar", () => {
    // Användaren stod i h3 och blev borttagen därifrån.
    const val = valjAktivt([ETT, TVA], "h3");
    expect(val.aktivt).toBe(ETT);
    expect(val.rensaSparat).toBe(true);
  });

  it("utan några hushåll alls blir svaret ingenting, inte ett gammalt id", () => {
    const val = valjAktivt([], "h1");
    expect(val.aktivt).toBeNull();
    expect(val.rensaSparat).toBe(true);
    expect(val.visaValjare).toBe(false);
  });

  it("inga hushåll och inget sparat val kräver ingen rensning", () => {
    expect(valjAktivt([], null)).toEqual({
      aktivt: null,
      rensaSparat: false,
      visaValjare: false,
    });
  });
});

describe("Valet överlever en omladdning", () => {
  /**
   * Proven kör i nodmiljö, som saknar localStorage. En liten stubbe räcker -
   * poängen är reglerna kring lagringen, inte webbläsarens implementation.
   */
  function stubbaLagring() {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (n: string) => data.get(n) ?? null,
        setItem: (n: string, v: string) => void data.set(n, v),
        removeItem: (n: string) => void data.delete(n),
        clear: () => data.clear(),
      },
    });
  }

  beforeEach(() => {
    stubbaLagring();
  });

  it("sparas och läses tillbaka", () => {
    sparaVal("h2");
    expect(lasSparatVal()).toBe("h2");
    // Och en ny "laddning" väljer rätt hushåll.
    expect(valjAktivt([ETT, TVA], lasSparatVal()).aktivt).toBe(TVA);
  });

  it("går att rensa", () => {
    sparaVal("h2");
    sparaVal(null);
    expect(lasSparatVal()).toBeNull();
  });

  it("tål att lagringen inte går att nå", () => {
    // Privat läge eller blockerade kakor. Valet ska försvinna vid omladdning,
    // inte fälla hela appen.
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blockerad");
      },
    });

    expect(() => lasSparatVal()).not.toThrow();
    expect(lasSparatVal()).toBeNull();
    expect(() => sparaVal("h1")).not.toThrow();
  });

  it("tål att lagringen saknas helt", () => {
    // Serversidan har ingen localStorage alls.
    Reflect.deleteProperty(globalThis, "localStorage");
    expect(lasSparatVal()).toBeNull();
    expect(() => sparaVal("h1")).not.toThrow();
  });

  it("använder en egen nyckel så inget annat skrivs över", () => {
    expect(LAGRINGSNYCKEL).toMatch(/^mittochditt\./);
  });
});
