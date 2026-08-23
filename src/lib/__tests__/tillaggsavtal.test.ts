import { describe, expect, it } from "vitest";

import { calculate, kr, toKronor, type AgreementParams, type Transaction } from "@/lib/engine";
import {
  andradeFalt,
  granskaTillagg,
  nyaAvtalsvarden,
  type Avtalsvarden,
} from "@/lib/tillaggsavtal";

/**
 * Tilläggsavtalets verkan på avtalets värden.
 *
 * Provet som betyder mest är det sista: att historiska transaktioner ger samma
 * resultat före och efter tillägget. Tidigare satte tillägget avtalets
 * startdag till sin egen giltighetsdag, och eftersom motorn utesluter poster
 * som betalats före startdagen försvann hela historiken ur beräkningen - utan
 * att något sa till.
 */
const GALLANDE: Avtalsvarden = {
  startDate: "2026-01-15",
  startValueOre: "450000000",
  initialLoanOre: "300000000",
  totalUnits: "1500000",
  startUnits: { caesar: 900000, felicia: 600000 },
  formalOwnership: { caesar: 0.5, felicia: 0.5 },
};

describe("Startdagen överlever ett tillägg", () => {
  it("är oförändrad när tillägget inte säger något om den", () => {
    const nya = nyaAvtalsvarden(GALLANDE, { startValueOre: "500000000" });
    expect(nya.startDate).toBe("2026-01-15");
  });

  it("ändras bara när tillägget uttryckligen anger en ny", () => {
    const nya = nyaAvtalsvarden(GALLANDE, { startDate: "2026-03-01" });
    expect(nya.startDate).toBe("2026-03-01");
    expect(andradeFalt(GALLANDE, nya)).toEqual(["startDate"]);
  });

  it("påverkas inte av tilläggets giltighetsdag", () => {
    // Giltighetsdagen är en uppgift om tillägget, inte om bostadsköpet. Den
    // hör hemma på tillägget och ska aldrig nå avtalets startdag.
    const nya = nyaAvtalsvarden(GALLANDE, { initialLoanOre: "250000000" });
    expect(nya.startDate).toBe(GALLANDE.startDate);
  });
});

describe("Bara det tillägget anger får ändras", () => {
  it("lämnar allt annat orört", () => {
    const nya = nyaAvtalsvarden(GALLANDE, { startValueOre: "500000000" });
    expect(andradeFalt(GALLANDE, nya)).toEqual(["startValueOre"]);
    expect(nya.initialLoanOre).toBe(GALLANDE.initialLoanOre);
    expect(nya.totalUnits).toBe(GALLANDE.totalUnits);
    expect(nya.startUnits).toEqual(GALLANDE.startUnits);
    expect(nya.formalOwnership).toEqual(GALLANDE.formalOwnership);
  });

  it("ett tillägg utan värden ändrar ingenting alls", () => {
    expect(andradeFalt(GALLANDE, nyaAvtalsvarden(GALLANDE, {}))).toEqual([]);
  });

  it("samma värde igen räknas inte som en ändring", () => {
    // Ett tillägg som "ändrar" startvärdet till samma belopp ändrar
    // ingenting, och ska inte kunna påstå något annat.
    const nya = nyaAvtalsvarden(GALLANDE, { startValueOre: "450000000" });
    expect(andradeFalt(GALLANDE, nya)).toEqual([]);
  });

  it("ser skillnad i andelsenheter per part", () => {
    const nya = nyaAvtalsvarden(GALLANDE, {
      startUnits: { caesar: 950000, felicia: 550000 },
    });
    expect(andradeFalt(GALLANDE, nya)).toEqual(["startUnits"]);
  });

  it("bryr sig inte om nyckelordning i objekten", () => {
    const nya = nyaAvtalsvarden(GALLANDE, {
      startUnits: { felicia: 600000, caesar: 900000 },
    });
    expect(andradeFalt(GALLANDE, nya)).toEqual([]);
  });
});

