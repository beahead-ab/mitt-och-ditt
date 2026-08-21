import {
  defaultCategoryRules,
  kr,
  type AgreementParams,
  type CostCategoryRule,
} from "@/lib/engine";

/**
 * Startuppgifterna för den första installationen. Alla värden är redigerbara
 * utkastvärden i överenskommelsen – de blir bindande först när båda parter
 * godkänt avtalsversionen. Beloppen kommer från avtalets punkt 2.
 */
export const CAESAR = "caesar";
export const FELICIA = "felicia";

export const PARTY_LABELS: Record<string, string> = {
  [CAESAR]: "Caesar",
  [FELICIA]: "Felicia",
};

export const SEED_AGREEMENT: AgreementParams = {
  startDate: "2026-08-17",
  startValue: kr(4_495_000),
  initialLoan: kr(3_115_000),
  parties: [CAESAR, FELICIA],
  startUnits: { [CAESAR]: 1_200_000, [FELICIA]: 180_000 },
  totalUnits: 1_380_000,
};

export const SEED_CATEGORY_RULES: CostCategoryRule[] = defaultCategoryRules(
  SEED_AGREEMENT.startDate,
);

/**
 * Formella ägarandelar fylls i separat och sätts aldrig automatiskt lika med
 * de interna ekonomiska andelarna (avtal 5).
 */
export const SEED_FORMAL_OWNERSHIP: Record<string, number | null> = {
  [CAESAR]: null,
  [FELICIA]: null,
};
