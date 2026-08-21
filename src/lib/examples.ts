import {
  calculate,
  defaultCategoryRules,
  kr,
  toKronor,
  type AgreementParams,
  type Endpoint,
  type Transaction,
} from "@/lib/engine";

/**
 * Avtalets bilaga 1 som körbara exempel.
 *
 * Exemplen räknas fram av samma motor som räknar parternas riktiga avräkning.
 * De kan därför aldrig glida isär från verkligheten – ändras en regel ändras
 * exemplet med den, eller så går testerna sönder.
 *
 * Siffrorna nedan är avtalets egna, förenklade exempelsiffror och har inget
 * med parternas verkliga uppgifter att göra.
 */

const A = "part-a";
const B = "part-b";

/** 4 495 000 − 3 115 000 = 1 380 000 kr eget kapital, alltså 1,00 kr per enhet. */
const AGREEMENT: AgreementParams = {
  startDate: "2026-08-17",
  startValue: kr(4_495_000),
  initialLoan: kr(3_115_000),
  parties: [A, B],
  startUnits: { [A]: 1_200_000, [B]: 180_000 },
  totalUnits: 1_380_000,
};

const RULES = defaultCategoryRules(AGREEMENT.startDate);

function endpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    mode: "prognos",
    endDate: "2031-08-17",
    endValue: kr(4_495_000),
    endLoan: kr(3_115_000),
    saleCosts: 0,
    ...overrides,
  };
}

/** En post där den ena parten betalar allt, med en förenklad 80/20-nyckel. */
function paidBy(
  party: string,
  amount: number,
  options: { taxEffect?: number; date?: string; key?: [number, number] } = {},
): Transaction {
  const [keyA, keyB] = options.key ?? [0.8, 0.2];
  return {
    id: "EX-1",
    paymentDate: options.date ?? AGREEMENT.startDate,
    category: "Vitvara/fast utrustning",
    payments: {
      [party]: { gross: kr(amount), taxEffect: options.taxEffect ? kr(options.taxEffect) : 0 },
    },
    specialKey: { [A]: keyA, [B]: keyB },
    status: "approved",
  };
}

export type WorkedExample = {
  /** Kort mening som svarar på "vad hände?". */
  outcome: string;
  /** Stegen bakom siffran, i den ordning modellen tar dem. */
  steps: { label: string; value: string }[];
};

const money = (ore: number) =>
  new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 0,
  }).format(toKronor(ore));

const units = (value: number) =>
  `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(value)} enheter`;

/** Bilaga 1, exempel 2: en part betalar hela tvättmaskinen. */
export function washingMachineExample(): WorkedExample {
  const result = calculate({
    agreement: AGREEMENT,
    endpoint: endpoint(),
    categoryRules: RULES,
    transactions: [paidBy(B, 10_000)],
  });
  const event = result.events[0];

  return {
    outcome: `En överbetalning på ${money(event.overpayment)} blev ${units(event.transferredUnits)}.`,
    steps: [
      { label: "Kostnad efter avdrag", value: money(event.netCostTotal) },
      { label: "Din del enligt nyckeln", value: money(event.owed[B]) },
      { label: "Du betalade", value: money(event.netPayments[B]) },
      { label: "Överbetalning", value: money(event.overpayment) },
      { label: "Värde per enhet den dagen", value: money(event.unitValue ?? 0) },
      { label: "Enheter du fick", value: units(event.transferredUnits) },
    ],
  };
}

/** Bilaga 1, exempel 3: ränta efter faktisk skatteeffekt. */
export function interestExample(): WorkedExample {
  const result = calculate({
    agreement: AGREEMENT,
    endpoint: endpoint(),
    categoryRules: RULES,
    transactions: [{ ...paidBy(B, 10_000, { taxEffect: 3_000 }), category: "Ränta" }],
  });
  const event = result.events[0];

  return {
    outcome: `Skattereduktionen räknas av först, så överbetalningen blev ${money(event.overpayment)}.`,
    steps: [
      { label: "Du betalade", value: money(kr(10_000)) },
      { label: "Din skattereduktion", value: money(kr(3_000)) },
      { label: "Kostnad efter skatt", value: money(event.netCostTotal) },
      { label: "Din del enligt nyckeln", value: money(event.owed[B]) },
      { label: "Överbetalning", value: money(event.overpayment) },
      { label: "Enheter du fick", value: units(event.transferredUnits) },
    ],
  };
}

