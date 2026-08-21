import { compareDates, isOnOrBefore, type IsoDate } from "./dates";
import type { ByParty, CostCategoryRule, PartyId } from "./types";

/**
 * Klassificeringen som gäller för ett kostnadsslag på en viss betalningsdag
 * (avtal 25.2): den godkända klassificering som har senaste giltighetsdag som
 * inte ligger efter betalningsdagen. Saknas sådan ligger kostnadsslaget
 * utanför enhetsmodellen tills båda parter klassificerat det (avtal 7.3).
 */
export function ruleFor(
  rules: CostCategoryRule[],
  category: string,
  paymentDate: IsoDate,
): CostCategoryRule | null {
  const candidates = rules
    .filter((r) => r.approved)
    .filter((r) => r.category === category)
    .filter((r) => isOnOrBefore(r.effectiveFrom, paymentDate))
    .sort((a, b) => compareDates(a.effectiveFrom, b.effectiveFrom));
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

/** Lika delar mellan parterna – standard för kostnader utanför modellen. */
export function equalSplit(parties: [PartyId, PartyId]): ByParty<number> {
  return { [parties[0]]: 0.5, [parties[1]]: 0.5 };
}

/**
 * Fördelningen för ett kostnadsslag utanför enhetsmodellen. Utan uttrycklig
 * överenskommelse gäller hälften vardera (avtal 7.2).
 */
export function outsideSplitFor(
  rule: CostCategoryRule | null,
  parties: [PartyId, PartyId],
): ByParty<number> {
  const split = rule?.outsideSplit;
  if (!split) return equalSplit(parties);
  const total = parties.reduce((sum, p) => sum + (split[p] ?? 0), 0);
  if (total <= 0) return equalSplit(parties);
  // Normaliseras så att fördelningen alltid summerar till exakt 1.
  return {
    [parties[0]]: (split[parties[0]] ?? 0) / total,
    [parties[1]]: (split[parties[1]] ?? 0) / total,
  };
}

/**
 * Grundklassificeringen enligt avtalets punkt 7.1–7.2. Seedas som utgångsläge
 * med startdagen som giltighetsdag och kan därefter ändras av parterna
 * gemensamt via nya, daterade klassificeringar.
 */
export const INCLUDED_CATEGORIES = [
  "Direkt förvärvskostnad",
  "Amortering",
  "Ränta",
  "Finansieringskostnad",
  "Reparation",
  "Underhåll",
  "Förbättring",
  "Vitvara/fast utrustning",
] as const;

export const EXCLUDED_CATEGORIES = [
  "BRF-avgift",
  "Försäkring",
  "Personlig konsumtion",
  "Personliga tillhörigheter",
  "Lös möbel",
  "Mat",
  "Hushållsel och bredband",
  "Förseningsavgift",
  "Skada orsakad av en part",
  "Egen arbetstid",
] as const;

/** Kostnadsslag som minskar den externa låneskulden. */
export const LOAN_REDUCING_CATEGORIES = ["Amortering"] as const;

/** Bygger grunduppsättningen klassificeringar med startdagen som giltighetsdag. */
export function defaultCategoryRules(startDate: IsoDate): CostCategoryRule[] {
  const included = INCLUDED_CATEGORIES.map((category) => ({
    category,
    effectiveFrom: startDate,
    included: true,
    reducesLoan: (LOAN_REDUCING_CATEGORIES as readonly string[]).includes(category),
    approved: true,
  }));
  const excluded = EXCLUDED_CATEGORIES.map((category) => ({
    category,
    effectiveFrom: startDate,
    included: false,
    approved: true,
  }));
  return [...included, ...excluded];
}
