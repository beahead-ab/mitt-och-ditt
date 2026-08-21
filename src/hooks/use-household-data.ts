import { useMemo } from "react";

import { DEMO_AGREEMENT, DEMO_TRANSACTIONS, isDemo } from "@/lib/demo";
import {
  defaultCategoryRules,
  type AgreementParams,
  type CostCategoryRule,
  type Transaction,
} from "@/lib/engine";
import { SEED_AGREEMENT } from "@/lib/seed";

export type HouseholdData = {
  agreement: AgreementParams;
  rules: CostCategoryRule[];
  transactions: Transaction[];
};

/**
 * Hushållets beräkningsunderlag. I demoläge kommer det från fixturer; från
 * etapp 2 hämtas det via serverfunktioner med radnivåsäkerhet. Referenserna är
 * stabila mellan renderingar så att beräkningen inte körs om i onödan.
 */
export function useHouseholdData(): HouseholdData {
  return useMemo(() => {
    const agreement = isDemo ? DEMO_AGREEMENT : SEED_AGREEMENT;
    return {
      agreement,
      // Grundklassificeringen gäller från avtalets egen startdag. Härleds den
      // från ett annat avtal hamnar varje post utanför enhetsmodellen.
      rules: defaultCategoryRules(agreement.startDate),
      transactions: isDemo ? DEMO_TRANSACTIONS : [],
    };
  }, []);
}
