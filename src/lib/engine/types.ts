import type { IsoDate } from "./dates";
import type { Ore } from "./money";

/** Parterna identifieras med stabila ID:n. Modellen är helt symmetrisk. */
export type PartyId = string;

/** Ett värde per part. Alla poster där båda parter förekommer använder denna form. */
export type ByParty<T> = Record<PartyId, T>;

/**
 * Avtalets **parametrar** – det som paret faktiskt kommer överens om och som
 * därför får konfigureras per hushåll och avtalsversion. Beräkningens struktur
 * (den linjära formeln, kronologin, spärrarna) är däremot fast i koden,
 * eftersom avtalets punkt 25.1 kräver undertecknat tilläggsavtal för att ändra
 * den. Fälten här motsvarar avtalets punkt 2 och 6.
 */
export type AgreementParams = {
  /** Tillträdesdagen för det gemensamma förvärvet (avtal 2, "Startdag"). */
  startDate: IsoDate;
  /** Faktisk köpeskilling på startdagen (avtal 8.1, "Startvärde"). */
  startValue: Ore;
  /** Extern låneskuld på startdagen. */
  initialLoan: Ore;
  /** Parternas ID:n, exakt två. */
  parties: [PartyId, PartyId];
  /** Startenheter per part – normalt en enhet per krona styrkt kapital (avtal 2.2). */
  startUnits: ByParty<number>;
  /** Formell ägarandel enligt köpehandling/förening. Påverkar inte motorn. */
  formalOwnership?: ByParty<number>;
  /**
   * Totalt antal andelsenheter. Normalt summan av startenheterna. Modellen
   * flyttar enheter mellan parterna men skapar aldrig nya (avtal 6.2).
   */
  totalUnits: number;
};

/**
 * Kostnadsklassificering med giltighetsdag (avtal 25.2). Vid flera godkända
 * klassificeringar av samma kostnadsslag gäller den med senaste giltighetsdag
 * som inte ligger efter betalningsdagen. Endast klassificeringar som båda
 * parter godkänt får styra beräkningen.
 */
export type CostCategoryRule = {
  category: string;
  effectiveFrom: IsoDate;
  /** true = INGÅR i enhetsmodellen, false = INGÅR INTE. */
  included: boolean;
  /**
   * Fördelning för kostnadsslag utanför enhetsmodellen, t.ex. 50/50 för
   * BRF-avgift och försäkring (avtal 7.2). Utelämnad = lika delar.
   */
  outsideSplit?: ByParty<number>;
  /** Amortering minskar den externa låneskulden och därmed nettokapitalet (avtal 12.1). */
  reducesLoan?: boolean;
  /** Endast klassificeringar godkända av båda parter får tillämpas. */
  approved: boolean;
};

/** En parts betalning för en post. Alla belopp i öre, aldrig negativa. */
export type PartyPayment = {
  /** Faktiskt betalt bruttobelopp. */
  gross: Ore;
  /** Rabatt som faktiskt tillfallit parten. */
  discount?: Ore;
  /** Återbetalning som faktiskt tillfallit parten. */
  refund?: Ore;
  /** Försäkringsersättning som faktiskt tillfallit parten. */
  insurance?: Ore;
  /**
   * Faktisk skatteeffekt som tillfallit just denna part (avtal 11.2–11.3).
   * Förs på den part som verkligen fick fördelen, inte på den banken
   * rapporterat räntan på.
   */
  taxEffect?: Ore;
  /** Preliminär skatteeffekt markeras och rättas när slutligt utfall är känt (avtal 11.4). */
  taxPreliminary?: boolean;
};

/**
 * En posts läge i godkännandeflödet.
 *
 * - `draft` – utkast som bara registratorn ser. Får raderas.
 * - `pending` – inskickad, väntar på motpartens godkännande.
 * - `withdrawn` – återkallad av registratorn innan motparten hann ta ställning.
 *   Posten försvinner inte, den slutar bara efterfråga ett godkännande.
 * - `approved` – godkänd av båda och därmed en del av beräkningen.
 * - `disputed` – motparten har invänt. Ligger utanför beräkningen tills den löses.
 */
export type TransactionStatus = "draft" | "pending" | "withdrawn" | "approved" | "disputed";

