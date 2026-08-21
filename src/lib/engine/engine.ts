import { compareDates, isOnOrBefore, type IsoDate } from "./dates";
import { daysBetween } from "./dates";
import { roundHalfAwayFromZero, splitExact, type Ore } from "./money";
import { outsideSplitFor, ruleFor } from "./rules";
import type {
  ByParty,
  DayEvent,
  EngineInput,
  EngineResult,
  ExcludedTransaction,
  OutsideEntry,
  PartyId,
  PartyPayment,
  Settlement,
  Transaction,
} from "./types";

/**
 * Motorversionen stämplas på varje sparad beräkning. En slutavräkning ska
 * kunna räknas om och ge exakt samma resultat, och då måste det framgå vilken
 * version som producerade det ursprungliga resultatet.
 */
export const ENGINE_VERSION = "1.0.0";

/**
 * Linjärt beräknat bostadsvärde på dag d (avtal 8.2):
 *
 *   Startvärde + (Slutvärde − Startvärde) × (dagar start→d / dagar start→slut)
 *
 * Endast start- och slutvärdet är fastställda värden. Mellanvärdena är en
 * avtalad fördelningskonvention och får aldrig presenteras som historiska
 * marknadsvärderingar (avtal 8.4).
 */
export function linearValue(
  startDate: IsoDate,
  startValue: Ore,
  endDate: IsoDate,
  endValue: Ore,
  date: IsoDate,
): Ore {
  const span = daysBetween(startDate, endDate);
  if (span <= 0) return endValue;
  const elapsed = daysBetween(startDate, date);
  const ratio = elapsed / span;
  return roundHalfAwayFromZero(startValue + (endValue - startValue) * ratio);
}

/** Nettobetalning: faktisk betalning minus varje förmån som tillfallit parten (avtal 7.5). */
export function netPayment(payment: PartyPayment | undefined): Ore {
  if (!payment) return 0;
  return (
    payment.gross -
    (payment.discount ?? 0) -
    (payment.refund ?? 0) -
    (payment.insurance ?? 0) -
    (payment.taxEffect ?? 0)
  );
}

function normalizeKey(key: ByParty<number>, parties: [PartyId, PartyId]): ByParty<number> {
  const total = (key[parties[0]] ?? 0) + (key[parties[1]] ?? 0);
  if (total <= 0) return { [parties[0]]: 0.5, [parties[1]]: 0.5 };
  return {
    [parties[0]]: (key[parties[0]] ?? 0) / total,
    [parties[1]]: (key[parties[1]] ?? 0) / total,
  };
}

/**
 * Kör hela avräkningen. Motorn är ren: samma indata ger alltid exakt samma
 * resultat, och den räknar alltid om från startdagen. En rättelse behöver
 * därför bara ändra indata – omräkningen enligt avtal 10.5 blir automatisk.
 */
