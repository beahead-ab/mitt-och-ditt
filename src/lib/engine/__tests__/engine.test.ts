import { describe, expect, it } from "vitest";

import { calculate, ModelVersionError, netPayment } from "../engine";
import { addDays } from "../dates";
import { kr, toKronor } from "../money";
import { AGREEMENT, CAESAR, FELICIA, RULES, START_DATE, flatEndpoint, input, tx } from "./fixtures";

describe("Godkännande och korrigeringar", () => {
  it("bara poster godkända av båda parter påverkar andelarna", () => {
    const result = calculate(
      input({
        transactions: [
          tx({ id: "T1", status: "pending", payments: { [FELICIA]: { gross: kr(10_000) } } }),
          tx({ id: "T2", status: "disputed", payments: { [FELICIA]: { gross: kr(10_000) } } }),
          tx({ id: "T3", status: "draft", payments: { [FELICIA]: { gross: kr(10_000) } } }),
        ],
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(result.finalUnits[FELICIA]).toBe(180_000);
    expect(result.excluded).toHaveLength(3);
    expect(result.excluded[0].reason).toContain("Inte godkänd");
  });

  it("en godkänd korrigering ersätter ursprungsposten", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            payments: { [FELICIA]: { gross: kr(10_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
          tx({
            id: "K1",
            correctsId: "T1",
            payments: { [FELICIA]: { gross: kr(4_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
        ],
      }),
    );

    expect(result.excluded).toContainEqual({
      transactionId: "T1",
      reason: "Ersatt av korrigeringspost",
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].transactionIds).toEqual(["K1"]);
    expect(toKronor(result.events[0].overpayment)).toBe(3_200); // 4 000 − 20 %
  });

  it("en korrigering som ännu inte godkänts lämnar ursprungsposten orörd", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            payments: { [FELICIA]: { gross: kr(10_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
          tx({ id: "K1", correctsId: "T1", status: "pending", payments: {} }),
        ],
      }),
    );
    expect(result.events[0].transactionIds).toEqual(["T1"]);
    expect(toKronor(result.events[0].overpayment)).toBe(8_000);
  });
});

describe("Kronologi och nettning", () => {
  it("poster samma dag nettas innan enheterna flyttas", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            category: "Reparation",
            payments: { [FELICIA]: { gross: kr(10_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
          tx({
            id: "T2",
            category: "Underhåll",
            payments: { [CAESAR]: { gross: kr(10_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
        ],
      }),
    );

    // Felicia överbetalar 8 000 och Caesar 2 000: netto 6 000 till Felicia,
    // och bara en enda enhetsöverföring görs för dagen.
    expect(result.events).toHaveLength(1);
    expect(result.events[0].transactionIds).toEqual(["T1", "T2"]);
    expect(result.events[0].overpayer).toBe(FELICIA);
    expect(toKronor(result.events[0].overpayment)).toBe(6_000);
    expect(result.events[0].transferredUnits).toBeCloseTo(6_000, 6);
  });

  it("nästa dags kostnadsnyckel är andelarna efter föregående dags överföring", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            payments: { [FELICIA]: { gross: kr(138_000) } },
            specialKey: { [CAESAR]: 1, [FELICIA]: 0 },
          }),
          tx({
            id: "T2",
            paymentDate: addDays(START_DATE, 10),
            category: "Reparation",
            payments: { [CAESAR]: { gross: kr(10_000) } },
          }),
        ],
      }),
    );

    // Efter dag 1: Felicia 318 000 enheter av 1 380 000 = 23,043478 %.
    expect(result.events[0].sharesAfter[FELICIA]).toBeCloseTo(0.2304348, 7);
    // Dag 2 använder exakt den andelen som kostnadsnyckel.
    expect(result.events[1].keyBefore[FELICIA]).toBeCloseTo(0.2304348, 7);
    expect(toKronor(result.events[1].owed[FELICIA])).toBeCloseTo(2_304.35, 2);
  });

  it("betalningsdagar utanför avtalsperioden utesluts och flaggas", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            paymentDate: "2026-08-16",
            payments: { [FELICIA]: { gross: kr(1_000) } },
          }),
          tx({
            id: "T2",
            paymentDate: "2031-08-18",
            payments: { [FELICIA]: { gross: kr(1_000) } },
          }),
        ],
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(result.excluded.map((e) => e.reason)).toEqual([
      "Betalningsdag före startdagen",
      "Betalningsdag efter slutdagen",
    ]);
    expect(result.warnings).toHaveLength(2);
  });
});

