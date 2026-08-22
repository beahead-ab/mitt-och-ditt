import { describe, expect, it } from "vitest";

import { FINANSIERING_MANADER, MEDDELANDE_DAGAR, dodsfallsfrister } from "@/lib/dodsfall";

/**
 * Fristerna vid dödsfall (avtal 22).
 *
 * Proven håller fast vid tre saker som är lätta att få fel: att klockan inte
 * startar förrän underlaget finns, att en uppfylld frist inte kan förfalla i
 * efterhand, och att fyra månader räknas i kalendermånader och inte i
 * hundratjugo dagar.
 */
const TOM = {
  bouppteckningPa: null,
  meddelatPa: null,
  vardeFastställtPa: null,
  finansieringOrdnadPa: null,
};

describe("Klockan startar när underlaget finns", () => {
  it("utan bouppteckningsförrättning löper ingen frist", () => {
    const { frister, narmast } = dodsfallsfrister({ ...TOM, idag: "2026-09-01" });
    expect(frister.every((f) => f.lage === "vantar_pa_underlag")).toBe(true);
    // Ingenting är angeläget: det finns inget att göra åt en frist som inte
    // börjat löpa.
    expect(narmast).toBeNull();
  });

  it("bouppteckningsförrättningen startar meddelandefristen", () => {
    const { frister } = dodsfallsfrister({
      ...TOM,
      bouppteckningPa: "2026-09-01",
      idag: "2026-09-02",
    });
    const meddelande = frister.find((f) => f.nyckel === "meddelande")!;
    expect(meddelande.forfaller).toBe("2026-10-01");
    expect(meddelande.dagarKvar).toBe(29);
    expect(MEDDELANDE_DAGAR).toBe(30);
  });

  it("finansieringsfristen väntar på sitt eget underlag, inte på den första", () => {
    // Den efterlevande har meddelat, men värdet är inte fastställt än. Då kan
    // fyramånadersfristen inte ha börjat löpa.
    const { frister } = dodsfallsfrister({
      ...TOM,
      bouppteckningPa: "2026-09-01",
      meddelatPa: "2026-09-10",
      idag: "2026-11-01",
    });
    expect(frister.find((f) => f.nyckel === "finansiering")!.lage).toBe("vantar_pa_underlag");
  });
});

describe("Fyra månader är kalendermånader", () => {
  it("räknas till samma dag i månaden, inte hundratjugo dagar", () => {
    const { frister } = dodsfallsfrister({
      ...TOM,
      vardeFastställtPa: "2026-10-31",
      idag: "2026-11-01",
    });
    const finansiering = frister.find((f) => f.nyckel === "finansiering")!;
    // 31 februari finns inte; fristen klipps till månadens sista dag.
    expect(finansiering.forfaller).toBe("2027-02-28");
    expect(FINANSIERING_MANADER).toBe(4);
  });
});

describe("Lägena", () => {
  const bas = { ...TOM, bouppteckningPa: "2026-09-01" };

  it("löper när det är gott om tid", () => {
    const { frister } = dodsfallsfrister({ ...bas, idag: "2026-09-02" });
    expect(frister[0].lage).toBe("loper");
  });

  it("blir snart när det är två veckor kvar", () => {
    const { frister } = dodsfallsfrister({ ...bas, idag: "2026-09-20" });
    expect(frister[0].lage).toBe("snart");
    expect(frister[0].dagarKvar).toBe(11);
  });

  it("förfaller dagen efter", () => {
    const { frister } = dodsfallsfrister({ ...bas, idag: "2026-10-02" });
    expect(frister[0].lage).toBe("forfallen");
    expect(frister[0].dagarKvar).toBe(-1);
  });

  it("en uppfylld frist kan inte förfalla i efterhand", () => {
    // Det som skulle göras är gjort. Att fristen sedan passerat spelar ingen
    // roll, och tjänsten ska inte påstå något annat.
    const { frister, narmast } = dodsfallsfrister({
      ...bas,
      meddelatPa: "2026-09-15",
      idag: "2027-01-01",
    });
    expect(frister[0].lage).toBe("uppfylld");
    expect(narmast).toBeNull();
  });
});

describe("Vad som är mest angeläget", () => {
  it("en förfallen frist går före en som bara är snart", () => {
    const { narmast } = dodsfallsfrister({
      ...TOM,
      bouppteckningPa: "2026-09-01",
      vardeFastställtPa: "2026-10-20",
      idag: "2027-02-15",
    });
    expect(narmast?.nyckel).toBe("meddelande");
    expect(narmast?.lage).toBe("forfallen");
  });

  it("är meddelandet gjort tar finansieringen över", () => {
    const { narmast } = dodsfallsfrister({
      ...TOM,
      bouppteckningPa: "2026-09-01",
      meddelatPa: "2026-09-15",
      vardeFastställtPa: "2026-10-20",
      idag: "2027-02-15",
    });
    expect(narmast?.nyckel).toBe("finansiering");
  });
});