export function calculate(input: EngineInput): EngineResult {
  const { agreement, endpoint, categoryRules, transactions } = input;
  const parties = agreement.parties;
  const [a, b] = parties;
  const warnings: string[] = [];
  const excluded: ExcludedTransaction[] = [];

  if (agreement.totalUnits <= 0) {
    throw new Error("Totalt antal andelsenheter måste vara större än noll.");
  }
  if (compareDates(endpoint.endDate, agreement.startDate) < 0) {
    throw new Error("Slutdagen kan inte ligga före startdagen.");
  }

  // 1. Godkända poster raderas aldrig (avtal 14.3). De kan bara ersättas av en
  //    korrigeringspost med nya värden, eller tas ur beräkningen av en
  //    makuleringspost. Båda kräver att parterna godkänner den nya posten, och
  //    ursprungsposten ligger kvar synlig med sin länk.
  const supersededIds = new Set(
    transactions
      .filter((t) => t.status === "approved" && t.correctsId)
      .map((t) => t.correctsId as string),
  );
  const voidedIds = new Set(
    transactions
      .filter((t) => t.status === "approved" && t.voidsId)
      .map((t) => t.voidsId as string),
  );

  const usable: Transaction[] = [];
  for (const tx of transactions) {
    if (tx.status !== "approved") {
      excluded.push({ transactionId: tx.id, reason: statusReason(tx.status) });
      continue;
    }
    if (tx.voidsId) {
      // Makuleringsposten bär ingen egen ekonomi och ska därför inte skapa
      // någon dagsberäkning. Dess enda verkan är att ta bort sitt mål.
      excluded.push({ transactionId: tx.id, reason: "Makuleringspost utan egen ekonomisk effekt" });
      continue;
    }
    if (voidedIds.has(tx.id)) {
      excluded.push({ transactionId: tx.id, reason: "Makulerad" });
      continue;
    }
    if (supersededIds.has(tx.id)) {
      excluded.push({ transactionId: tx.id, reason: "Ersatt av korrigeringspost" });
      continue;
    }
    if (compareDates(tx.paymentDate, agreement.startDate) < 0) {
      excluded.push({ transactionId: tx.id, reason: "Betalningsdag före startdagen" });
      warnings.push(`${tx.id}: betalningsdagen ligger före startdagen.`);
      continue;
    }
    if (compareDates(tx.paymentDate, endpoint.endDate) > 0) {
      excluded.push({ transactionId: tx.id, reason: "Betalningsdag efter slutdagen" });
      warnings.push(`${tx.id}: betalningsdagen ligger efter slutdagen.`);
      continue;
    }
    usable.push(tx);
  }

  // 2. Dela upp i enhetsmodellen och kostnader utanför den. Ett kostnadsslag
  //    utan godkänd klassificering ligger alltid utanför modellen (avtal 7.3).
  const inModel: Transaction[] = [];
  const outsideEntries: OutsideEntry[] = [];
  const outsideBalance: ByParty<Ore> = { [a]: 0, [b]: 0 };

  for (const tx of usable) {
    const rule = ruleFor(categoryRules, tx.category, tx.paymentDate);
    if (rule?.included) {
      inModel.push(tx);
      continue;
    }
    if (!rule) {
      warnings.push(
        `${tx.id}: kostnadsslaget "${tx.category}" saknar godkänd klassificering och ligger utanför enhetsmodellen.`,
      );
    }
    const split = outsideSplitFor(rule, parties);
    const nets: ByParty<Ore> = { [a]: netPayment(tx.payments[a]), [b]: netPayment(tx.payments[b]) };
    const netCostTotal = nets[a] + nets[b];
    const [owedA, owedB] = splitExact(netCostTotal, split[a]);
    const owed: ByParty<Ore> = { [a]: owedA, [b]: owedB };
    const difference: ByParty<Ore> = { [a]: nets[a] - owedA, [b]: nets[b] - owedB };
    outsideBalance[a] += difference[a];
    outsideBalance[b] += difference[b];
    outsideEntries.push({
      transactionId: tx.id,
      date: tx.paymentDate,
      category: tx.category,
      netCostTotal,
      split,
      owed,
      netPayments: nets,
      difference,
    });
  }

  // 3. Kronologisk behandling. Alla poster med samma betalningsdag nettas och
  //    behandlas som en samlad post, så att registreringsordningen aldrig kan
  //    påverka utfallet (avtal 8.3 och 10.3).
  const byDate = new Map<IsoDate, Transaction[]>();
  for (const tx of inModel) {
    const list = byDate.get(tx.paymentDate) ?? [];
    list.push(tx);
    byDate.set(tx.paymentDate, list);
  }
  const dates = [...byDate.keys()].sort(compareDates);

  const units: ByParty<number> = {
    [a]: agreement.startUnits[a] ?? 0,
    [b]: agreement.startUnits[b] ?? 0,
  };
  const claims: ByParty<Ore> = { [a]: 0, [b]: 0 };
  const events: DayEvent[] = [];
  let preliminaryTaxCount = 0;

  for (const date of dates) {
    const dayTx = byDate.get(date) ?? [];
    const notes: string[] = [];

    // Kostnadsnyckeln är parternas interna andelar omedelbart före dagen
    // (avtal 7.4), om ingen särskild nyckel avtalats för posten.
    const sharesBefore: ByParty<number> = {
      [a]: units[a] / agreement.totalUnits,
      [b]: units[b] / agreement.totalUnits,
    };

    let netCostTotal = 0;
    const netPayments: ByParty<Ore> = { [a]: 0, [b]: 0 };
    const owedTotal: ByParty<Ore> = { [a]: 0, [b]: 0 };
    const difference: ByParty<Ore> = { [a]: 0, [b]: 0 };
    let hasPreliminaryTax = false;
    let keyUsed: ByParty<number> = sharesBefore;

    for (const tx of dayTx) {
      const nets: ByParty<Ore> = {
        [a]: netPayment(tx.payments[a]),
        [b]: netPayment(tx.payments[b]),
      };
      const total = nets[a] + nets[b];
      const key = tx.specialKey ? normalizeKey(tx.specialKey, parties) : sharesBefore;
      if (tx.specialKey) {
        keyUsed = key;
        notes.push(`${tx.id}: särskild kostnadsnyckel enligt överenskommelse.`);
      }
      const [owedA, owedB] = splitExact(total, key[a]);
      netCostTotal += total;
      netPayments[a] += nets[a];
      netPayments[b] += nets[b];
      owedTotal[a] += owedA;
      owedTotal[b] += owedB;
      difference[a] += nets[a] - owedA;
      difference[b] += nets[b] - owedB;
      if (tx.payments[a]?.taxPreliminary || tx.payments[b]?.taxPreliminary) {
        hasPreliminaryTax = true;
        preliminaryTaxCount += 1;
      }
    }

    const value = linearValue(
      agreement.startDate,
      agreement.startValue,
      endpoint.endDate,
      endpoint.endValue,
      date,
    );
    const loanBalance = loanBalanceOn(input, date, inModel, categoryRules);
    const netEquity = value - loanBalance;
    const unitValue = netEquity > 0 ? netEquity / agreement.totalUnits : null;

    const overpayer: PartyId | null = difference[a] > 0 ? a : difference[b] > 0 ? b : null;
    const underpayer: PartyId | null = overpayer === a ? b : overpayer === b ? a : null;
    const overpayment = overpayer ? difference[overpayer] : 0;

    let requestedUnits = 0;
    let transferredUnits = 0;
    let convertedAmount: Ore = 0;
    let personalClaim: DayEvent["personalClaim"] = null;

    if (overpayer && underpayer && overpayment > 0) {
      if (unitValue === null) {
        // Nettokapitalet är noll eller negativt: ingen enhetsöverföring sker
        // och hela överbetalningen ligger kvar som personlig fordran (avtal 9.4).
        personalClaim = { party: overpayer, amount: overpayment };
        claims[overpayer] += overpayment;
        notes.push(
          "Nettokapitalet är inte positivt. Ingen enhetsöverföring; överbetalningen blir personlig fordran.",
        );
      } else {
        requestedUnits = overpayment / unitValue;
        const available = units[underpayer];
        transferredUnits = Math.min(requestedUnits, available);
        if (transferredUnits < requestedUnits) {
          notes.push(
            "Den underbetalande parten saknar tillräckligt många enheter. Överskjutande belopp blir personlig fordran.",
          );
        }
        // När hela den begärda överföringen ryms motsvarar den exakt
        // överbetalningen; annars räknas det omvandlade beloppet fram ur de
        // enheter som faktiskt kunde överföras.
        convertedAmount =
          transferredUnits === requestedUnits
            ? overpayment
            : roundHalfAwayFromZero(transferredUnits * unitValue);
        units[overpayer] += transferredUnits;
        units[underpayer] -= transferredUnits;
        const remainder = overpayment - convertedAmount;
        if (remainder > 0) {
          // Samma belopp får aldrig bli både enheter och fordran (avtal 10.2).
          personalClaim = { party: overpayer, amount: remainder };
          claims[overpayer] += remainder;
        }
      }
    }

    events.push({
      date,
      transactionIds: dayTx.map((t) => t.id),
      linearValue: value,
      loanBalance,
      netEquity,
      unitValue,
      keyBefore: keyUsed,
      netCostTotal,
      netPayments,
      owed: owedTotal,
      difference,
      overpayer,
      overpayment,
      requestedUnits,
      transferredUnits,
      convertedAmount,
      personalClaim,
      unitsAfter: { [a]: units[a], [b]: units[b] },
      sharesAfter: {
        [a]: units[a] / agreement.totalUnits,
        [b]: units[b] / agreement.totalUnits,
      },
      hasPreliminaryTax,
      notes,
    });
  }

  const finalUnits: ByParty<number> = { [a]: units[a], [b]: units[b] };
  const finalShares: ByParty<number> = {
    [a]: units[a] / agreement.totalUnits,
    [b]: units[b] / agreement.totalUnits,
  };

  const settlement = settle({
    parties,
    endpoint,
    finalShares,
    claims,
    outsideBalance,
    finalUnits,
    totalUnits: agreement.totalUnits,
  });

  return {
    engineVersion: ENGINE_VERSION,
    mode: endpoint.mode,
    events,
    outside: { entries: outsideEntries, balance: outsideBalance },
    finalUnits,
    finalShares,
    claims,
    settlement,
    excluded,
    warnings,
    preliminaryTaxCount,
  };
}