describe("Nettokostnad", () => {
  it("varje förmån som tillfallit parten dras av", () => {
    expect(
      netPayment({
        gross: kr(10_000),
        discount: kr(500),
        refund: kr(300),
        insurance: kr(1_000),
        taxEffect: kr(2_000),
      }),
    ).toBe(kr(6_200));
  });

  it("skattefördelen förs på den part som faktiskt fick den", () => {
    // Felicia betalar hela räntan men Caesar får skattereduktionen.
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            category: "Ränta",
            payments: {
              [FELICIA]: { gross: kr(10_000) },
              [CAESAR]: { gross: 0, taxEffect: kr(3_000) },
            },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
        ],
      }),
    );

    const event = result.events[0];
    expect(toKronor(event.netCostTotal)).toBe(7_000);
    expect(toKronor(event.netPayments[CAESAR])).toBe(-3_000);
    expect(toKronor(event.netPayments[FELICIA])).toBe(10_000);
    expect(toKronor(event.owed[CAESAR])).toBe(5_600);
    // Caesars nettobelastning är −3 000 mot avtalade 5 600: han underbetalar 8 600.
    expect(toKronor(event.difference[CAESAR])).toBe(-8_600);
    expect(toKronor(event.overpayment)).toBe(8_600);
    expect(event.overpayer).toBe(FELICIA);
  });

  it("preliminär skatteeffekt räknas men markeras", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            category: "Ränta",
            payments: {
              [FELICIA]: { gross: kr(10_000), taxEffect: kr(3_000), taxPreliminary: true },
            },
          }),
        ],
      }),
    );
    expect(result.preliminaryTaxCount).toBe(1);
    expect(result.events[0].hasPreliminaryTax).toBe(true);
  });
});

describe("Lånesaldo", () => {
  it("amortering minskar saldot och höjer nettokapitalet", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            category: "Amortering",
            payments: { [FELICIA]: { gross: kr(100_000) } },
          }),
          tx({
            id: "T2",
            paymentDate: addDays(START_DATE, 10),
            category: "Reparation",
            payments: { [CAESAR]: { gross: kr(1_000) } },
          }),
        ],
      }),
    );

    // Amorteringsdagen använder saldot efter dagens amortering (avtal 9.2),
    // så nettokapitalet ökar redan samma dag.
    expect(toKronor(result.events[0].loanBalance)).toBe(3_015_000);
    expect(toKronor(result.events[0].netEquity)).toBe(1_480_000);
    // Saldot bärs framåt till nästa post.
    expect(toKronor(result.events[1].loanBalance)).toBe(3_015_000);
    expect(toKronor(result.events[1].netEquity)).toBe(1_480_000);
  });

  it("verifierat saldo på posten gäller före härledningen", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            category: "Amortering",
            payments: { [FELICIA]: { gross: kr(100_000) } },
            loanBalanceAfter: kr(3_000_000),
          }),
        ],
      }),
    );
    expect(toKronor(result.events[0].loanBalance)).toBe(3_000_000);
    expect(toKronor(result.events[0].netEquity)).toBe(1_495_000);
  });

  it("en uttrycklig avstämning ersätter härledningen framåt", () => {
    const result = calculate(
      input({
        loanSnapshots: [{ date: addDays(START_DATE, 5), balance: kr(2_900_000) }],
        transactions: [
          tx({
            id: "T1",
            paymentDate: addDays(START_DATE, 10),
            category: "Reparation",
            payments: { [CAESAR]: { gross: kr(1_000) } },
          }),
        ],
      }),
    );
    expect(toKronor(result.events[0].loanBalance)).toBe(2_900_000);
  });
});