/** Bilaga 1, exempel 4–5: samma överbetalning när värdet stiger respektive sjunker. */
export function valueChangeExample(): WorkedExample {
  const transaction = paidBy(B, 10_000);
  const base = calculate({
    agreement: AGREEMENT,
    endpoint: endpoint(),
    categoryRules: RULES,
    transactions: [transaction],
  });

  const worth = (endValue: number) => {
    const withTx = calculate({
      agreement: AGREEMENT,
      endpoint: endpoint({ endValue: kr(endValue) }),
      categoryRules: RULES,
      transactions: [transaction],
    });
    const without = calculate({
      agreement: AGREEMENT,
      endpoint: endpoint({ endValue: kr(endValue) }),
      categoryRules: RULES,
      transactions: [],
    });
    return withTx.settlement.byShare[B] - without.settlement.byShare[B];
  };

  return {
    outcome: "Enheterna följer bostadens värde. Samma överbetalning kan bli mer eller mindre värd.",
    steps: [
      { label: "Överbetalning", value: money(base.events[0].overpayment) },
      { label: "Enheter", value: units(base.events[0].transferredUnits) },
      { label: "Om värdet stiger till 4 840 000 kr", value: money(worth(4_840_000)) },
      { label: "Om värdet är oförändrat", value: money(worth(4_495_000)) },
      { label: "Om värdet sjunker till 4 150 000 kr", value: money(worth(4_150_000)) },
    ],
  };
}

/** Bilaga 1, exempel 10: nettokapitalet räcker inte till. */
export function personalClaimExample(): WorkedExample {
  const result = calculate({
    agreement: AGREEMENT,
    endpoint: endpoint(),
    categoryRules: RULES,
    transactions: [
      {
        ...paidBy(A, 1_000_000),
        category: "Förbättring",
        specialKey: { [A]: 0, [B]: 1 },
      },
    ],
  });
  const event = result.events[0];

  return {
    outcome: `Bara ${money(event.convertedAmount)} kunde bli enheter. Resten blev en fordran i kronor.`,
    steps: [
      { label: "Överbetalning", value: money(event.overpayment) },
      { label: "Enheter det skulle motsvara", value: units(event.requestedUnits) },
      { label: "Enheter motparten hade", value: units(event.transferredUnits) },
      { label: "Omvandlat till enheter", value: money(event.convertedAmount) },
      { label: "Kvar som personlig fordran", value: money(event.personalClaim?.amount ?? 0) },
    ],
  };
}

/** Bilaga 1, exempel 8: det linjära mellanvärdet. */
export function linearValueExample(): WorkedExample {
  const result = calculate({
    agreement: {
      ...AGREEMENT,
      startValue: kr(4_500_000),
      initialLoan: kr(3_000_000),
    },
    endpoint: endpoint({ endValue: kr(5_500_000), endLoan: kr(3_000_000) }),
    categoryRules: RULES,
    transactions: [
      { ...paidBy(B, 10_000, { date: "2028-08-17" }), category: "Reparation", specialKey: null },
    ],
  });
  const event = result.events[0];

  return {
    outcome: "Värdet mellan köp och försäljning räknas som en rak linje, dag för dag.",
    steps: [
      { label: "Startvärde", value: money(kr(4_500_000)) },
      { label: "Antaget slutvärde om fem år", value: money(kr(5_500_000)) },
      { label: "Beräknat värde efter två år", value: money(event.linearValue) },
      { label: "Lån den dagen", value: money(event.loanBalance) },
      { label: "Nettokapital", value: money(event.netEquity) },
      { label: "Värde per enhet", value: money(event.unitValue ?? 0) },
    ],
  };
}

export const EXAMPLES = {
  washingMachine: washingMachineExample,
  interest: interestExample,
  valueChange: valueChangeExample,
  personalClaim: personalClaimExample,
  linearValue: linearValueExample,
} as const;

export type ExampleKey = keyof typeof EXAMPLES;
