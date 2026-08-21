import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useHousehold } from "@/components/household-context";
import { DEMO_AGREEMENT, DEMO_REVISIONS, DEMO_TRANSACTIONS, isDemo } from "@/lib/demo";
import {
  defaultCategoryRules,
  type AgreementParams,
  type CostCategoryRule,
  type LoanBalanceSnapshot,
  type Transaction,
} from "@/lib/engine";
import { getHousehold } from "@/lib/household.functions";
import type { RecordVersion } from "@/lib/revisions";

export type HouseholdData = {
  agreement: AgreementParams | null;
  rules: CostCategoryRule[];
  transactions: Transaction[];
  /** Versionshistorik per post. Cellernas historik härleds ur den. */
  revisions: Map<string, RecordVersion<Transaction>[]>;
  loanSnapshots: LoanBalanceSnapshot[];
  isLoading: boolean;
};

const EMPTY: HouseholdData = {
  agreement: null,
  rules: [],
  transactions: [],
  revisions: new Map(),
  loanSnapshots: [],
  isLoading: false,
};

/**
 * Hushållets beräkningsunderlag. I demoläge kommer det från fixturer, annars
 * från databasen genom radnivåsäkerheten.
 */
export function useHouseholdData(): HouseholdData {
  const { household } = useHousehold();
  const householdId = household?.id ?? null;

  const query = useQuery({
    queryKey: ["household", householdId],
    queryFn: () => getHousehold({ data: { householdId: householdId as string } }),
    enabled: !isDemo && Boolean(householdId),
    staleTime: 30_000,
  });

  return useMemo(() => {
    if (isDemo) {
      const agreement = DEMO_AGREEMENT;
      return {
        agreement,
        // Grundklassificeringen gäller från avtalets egen startdag. Härleds den
        // från ett annat avtal hamnar varje post utanför enhetsmodellen.
        rules: defaultCategoryRules(agreement.startDate),
        transactions: DEMO_TRANSACTIONS,
        revisions: DEMO_REVISIONS,
        loanSnapshots: [],
        isLoading: false,
      };
    }
    if (!query.data) return { ...EMPTY, isLoading: query.isLoading };
    return {
      agreement: query.data.agreement,
      rules: query.data.rules,
      transactions: query.data.transactions,
      revisions: new Map(query.data.revisions),
      loanSnapshots: query.data.loanSnapshots,
      isLoading: false,
    };
  }, [query.data, query.isLoading]);
}