export type Transaction = {
  id: string;
  paymentDate: IsoDate;
  category: string;
  description?: string;
  payments: ByParty<PartyPayment>;
  /**
   * Särskild kostnadsnyckel för just denna post (avtal 7.4). Utelämnad =
   * parternas interna ekonomiska andelar omedelbart före transaktionen.
   */
  specialKey?: ByParty<number> | null;
  /** Verifierat lånesaldo efter dagens samtliga amorteringar (avtal 9.2). */
  loanBalanceAfter?: Ore | null;
  status: TransactionStatus;
  /** Korrigeringspost: ersätter posten med detta ID när båda godkänt (ersättningssemantik). */
  correctsId?: string | null;
  /**
   * Makuleringspost: tar bort posten med detta ID ur beräkningen när båda
   * godkänt. Ursprungsposten raderas aldrig, den slutar bara räknas och
   * märks som makulerad (avtal 14.3). En makuleringspost har inga egna
   * betalningar och är alltså en ren bokföringsmarkering.
   */
  voidsId?: string | null;
  /** Skälet till korrigeringen eller makuleringen. Krävs för båda. */
  reason?: string;
};

/** Uttrycklig avstämning av lånesaldot, t.ex. vid omläggning. */
export type LoanBalanceSnapshot = {
  date: IsoDate;
  balance: Ore;
};

export type CalculationMode = "prognos" | "slutlig";

/**
 * Slutpunkten. I prognosläge är slutvärdet ett antagande; i slutläge är det
 * faktiskt försäljningspris eller fastställt utköpsvärde (avtal 8.1).
 */
export type Endpoint = {
  mode: CalculationMode;
  endDate: IsoDate;
  endValue: Ore;
  /** Kvarvarande externa lån på slutdagen. */
  endLoan: Ore;
  /**
   * Faktiska direkta försäljningskostnader. Vid utköp dras inget hypotetiskt
   * mäklararvode av (avtal 18.4), alltså normalt 0.
   */
  saleCosts?: Ore;
};

export type EngineInput = {
  agreement: AgreementParams;
  endpoint: Endpoint;
  categoryRules: CostCategoryRule[];
  transactions: Transaction[];
  loanSnapshots?: LoanBalanceSnapshot[];
};

/** En dags samlade behandling – motsvarar arkets "dagsrad". */
export type DayEvent = {
  date: IsoDate;
  transactionIds: string[];
  /** Linjärt beräknat bostadsvärde på dagen (avtal 8.2). */
  linearValue: Ore;
  loanBalance: Ore;
  netEquity: Ore;
  /** Värde per andelsenhet i öre. null när nettokapitalet inte är positivt. */
  unitValue: number | null;
  keyBefore: ByParty<number>;
  netCostTotal: Ore;
  netPayments: ByParty<Ore>;
  owed: ByParty<Ore>;
  difference: ByParty<Ore>;
  overpayer: PartyId | null;
  overpayment: Ore;
  requestedUnits: number;
  transferredUnits: number;
  convertedAmount: Ore;
  /** Överbetalning som inte kunde omvandlas blir personlig fordran (avtal 9.4, 10.4). */
  personalClaim: { party: PartyId; amount: Ore } | null;
  unitsAfter: ByParty<number>;
  sharesAfter: ByParty<number>;
  hasPreliminaryTax: boolean;
  notes: string[];
};

/** Post utanför enhetsmodellen – regleras krona för krona (avtal 7.2). */
export type OutsideEntry = {
  transactionId: string;
  date: IsoDate;
  category: string;
  netCostTotal: Ore;
  split: ByParty<number>;
  owed: ByParty<Ore>;
  netPayments: ByParty<Ore>;
  difference: ByParty<Ore>;
};

export type ExcludedTransaction = {
  transactionId: string;
  reason: string;
};

export type Settlement = {
  saleNet: Ore;
  byShare: ByParty<Ore>;
  /** Nettade personliga fordringar (avtal 14.5, 15.4). */
  claimsNet: ByParty<Ore>;
  /** Nettat saldo för kostnader utanför enhetsmodellen. */
  outsideNet: ByParty<Ore>;
  finalPosition: ByParty<Ore>;
  checks: {
    unitsBalance: number;
    sharesBalance: number;
    positionsBalance: Ore;
    ok: boolean;
  };
};

export type EngineResult = {
  engineVersion: string;
  mode: CalculationMode;
  events: DayEvent[];
  outside: { entries: OutsideEntry[]; balance: ByParty<Ore> };
  finalUnits: ByParty<number>;
  finalShares: ByParty<number>;
  /** Ackumulerade personliga fordringar per berättigad part. */
  claims: ByParty<Ore>;
  settlement: Settlement;
  excluded: ExcludedTransaction[];
  warnings: string[];
  preliminaryTaxCount: number;
};