function statusReason(status: Transaction["status"]): string {
  switch (status) {
    case "withdrawn":
      return "Återkallad av registratorn";
    case "disputed":
      return "Tvistig – ligger utanför beräkningen tills den löses";
    case "draft":
      return "Utkast";
    default:
      return "Inte godkänd av båda parter";
  }
}

/**
 * Lånesaldot som ska användas på en viss dag. Saldot härleds ur startlånet och
 * godkända amorteringar. Uttryckliga avstämningar och verifierade saldon som
 * angetts på en post gäller före härledningen och bär framåt.
 *
 * På en dag med amortering används saldot **efter** dagens samtliga
 * amorteringar (avtal 9.2), eftersom amorteringen i sig ökar nettokapitalet.
 */
function loanBalanceOn(
  input: EngineInput,
  date: IsoDate,
  inModel: Transaction[],
  categoryRules: EngineInput["categoryRules"],
): Ore {
  // En avstämning avser saldot vid dagens slut, så amorteringar samma dag är
  // redan inräknade i den. Poster som anger verifierat saldo efter dagens
  // amorteringar behandlas som avstämningar de också.
  const stated = new Map<IsoDate, Ore>();
  const record = (day: IsoDate, balance: Ore) => {
    const current = stated.get(day);
    stated.set(day, current == null ? balance : Math.min(current, balance));
  };
  for (const snapshot of input.loanSnapshots ?? []) record(snapshot.date, snapshot.balance);
  for (const tx of inModel) {
    if (tx.loanBalanceAfter != null) record(tx.paymentDate, tx.loanBalanceAfter);
  }

  let base = input.agreement.initialLoan;
  let baseDate = input.agreement.startDate;
  let baseIsStated = false;
  for (const [day, balance] of [...stated.entries()].sort((x, y) => compareDates(x[0], y[0]))) {
    if (isOnOrBefore(day, date)) {
      base = balance;
      baseDate = day;
      baseIsStated = true;
    }
  }

  const parties = input.agreement.parties;
  const amortized = inModel
    .filter((t) => isOnOrBefore(t.paymentDate, date))
    .filter((t) => !baseIsStated || compareDates(t.paymentDate, baseDate) > 0)
    .filter((t) => ruleFor(categoryRules, t.category, t.paymentDate)?.reducesLoan)
    .reduce(
      (sum, t) => sum + (t.payments[parties[0]]?.gross ?? 0) + (t.payments[parties[1]]?.gross ?? 0),
      0,
    );

  return base - amortized;
}