describe("Sammanfattningen får inte säga en sak och värdena en annan", () => {
  it("avvisar ett tillägg som påstår en ändring utan att göra den", () => {
    const svar = granskaTillagg(GALLANDE, {}, ["startValueOre"]);
    expect(svar.ok).toBe(false);
    if (svar.ok) return;
    expect(svar.skal).toMatch(/detsamma som i gällande avtal/);
  });

  it("avvisar ett tillägg som ändrar mer än det säger", () => {
    const svar = granskaTillagg(
      GALLANDE,
      { startValueOre: "500000000", initialLoanOre: "250000000" },
      ["startValueOre"],
    );
    expect(svar.ok).toBe(false);
    if (svar.ok) return;
    expect(svar.skal).toMatch(/utan att säga det/);
  });

  it("släpper igenom när uppgiven och faktisk ändring stämmer", () => {
    const svar = granskaTillagg(GALLANDE, { startValueOre: "500000000" }, ["startValueOre"]);
    expect(svar.ok).toBe(true);
    if (!svar.ok) return;
    expect(svar.andrade).toEqual(["startValueOre"]);
  });
});

describe("Historiken räknas likadant efter ett tillägg", () => {
  /** Samma avtal som Avtalsvarden ovan, i motorns form. */
  function avtal(varden: Avtalsvarden): AgreementParams {
    return {
      startDate: varden.startDate,
      startValue: Number(varden.startValueOre),
      initialLoan: Number(varden.initialLoanOre),
      parties: ["caesar", "felicia"],
      startUnits: varden.startUnits,
      totalUnits: Number(varden.totalUnits),
      formalOwnership: varden.formalOwnership ?? undefined,
    };
  }

  const HISTORIK: Transaction[] = [
    {
      id: "T1",
      paymentDate: "2026-02-01",
      category: "Reparation",
      payments: { caesar: { gross: kr(40_000) } },
      status: "approved",
    },
    {
      id: "T2",
      paymentDate: "2026-04-01",
      category: "Reparation",
      payments: { felicia: { gross: kr(10_000) } },
      status: "approved",
    },
  ];

  // Klassificeringen måste vara godkänd av båda parter för att tillämpas -
  // annars hamnar posten utanför enhetsmodellen och skapar ingen händelse.
  const REGLER = [
    { category: "Reparation", included: true, effectiveFrom: "2026-01-15", approved: true },
  ];

  function kor(varden: Avtalsvarden) {
    return calculate({
      agreement: avtal(varden),
      endpoint: {
        mode: "prognos",
        endDate: "2031-01-15",
        endValue: Number(varden.startValueOre),
        endLoan: Number(varden.initialLoanOre),
        saleCosts: 0,
      },
      categoryRules: REGLER,
      transactions: HISTORIK,
    });
  }

  it("ett tillägg som bara ändrar formell ägarandel rör inte utfallet", () => {
    // Den formella ägarandelen påverkar inte motorn. Ett tillägg som bara rör
    // den ska ge exakt samma tal.
    const fore = kor(GALLANDE);
    const efter = kor(
      nyaAvtalsvarden(GALLANDE, { formalOwnership: { caesar: 0.6, felicia: 0.4 } }),
    );

    expect(efter.finalUnits).toEqual(fore.finalUnits);
    expect(efter.settlement.finalPosition).toEqual(fore.settlement.finalPosition);
    expect(efter.events).toHaveLength(fore.events.length);
  });

  it("historiska poster ligger kvar i beräkningen efter ett tillägg", () => {
    // Det här är provet som hade fallit före rättningen. Med tilläggets
    // giltighetsdag som startdag hamnade båda posterna före startdagen och
    // uteslöts, så antalet händelser föll till noll.
    const fore = kor(GALLANDE);
    const efter = kor(nyaAvtalsvarden(GALLANDE, { initialLoanOre: "250000000" }));

    expect(fore.events.length).toBeGreaterThan(0);
    expect(efter.events.map((h) => h.date)).toEqual(fore.events.map((h) => h.date));
    expect(efter.excluded).toHaveLength(0);
  });

  it("hade fallit med den gamla regeln: giltighetsdagen som startdag", () => {
    // Beskriver felet uttryckligen, så att en återgång fälls här.
    const somFelet = { ...GALLANDE, startDate: "2026-06-01" };
    const trasigt = kor(somFelet);

    expect(trasigt.events).toHaveLength(0);
    expect(trasigt.excluded).toHaveLength(2);
    expect(trasigt.excluded[0].reason).toMatch(/före startdagen/i);

    // Och att den rättade sammanslagningen inte hamnar där.
    const rattat = nyaAvtalsvarden(GALLANDE, { initialLoanOre: "250000000" });
    expect(rattat.startDate).not.toBe("2026-06-01");
    expect(kor(rattat).events.length).toBeGreaterThan(0);
  });

  it("ett ändrat startvärde ändrar utfallet men behåller historiken", () => {
    const fore = kor(GALLANDE);
    const efter = kor(nyaAvtalsvarden(GALLANDE, { startValueOre: "500000000" }));

    // Samma poster behandlas...
    expect(efter.events.map((h) => h.transactionIds)).toEqual(
      fore.events.map((h) => h.transactionIds),
    );
    // ...men nettokapitalet är ett annat, så utfallet skiljer sig.
    expect(toKronor(efter.settlement.saleNet)).not.toBe(toKronor(fore.settlement.saleNet));
  });
});

