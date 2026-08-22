import { ModelVersionError } from "@/lib/engine/engine";
import {
  calculate,
  compareDates,
  daysBetween,
  isOnOrBefore,
  ruleFor,
  toIsoDate,
  type AgreementParams,
  type CostCategoryRule,
  type EngineInput,
  type EngineResult,
  type Endpoint,
  type IsoDate,
  type Ore,
  type Transaction,
} from "@/lib/engine";

/** Dagens datum som kalenderdatum i svensk tid. */
export function today(): IsoDate {
  const now = new Date();
  const stockholm = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Stockholm" }));
  return toIsoDate(Date.UTC(stockholm.getFullYear(), stockholm.getMonth(), stockholm.getDate()));
}

/** Härlett lånesaldo på en dag: startlånet minus godkända amorteringar. */
export function derivedLoan(
  agreement: AgreementParams,
  rules: CostCategoryRule[],
  transactions: Transaction[],
  date: IsoDate,
): Ore {
  const [a, b] = agreement.parties;
  const amortized = transactions
    .filter((t) => t.status === "approved")
    .filter((t) => isOnOrBefore(t.paymentDate, date))
    .filter((t) => ruleFor(rules, t.category, t.paymentDate)?.reducesLoan)
    .reduce((sum, t) => sum + (t.payments[a]?.gross ?? 0) + (t.payments[b]?.gross ?? 0), 0);
  return agreement.initialLoan - amortized;
}

/**
 * Standardantagandet i prognosläge: **avräkning idag med oförändrat värde**.
 * Det är det mest neutrala läget – det kräver ingen gissning om marknaden och
 * svarar på frågan "hur ser det ut om vi avräknar nu?". Parterna kan när som
 * helst byta antagande i simulatorn utan att något sparas.
 */
export function defaultEndpoint(
  agreement: AgreementParams,
  rules: CostCategoryRule[],
  transactions: Transaction[],
  now: IsoDate = today(),
): Endpoint {
  const lastPayment = transactions
    .filter((t) => t.status === "approved")
    .map((t) => t.paymentDate)
    .sort(compareDates)
    .pop();
  let endDate = now;
  if (compareDates(endDate, agreement.startDate) < 0) endDate = agreement.startDate;
  if (lastPayment && compareDates(lastPayment, endDate) > 0) endDate = lastPayment;

  return {
    mode: "prognos",
    endDate,
    endValue: agreement.startValue,
    endLoan: derivedLoan(agreement, rules, transactions, endDate),
    saleCosts: 0,
  };
}

export function buildInput(
  agreement: AgreementParams,
  rules: CostCategoryRule[],
  transactions: Transaction[],
  endpoint: Endpoint,
): EngineInput {
  return { agreement, categoryRules: rules, transactions, endpoint };
}

export function run(
  agreement: AgreementParams,
  rules: CostCategoryRule[],
  transactions: Transaction[],
  endpoint: Endpoint,
): EngineResult {
  return calculate(buildInput(agreement, rules, transactions, endpoint));
}

/** Poster som väntar på motpartens godkännande. */
export function pendingTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter((t) => t.status === "pending");
}

/** Poster som en part invänt mot och som därför står utanför beräkningen. */
export function disputedTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter((t) => t.status === "disputed");
}

/**
 * Godkända poster över beloppsgränsen som saknar underlag (avtal 14.3).
 * Kontrollen görs mot faktiska bilagor – en beskrivning är inget underlag.
 */
export const RECEIPT_THRESHOLD: Ore = 100_000; // 1 000 kr

export function missingReceipts(
  agreement: AgreementParams,
  transactions: Transaction[],
  referencesWithAttachment: ReadonlySet<string>,
): Transaction[] {
  const [a, b] = agreement.parties;
  return (
    transactions
      .filter((t) => t.status === "approved")
      // En makuleringspost bär ingen egen ekonomi och behöver inget underlag.
      .filter((t) => !t.voidsId)
      .filter((t) => (t.payments[a]?.gross ?? 0) + (t.payments[b]?.gross ?? 0) >= RECEIPT_THRESHOLD)
      .filter((t) => !referencesWithAttachment.has(t.id))
  );
}

/**
 * Parterna ska minst kvartalsvis kontrollera att betalningar, lånesaldon,
 * skatteuppgifter och underlag är registrerade (avtal 14.4). Utan en
 * registrerad avstämning räknas tiden från den senaste godkända posten.
 */
export const REVIEW_INTERVAL_DAYS = 92;

export function needsQuarterlyReview(
  transactions: Transaction[],
  lastReviewedAt: IsoDate | null,
  now: IsoDate = today(),
): { due: boolean; since: IsoDate | null } {
  const lastActivity = transactions
    .filter((t) => t.status === "approved")
    .map((t) => t.paymentDate)
    .sort(compareDates)
    .pop();
  const since = lastReviewedAt ?? lastActivity ?? null;
  if (!since) return { due: false, since: null };
  return { due: daysBetween(since, now) >= REVIEW_INTERVAL_DAYS, since };
}

/**
 * Posterna som väntar på en viss parts ställningstagande.
 *
 * Ren funktion, och det är hela poängen: svaret behövs på tre ställen -
 * notisen i navigationen, kortet på översikten och sidan Väntar - och de tre
 * måste räkna likadant. Ett märke som säger 1 medan sidan visar 0 är värre än
 * inget märke.
 *
 * Den som registrerade posten har godkänt den i samma steg, och den som redan
 * tagit ställning väntar inte på sig själv. Kvar blir det man faktiskt ska
 * göra något åt.
 */
export function awaitingMyDecision(
  transactions: Transaction[],
  revisions: ReadonlyMap<
    string,
    { authorId?: string; approvedBy?: Record<string, unknown> | null }[]
  >,
  myPartyId: string | null,
): { transaction: Transaction; registeredByPartyId: string }[] {
  if (!myPartyId) return [];

  return pendingTransactions(transactions).flatMap((transaction) => {
    const versions = revisions.get(transaction.id) ?? [];
    const latest = versions[versions.length - 1];
    const registeredByPartyId = latest?.authorId ?? "";
    const iHaveDecided = Boolean(latest?.approvedBy?.[myPartyId]);

    if (registeredByPartyId === myPartyId || iHaveDecided) return [];
    return [{ transaction, registeredByPartyId }];
  }) as { transaction: Transaction; registeredByPartyId: string }[];
}

/**
 * Kör motorn, men skilj vägran från krasch.
 *
 * Att avtalet förutsätter en modell den här installationen inte kör är inget
 * fel i koden - det är ett läge tjänsten ska kunna visa och förklara. Övriga
 * fel får fortsätta bubbla, för de betyder att något är trasigt.
 */
export function runOrRefuse(
  ...args: Parameters<typeof run>
): { ok: true; result: ReturnType<typeof run> } | { ok: false; error: ModelVersionError } {
  try {
    return { ok: true, result: run(...args) };
  } catch (fel) {
    if (fel instanceof ModelVersionError) return { ok: false, error: fel };
    throw fel;
  }
}