/**
 * Slutberäkningen (avtal 15). Försäljningsnettot fördelas enligt de slutliga
 * interna andelarna – samma andelar används även när resultatet är negativt
 * (15.3). Därefter nettas personliga fordringar och saldot för kostnader
 * utanför enhetsmodellen.
 */
function settle(args: {
  parties: [PartyId, PartyId];
  endpoint: EngineInput["endpoint"];
  finalShares: ByParty<number>;
  claims: ByParty<Ore>;
  outsideBalance: ByParty<Ore>;
  finalUnits: ByParty<number>;
  totalUnits: number;
}): Settlement {
  const [a, b] = args.parties;
  const saleNet = args.endpoint.endValue - args.endpoint.endLoan - (args.endpoint.saleCosts ?? 0);

  const [shareA, shareB] = splitExact(saleNet, args.finalShares[a]);
  const byShare: ByParty<Ore> = { [a]: shareA, [b]: shareB };

  // Fordringar och utanförsaldon nettas mellan parterna: den ena partens
  // tillgodohavande är exakt den andras skuld.
  const claimDelta = args.claims[a] - args.claims[b];
  const claimsNet: ByParty<Ore> = { [a]: claimDelta, [b]: -claimDelta };
  const outsideDelta = args.outsideBalance[a] - args.outsideBalance[b];
  const outsideNet: ByParty<Ore> = { [a]: outsideDelta, [b]: -outsideDelta };

  const finalPosition: ByParty<Ore> = {
    [a]: byShare[a] + claimsNet[a] + outsideNet[a],
    [b]: byShare[b] + claimsNet[b] + outsideNet[b],
  };

  const unitsBalance = args.finalUnits[a] + args.finalUnits[b] - args.totalUnits;
  const sharesBalance = args.finalShares[a] + args.finalShares[b] - 1;
  const positionsBalance = finalPosition[a] + finalPosition[b] - saleNet;

  return {
    saleNet,
    byShare,
    claimsNet,
    outsideNet,
    finalPosition,
    checks: {
      unitsBalance,
      sharesBalance,
      positionsBalance,
      ok: Math.abs(unitsBalance) < 1e-6 && Math.abs(sharesBalance) < 1e-9 && positionsBalance === 0,
    },
  };
}
