import { describe, expect, it } from "vitest";

import { kr } from "@/lib/engine";
import {
  DAGAR_PER_AR,
  FORFALLODAGAR,
  RANTELAGEN_TILLAGG,
  drojsmalsranta,
  rantaFor,
  type Referensranta,
} from "@/lib/rantelagen";

/**
 * Dröjsmålsränta enligt avtalets 12.3 och 6 § räntelagen.
 *
 * Det svåra är inte formeln utan perioden: referensräntan ändras två gånger om
 * året, och en fordran som ligger obetald hinner passera flera ändringar. Att
 * räkna hela tiden med dagens sats ger fel belopp så fort fordran är äldre än
 * ett halvår - vilket är precis när räntan börjar spela roll.
 */
const RANTOR: Referensranta[] = [
  { fromDate: "2026-01-01", percent: 2 },
  { fromDate: "2027-07-01", percent: 4 },
];

describe("Vilken referensränta som gällde", () => {
  it("tar den senaste som börjat gälla", () => {
    expect(rantaFor("2026-06-30", RANTOR)?.percent).toBe(2);
    expect(rantaFor("2027-07-01", RANTOR)?.percent).toBe(4);
    expect(rantaFor("2030-01-01", RANTOR)?.percent).toBe(4);
  });

  it("saknas den helt är svaret ingenting, inte noll", () => {
    // Noll procent är ett riktigt svar som betyder något annat än "vet inte".
    expect(rantaFor("2025-12-31", RANTOR)).toBeNull();
  });
});

describe("Förfallodagen", () => {
  it("ligger trettio dagar efter det skriftliga kravet", () => {
    const svar = drojsmalsranta({
      belopp: kr(100_000),
      kravdag: "2026-06-01",
      tillDag: "2026-06-01",
      referensrantor: RANTOR,
    });
    expect(svar.ok).toBe(true);
    if (!svar.ok) return;
    expect(svar.forfallodag).toBe("2026-07-01");
    expect(FORFALLODAGAR).toBe(30);
  });

  it("ingen ränta löper fram till och med förfallodagen", () => {
    for (const dag of ["2026-06-15", "2026-07-01"]) {
      const svar = drojsmalsranta({
        belopp: kr(100_000),
        kravdag: "2026-06-01",
        tillDag: dag,
        referensrantor: RANTOR,
      });
      if (!svar.ok) throw new Error(svar.skal);
      expect(svar.ranta, `${dag} ska vara räntefri`).toBe(0);
      expect(svar.dagar).toBe(0);
    }
  });
});

describe("Räntan", () => {
  it("räknar ett helt år med referensränta plus åtta procentenheter", () => {
    // 100 000 kr, referens 2 % ger 10 %. Ett år ger 10 000 kr.
    const svar = drojsmalsranta({
      belopp: kr(100_000),
      kravdag: "2026-06-01",
      tillDag: "2027-07-01",
      referensrantor: RANTOR,
    });
    if (!svar.ok) throw new Error(svar.skal);
    expect(svar.dagar).toBe(365);
    expect(svar.ranta).toBe(kr(10_000));
    expect(svar.perioder).toHaveLength(1);
    expect(svar.perioder[0].rantesats).toBe(2 + RANTELAGEN_TILLAGG);
  });

  it("delar perioden när referensräntan ändras", () => {
    // 365 dagar med 10 % = 10 000 kr, sedan 184 dagar med 12 % = 6 049,32 kr.
    const svar = drojsmalsranta({
      belopp: kr(100_000),
      kravdag: "2026-06-01",
      tillDag: "2028-01-01",
      referensrantor: RANTOR,
    });
    if (!svar.ok) throw new Error(svar.skal);

    expect(svar.perioder.map((p) => [p.from, p.dagar, p.rantesats])).toEqual([
      ["2026-07-01", 365, 10],
      ["2027-07-01", 184, 12],
    ]);
    expect(svar.ranta).toBe(1_604_932);
  });

  it("räknar en enda dags dröjsmål", () => {
    const svar = drojsmalsranta({
      belopp: kr(100_000),
      kravdag: "2026-06-01",
      tillDag: "2026-07-02",
      referensrantor: RANTOR,
    });
    if (!svar.ok) throw new Error(svar.skal);
    expect(svar.dagar).toBe(1);
    // 10 000 000 öre * 10 % * 1/365 = 2 739,7 öre
    expect(svar.ranta).toBe(2_740);
  });

  it("dagräkningen står med i beskedet", () => {
    const svar = drojsmalsranta({
      belopp: kr(100_000),
      kravdag: "2026-06-01",
      tillDag: "2027-07-01",
      referensrantor: RANTOR,
    });
    if (!svar.ok) throw new Error(svar.skal);
    // Konventionen följer inte av lagtexten och ska därför synas, inte gömmas.
    expect(svar.dagrakning).toContain(String(DAGAR_PER_AR));
    expect(svar.dagrakning).toContain("6 § räntelagen");
  });
});

describe("När räntan inte går att räkna", () => {
  it("vägrar när referensräntan för perioden saknas", () => {
    const svar = drojsmalsranta({
      belopp: kr(100_000),
      kravdag: "2025-01-01",
      tillDag: "2025-12-01",
      referensrantor: RANTOR,
    });
    expect(svar.ok).toBe(false);
    if (svar.ok) return;
    expect(svar.skal).toMatch(/Referensräntan/);
  });

  it("vägrar när dagen ligger före kravet", () => {
    const svar = drojsmalsranta({
      belopp: kr(100_000),
      kravdag: "2026-06-01",
      tillDag: "2026-05-01",
      referensrantor: RANTOR,
    });
    expect(svar.ok).toBe(false);
  });

  it("vägrar på en fordran som inte är större än noll", () => {
    expect(
      drojsmalsranta({
        belopp: 0,
        kravdag: "2026-06-01",
        tillDag: "2027-06-01",
        referensrantor: RANTOR,
      }).ok,
    ).toBe(false);
  });
});