describe("Kostnader utanför enhetsmodellen", () => {
  it("BRF-avgift och försäkring delas 50/50 utan enhetsöverföring", () => {
    const result = calculate(
      input({
        transactions: [
          tx({ id: "T1", category: "BRF-avgift", payments: { [CAESAR]: { gross: kr(4_500) } } }),
          tx({ id: "T2", category: "Försäkring", payments: { [FELICIA]: { gross: kr(2_000) } } }),
        ],
      }),
    );

    expect(result.events).toHaveLength(0);
    expect(result.outside.entries).toHaveLength(2);
    // Caesar har lagt ut 4 500 och ska bära 2 250; Felicia 2 000 mot 1 000.
    expect(toKronor(result.outside.balance[CAESAR])).toBe(2_250 - 1_000);
    expect(toKronor(result.outside.balance[FELICIA])).toBe(1_000 - 2_250);
    expect(result.finalUnits[CAESAR]).toBe(1_200_000);
  });

  it("saldot utanför modellen regleras krona för krona i slutavräkningen", () => {
    const result = calculate(
      input({
        transactions: [
          tx({ id: "T1", category: "BRF-avgift", payments: { [CAESAR]: { gross: kr(10_000) } } }),
        ],
      }),
    );
    // Caesar har lagt ut 10 000 på en kostnad som delas lika. Han ska bära
    // 5 000 av dem själv, så det Felicia är skyldig honom är 5 000 - inte hela
    // utlägget. Att kräva hela beloppet vore att låta honom slippa sin egen del.
    expect(toKronor(result.settlement.outsideNet[CAESAR])).toBe(5_000);
    expect(toKronor(result.settlement.outsideNet[FELICIA])).toBe(-5_000);
    expect(result.settlement.checks.positionsBalance).toBe(0);
  });

  it("saldot utanför modellen är samma tal i översikten som i avräkningen", () => {
    // Översikten läser outside.balance, avräkningen outsideNet. Visar de olika
    // tal för samma skuld ser paret två svar på en fråga och kan inte veta
    // vilket som gäller. Summakontrollen fångar inte det, eftersom vilket
    // motsatspar som helst summerar till noll - därför prövas det här.
    const result = calculate(
      input({
        transactions: [
          tx({ id: "T1", category: "BRF-avgift", payments: { [CAESAR]: { gross: kr(4_850) } } }),
          tx({ id: "T2", category: "Försäkring", payments: { [FELICIA]: { gross: kr(1_200) } } }),
        ],
      }),
    );

    expect(result.settlement.outsideNet[CAESAR]).toBe(result.outside.balance[CAESAR]);
    expect(result.settlement.outsideNet[FELICIA]).toBe(result.outside.balance[FELICIA]);
    // Och saldot självt tar ut sig, vilket är varför differensen inte ska tas.
    expect(result.outside.balance[CAESAR] + result.outside.balance[FELICIA]).toBe(0);
    expect(result.settlement.checks.positionsBalance).toBe(0);
  });

  it("ett oklassificerat kostnadsslag hamnar utanför modellen och varnar", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            category: "Nytt kostnadsslag",
            payments: { [CAESAR]: { gross: kr(5_000) } },
          }),
        ],
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(result.outside.entries).toHaveLength(1);
    expect(result.warnings[0]).toContain("saknar godkänd klassificering");
  });

  it("en klassificering gäller först från sin giltighetsdag", () => {
    const rules = [
      ...RULES,
      {
        category: "Nytt kostnadsslag",
        effectiveFrom: addDays(START_DATE, 100),
        included: true,
        approved: true,
      },
    ];
    const result = calculate(
      input({
        categoryRules: rules,
        transactions: [
          tx({
            id: "T1",
            paymentDate: addDays(START_DATE, 50),
            category: "Nytt kostnadsslag",
            payments: { [CAESAR]: { gross: kr(5_000) } },
          }),
          tx({
            id: "T2",
            paymentDate: addDays(START_DATE, 150),
            category: "Nytt kostnadsslag",
            payments: { [CAESAR]: { gross: kr(5_000) } },
          }),
        ],
      }),
    );

    expect(result.outside.entries.map((e) => e.transactionId)).toEqual(["T1"]);
    expect(result.events.map((e) => e.transactionIds)).toEqual([["T2"]]);
  });

  it("en klassificering som bara en part godkänt tillämpas inte", () => {
    const rules = [
      ...RULES,
      {
        category: "Nytt kostnadsslag",
        effectiveFrom: START_DATE,
        included: true,
        approved: false,
      },
    ];
    const result = calculate(
      input({
        categoryRules: rules,
        transactions: [
          tx({
            id: "T1",
            category: "Nytt kostnadsslag",
            payments: { [CAESAR]: { gross: kr(5_000) } },
          }),
        ],
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(result.outside.entries).toHaveLength(1);
  });
});

describe("Slutavräkning", () => {
  it("försäljningsnettot fördelas enligt de slutliga andelarna", () => {
    const result = calculate(
      input({
        endpoint: flatEndpoint({
          mode: "slutlig",
          endValue: kr(5_500_000),
          endLoan: kr(2_800_000),
          saleCosts: kr(80_000),
        }),
      }),
    );

    expect(toKronor(result.settlement.saleNet)).toBe(2_620_000);
    expect(toKronor(result.settlement.byShare[CAESAR])).toBeCloseTo(2_278_260.87, 2);
    expect(toKronor(result.settlement.byShare[FELICIA])).toBeCloseTo(341_739.13, 2);
    expect(result.settlement.checks.ok).toBe(true);
  });

  it("fordringar läggs till den berättigade och dras från den betalningsskyldiga", () => {
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

    expect(toKronor(result.settlement.claimsNet[FELICIA])).toBe(8_000);
    expect(toKronor(result.settlement.claimsNet[CAESAR])).toBe(-8_000);
    expect(result.settlement.checks.positionsBalance).toBe(0);
  });

  it("slutdag lika med startdag ger slutvärdet direkt", () => {
    const result = calculate(
      input({
        endpoint: flatEndpoint({ endDate: START_DATE, endValue: kr(4_600_000) }),
        transactions: [
          tx({ id: "T1", category: "Reparation", payments: { [CAESAR]: { gross: kr(10_000) } } }),
        ],
      }),
    );
    expect(toKronor(result.events[0].linearValue)).toBe(4_600_000);
  });

  it("avvisar en slutdag före startdagen", () => {
    expect(() => calculate(input({ endpoint: flatEndpoint({ endDate: "2026-08-16" }) }))).toThrow(
      /Slutdagen/,
    );
  });
});

describe("Makulering", () => {
  it("tar bort posten ur beräkningen utan att radera den", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            payments: { [FELICIA]: { gross: kr(10_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
          tx({ id: "M1", voidsId: "T1", reason: "Posten hörde inte hit", payments: {} }),
        ],
      }),
    );

    expect(result.events).toHaveLength(0);
    expect(result.finalUnits[FELICIA]).toBe(180_000);
    expect(result.excluded).toContainEqual({ transactionId: "T1", reason: "Makulerad" });
    // Ursprungsposten finns kvar i underlaget och kan visas för parterna.
    expect(result.excluded.map((e) => e.transactionId)).toContain("T1");
  });

  it("skapar ingen egen dagsberäkning", () => {
    const result = calculate(
      input({
        transactions: [
          tx({ id: "T1", category: "Reparation", payments: { [CAESAR]: { gross: kr(5_000) } } }),
          tx({
            id: "M1",
            paymentDate: addDays(START_DATE, 30),
            voidsId: "T1",
            reason: "Dubbelregistrerad",
            payments: {},
          }),
        ],
      }),
    );

    expect(result.events).toHaveLength(0);
    expect(result.excluded).toContainEqual({
      transactionId: "M1",
      reason: "Makuleringspost utan egen ekonomisk effekt",
    });
  });

  it("verkar först när båda parter godkänt makuleringen", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            payments: { [FELICIA]: { gross: kr(10_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
          tx({ id: "M1", voidsId: "T1", status: "pending", payments: {} }),
        ],
      }),
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].transactionIds).toEqual(["T1"]);
    expect(toKronor(result.events[0].overpayment)).toBe(8_000);
  });

  it("makulerad korrigering låter inte ursprungsposten återuppstå", () => {
    const result = calculate(
      input({
        transactions: [
          tx({
            id: "T1",
            payments: { [FELICIA]: { gross: kr(10_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
          tx({
            id: "K1",
            correctsId: "T1",
            payments: { [FELICIA]: { gross: kr(4_000) } },
            specialKey: { [CAESAR]: 0.8, [FELICIA]: 0.2 },
          }),
          tx({ id: "M1", voidsId: "K1", reason: "Hela posten utgår", payments: {} }),
        ],
      }),
    );

    // Både ursprunget och korrigeringen står utanför: hela posten är borta.
    expect(result.events).toHaveLength(0);
    expect(result.finalUnits[FELICIA]).toBe(180_000);
    const reasons = Object.fromEntries(result.excluded.map((e) => [e.transactionId, e.reason]));
    expect(reasons.T1).toBe("Ersatt av korrigeringspost");
    expect(reasons.K1).toBe("Makulerad");
  });

  it("återkallade och tvistiga poster får egna skäl", () => {
    const result = calculate(
      input({
        transactions: [
          tx({ id: "T1", status: "withdrawn", payments: { [CAESAR]: { gross: kr(1_000) } } }),
          tx({ id: "T2", status: "disputed", payments: { [CAESAR]: { gross: kr(1_000) } } }),
          tx({ id: "T3", status: "draft", payments: { [CAESAR]: { gross: kr(1_000) } } }),
        ],
      }),
    );
    const reasons = Object.fromEntries(result.excluded.map((e) => [e.transactionId, e.reason]));
    expect(reasons.T1).toBe("Återkallad av registratorn");
    expect(reasons.T2).toContain("Tvistig");
    expect(reasons.T3).toBe("Utkast");
  });
});

describe("Partsnycklarna är nycklar, inte namn", () => {
  /**
   * Tjänsten ska kunna användas av vilket par som helst. Nycklarna 'caesar' och
   * 'felicia' är det första hushållets, inget annat - de står som nycklar inuti
   * transaktionernas payments och avtalets start_units, och motorn slår upp på
   * dem. Ett par som heter något annat måste få exakt samma räkning.
   */
  function körning(a: string, b: string) {
    return calculate({
      agreement: {
        ...AGREEMENT,
        parties: [a, b],
        startUnits: { [a]: 1_200_000, [b]: 180_000 },
      },
      endpoint: flatEndpoint(),
      categoryRules: RULES,
      transactions: [
        tx({ id: "T1", payments: { [a]: { gross: kr(12_000) } } }),
        tx({ id: "T2", category: "BRF-avgift", payments: { [b]: { gross: kr(4_850) } } }),
      ],
    });
  }

  it("ger samma utfall oavsett vad parterna heter", () => {
    const först = körning(CAESAR, FELICIA);
    const sedan = körning("nora", "idris");

    expect(sedan.finalUnits.nora).toBe(först.finalUnits[CAESAR]);
    expect(sedan.finalUnits.idris).toBe(först.finalUnits[FELICIA]);
    expect(sedan.finalShares.nora).toBe(först.finalShares[CAESAR]);
    expect(sedan.settlement.finalPosition.nora).toBe(först.settlement.finalPosition[CAESAR]);
    expect(sedan.settlement.finalPosition.idris).toBe(först.settlement.finalPosition[FELICIA]);
    expect(sedan.outside.balance.nora).toBe(först.outside.balance[CAESAR]);
    expect(sedan.settlement.checks.positionsBalance).toBe(0);
    // Och ingenting i utfallet nämner det första hushållets nycklar.
    expect(Object.keys(sedan.finalUnits).sort()).toEqual(["idris", "nora"]);
  });

  it("räknar lika även när nycklarna sorterar tvärtom mot namnen", () => {
    // 'a' sorterar före 'z', men parternas ordning kommer ur avtalet - inte ur
    // hur nycklarna råkar sorteras. Annars skulle utfallet bero på stavning.
    const framlänges = körning("aaa", "zzz");
    const baklänges = körning("zzz", "aaa");

    // Den först uppräknade parten får samma enheter i båda körningarna, trots
    // att nycklarna sorterar tvärtom. Ingen magisk konstant här: poängen är att
    // de två körningarna är varandras spegel, inte vilket talet råkar bli.
    expect(framlänges.finalUnits.aaa).toBe(baklänges.finalUnits.zzz);
    expect(framlänges.finalUnits.zzz).toBe(baklänges.finalUnits.aaa);
    expect(framlänges.finalUnits.aaa).toBeGreaterThan(1_200_000);
    expect(framlänges.settlement.checks.positionsBalance).toBe(0);
    expect(baklänges.settlement.checks.positionsBalance).toBe(0);
  });
});

describe("Avtalsmodellen motorn förutsätter", () => {
  /**
   * ENGINE_VERSION säger vad koden är. modelVersion säger vad handlingen
   * bygger på. Med flera par kommer avtal skrivna under olika mallversioner
   * att möta samma motor, och ett tal som ser rimligt ut men bygger på fel
   * regler är farligare än inget tal alls - det går att fatta beslut på.
   */
  it("räknar när modellen är den motorn kör", () => {
    const result = calculate(input({ agreement: { ...AGREEMENT, modelVersion: "1" } }));
    expect(result.settlement.checks.positionsBalance).toBe(0);
  });

  it("utelämnad modell betyder den enda som funnits", () => {
    expect(() => calculate(input())).not.toThrow();
  });

  it("vägrar räkna på en modell den inte kör", () => {
    expect(() => calculate(input({ agreement: { ...AGREEMENT, modelVersion: "2" } }))).toThrow(
      ModelVersionError,
    );
  });

  it("felet säger vilken modell som krävs och vilka som körs", () => {
    try {
      calculate(input({ agreement: { ...AGREEMENT, modelVersion: "42" } }));
      throw new Error("Skulle ha kastat.");
    } catch (fel) {
      expect(fel).toBeInstanceOf(ModelVersionError);
      const m = fel as ModelVersionError;
      expect(m.modelVersion).toBe("42");
      expect(m.supported).toContain("1");
      // Meddelandet ska gå att visa för en part, inte bara för en utvecklare.
      expect(m.message).toContain("42");
      expect(m.message).toMatch(/installation/);
    }
  });
});
