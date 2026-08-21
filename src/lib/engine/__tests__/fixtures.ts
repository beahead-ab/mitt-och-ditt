import { kr } from "../money";
import { defaultCategoryRules } from "../rules";
import type {
  AgreementParams,
  CostCategoryRule,
  EngineInput,
  Endpoint,
  Transaction,
} from "../types";

export const CAESAR = "caesar";
export const FELICIA = "felicia";

export const START_DATE = "2026-08-17";
/** 4 495 000 − 3 115 000 = 1 380 000 kr eget kapital på startdagen, alltså exakt 1,00 kr per enhet. */
export const AGREEMENT: AgreementParams = {
  startDate: START_DATE,
  startValue: kr(4_495_000),
  initialLoan: kr(3_115_000),
  parties: [CAESAR, FELICIA],
  startUnits: { [CAESAR]: 1_200_000, [FELICIA]: 180_000 },
  totalUnits: 1_380_000,
};

export const RULES: CostCategoryRule[] = defaultCategoryRules(START_DATE);

/** Platt prognos: slutvärde = startvärde, alltså 1,00 kr per enhet hela vägen. */
export function flatEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    mode: "prognos",
    endDate: "2031-08-17",
    endValue: kr(4_495_000),
    endLoan: kr(3_115_000),
    saleCosts: 0,
    ...overrides,
  };
}

export function tx(overrides: Partial<Transaction> & Pick<Transaction, "id">): Transaction {
  return {
    paymentDate: START_DATE,
    category: "Vitvara/fast utrustning",
    payments: {},
    status: "approved",
    ...overrides,
  };
}

export function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    agreement: AGREEMENT,
    endpoint: flatEndpoint(),
    categoryRules: RULES,
    transactions: [],
    ...overrides,
  };
}
