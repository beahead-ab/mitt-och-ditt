import { addDays, addMonths, type IsoDate } from "./dates";
import { roundHalfAwayFromZero, type Ore } from "./money";

/**
 * Fristerna i separationsprocessen. Värdena är avtalsparametrar och därför
 * konfigurerbara per hushåll, men ändring av tremånadersregeln kräver
 * undertecknat tilläggsavtal (avtal 25.1).
 */
export type ExitPolicy = {
  /** Besked om övertagande ska lämnas inom så här många dagar (avtal 17.1). */
  takeoverNoticeDays: number;
  /** Utköp klart eller bostaden utlagd till försäljning inom så här många månader (avtal 17.2). */
  saleDeadlineMonths: number;
  /**
   * Högsta tillåtna spridning mellan två värderingar, mätt som skillnaden
   * delad med deras genomsnitt (avtal 18.2).
   */
  valuationSpreadThreshold: number;
};

export const DEFAULT_EXIT_POLICY: ExitPolicy = {
  takeoverNoticeDays: 14,
  saleDeadlineMonths: 3,
  valuationSpreadThreshold: 0.1,
};

export type ExitDeadlines = {
  processDate: IsoDate;
  takeoverNoticeBy: IsoDate;
  saleOrBuyoutBy: IsoDate;
};

/** Tidslinjen som följer av den avtalsmässiga processdagen (avtal 16–17). */
export function exitDeadlines(
  processDate: IsoDate,
  policy: ExitPolicy = DEFAULT_EXIT_POLICY,
): ExitDeadlines {
  return {
    processDate,
    takeoverNoticeBy: addDays(processDate, policy.takeoverNoticeDays),
    saleOrBuyoutBy: addMonths(processDate, policy.saleDeadlineMonths),
  };
}

export type ValuationOutcome = {
  /** Fastställt marknadsvärde, eller null när en tredje värdering krävs. */
  value: Ore | null;
  method: "genomsnitt" | "median" | "tredje-vardering-kravs";
  spread: number;
  explanation: string;
};

/**
 * Fastställer slutvärdet utan extern försäljning (avtal 18.2–18.3): två
 * oberoende värderingar vars spridning är högst tröskelvärdet ger
 * genomsnittet, annars avgör det mittersta av tre värden.
 */
export function determineValuation(
  valuations: Ore[],
  policy: ExitPolicy = DEFAULT_EXIT_POLICY,
): ValuationOutcome {
  if (valuations.length < 2) {
    throw new Error("Minst två oberoende värderingar krävs.");
  }
  if (valuations.length === 2) {
    const [first, second] = valuations;
    const average = (first + second) / 2;
    const spread = average === 0 ? 0 : Math.abs(first - second) / average;
    if (spread <= policy.valuationSpreadThreshold) {
      return {
        value: roundHalfAwayFromZero(average),
        method: "genomsnitt",
        spread,
        explanation: `Skillnaden är ${(spread * 100).toFixed(1)} % av genomsnittet, vilket är högst ${(policy.valuationSpreadThreshold * 100).toFixed(0)} %. Genomsnittet gäller.`,
      };
    }
    return {
      value: null,
      method: "tredje-vardering-kravs",
      spread,
      explanation: `Skillnaden är ${(spread * 100).toFixed(1)} % av genomsnittet, vilket överstiger ${(policy.valuationSpreadThreshold * 100).toFixed(0)} %. En tredje oberoende värdering krävs.`,
    };
  }

  const sorted = [...valuations].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)];
  const average = valuations.reduce((sum, v) => sum + v, 0) / valuations.length;
  const spread = average === 0 ? 0 : (sorted[sorted.length - 1] - sorted[0]) / average;
  return {
    value: median,
    method: "median",
    spread,
    explanation: "Tre värderingar finns. Det mittersta värdet gäller.",
  };
}

/** Checklistan som måste vara avbockad innan ett utköp får markeras genomfört (avtal 19.3). */
export const BUYOUT_CHECKLIST = [
  { key: "overlatelsehandling", label: "Överlåtelsehandlingen är undertecknad" },
  { key: "ersattning", label: "Ersättningen är betald eller säkrad" },
  { key: "foreningshandlingar", label: "Nödvändiga föreningshandlingar är klara" },
  {
    key: "ansvarsbefrielse",
    label: "Den utköpta parten är befriad från bank-, borgens- och pantåtaganden",
  },
  { key: "slutavrakning", label: "Slutavräkningen är godkänd av båda parter" },
] as const;

/**
 * Fastställer slutvärdet ur värderingarna (avtal 18).
 *
 * Ren logik, och därför här och inte i servermodulen: gränssnittet behöver
 * samma svar - bland annat för att kunna visa ett exempel i demoläget - och
 * ett `.server`-modulanrop går inte att göra från klienten.
 */
export function valuationOutcome(valuations: { amount: Ore }[]) {
  if (valuations.length < 2) return null;
  return determineValuation(valuations.map((v) => v.amount));
}