describe("Värdena måste hänga ihop", () => {
  it("avvisar startenheter som inte summerar till totalen", () => {
    // Annars blir de interna andelarna 90 % och 60 %, tillsammans 150 %.
    const svar = granskaTillagg(
      GALLANDE,
      { startUnits: { caesar: 900000, felicia: 900000 } },
      undefined,
    );
    expect(svar.ok).toBe(false);
    if (svar.ok) return;
    expect(svar.skal).toMatch(/summerar till 1800000/);
  });

  it("släpper igenom när totalen ändras med enheterna", () => {
    const svar = granskaTillagg(
      GALLANDE,
      { startUnits: { caesar: 900000, felicia: 900000 }, totalUnits: "1800000" },
      undefined,
    );
    expect(svar.ok).toBe(true);
  });

  it("avvisar negativa startenheter", () => {
    const svar = granskaTillagg(
      GALLANDE,
      { startUnits: { caesar: 1600000, felicia: -100000 } },
      undefined,
    );
    expect(svar.ok).toBe(false);
    if (svar.ok) return;
    expect(svar.skal).toMatch(/negativa/);
  });

  it("avvisar totalt antal enheter som inte är positivt", () => {
    const svar = granskaTillagg(
      GALLANDE,
      { totalUnits: "0", startUnits: { caesar: 0, felicia: 0 } },
      undefined,
    );
    expect(svar.ok).toBe(false);
    if (svar.ok) return;
    expect(svar.skal).toMatch(/större än noll/);
  });

  it("avvisar formella ägarandelar som inte blir hundra procent", () => {
    const svar = granskaTillagg(
      GALLANDE,
      { formalOwnership: { caesar: 0.6, felicia: 0.6 } },
      undefined,
    );
    expect(svar.ok).toBe(false);
    if (svar.ok) return;
    expect(svar.skal).toMatch(/100 procent/);
  });

  it("avvisar en ägarandel utanför noll till hundra", () => {
    const svar = granskaTillagg(
      GALLANDE,
      { formalOwnership: { caesar: 1.4, felicia: -0.4 } },
      undefined,
    );
    expect(svar.ok).toBe(false);
    if (svar.ok) return;
    expect(svar.skal).toMatch(/mellan 0 och 100/);
  });

  it("tål avrundningsbrus i enheterna", () => {
    // En tiondels enhet är avrundning, inte ett verkligt fel.
    const svar = granskaTillagg(
      GALLANDE,
      { startUnits: { caesar: 900000.2, felicia: 599999.9 } },
      undefined,
    );
    expect(svar.ok).toBe(true);
  });
});
