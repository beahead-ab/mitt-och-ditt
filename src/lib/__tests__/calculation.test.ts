import { describe, expect, it } from "vitest";

import { missingReceipts, needsQuarterlyReview, RECEIPT_THRESHOLD } from "@/lib/calculation";
import { kr, type AgreementParams, type Transaction } from "@/lib/engine";

const AGREEMENT = {
  startDate: "2026-08-17",
  startValue: kr(4_495_000),
  initialLoan: kr(3_115_000),
  parties: ["caesar", "felicia"],
  startUnits: { caesar: 1_200_000, felicia: 180_000 },
  totalUnits: 1_380_000,
} as AgreementParams;

const tx = (overrides: Partial<Transaction> & Pick<Transaction, "id">): Transaction => ({
  paymentDate: "2026-09-01",
  category: "Reparation",
  payments: { caesar: { gross: kr(5_000) } },
  status: "approved",
  ...overrides,
});

describe("Saknade underlag", () => {
  it("flaggar godkända poster över gränsen utan bilaga", () => {
    const missing = missingReceipts(AGREEMENT, [tx({ id: "T-1" })], new Set());
    expect(missing.map((t) => t.id)).toEqual(["T-1"]);
  });

  it("slutar flagga när posten har en bilaga", () => {
    const missing = missingReceipts(AGREEMENT, [tx({ id: "T-1" })], new Set(["T-1"]));
    expect(missing).toHaveLength(0);
  });

  it("en beskrivning är inget underlag", () => {
    const missing = missingReceipts(
      AGREEMENT,
      [tx({ id: "T-1", description: "Utförlig beskrivning av vad som gjordes" })],
      new Set(),
    );
    expect(missing.map((t) => t.id)).toEqual(["T-1"]);
  });

  it("små poster kräver inget underlag", () => {
    const small = tx({ id: "T-1", payments: { caesar: { gross: RECEIPT_THRESHOLD - 1 } } });
    expect(missingReceipts(AGREEMENT, [small], new Set())).toHaveLength(0);
  });

  it("poster som inte är godkända räknas inte", () => {
    const pending = tx({ id: "T-1", status: "pending" });
    expect(missingReceipts(AGREEMENT, [pending], new Set())).toHaveLength(0);
  });

  it("en makuleringspost behöver inget underlag", () => {
    const makulering = tx({ id: "M-1", voidsId: "T-1", payments: {} });
    expect(missingReceipts(AGREEMENT, [makulering], new Set())).toHaveLength(0);
  });

  it("räknar båda parters betalningar mot gränsen", () => {
    const shared = tx({
      id: "T-1",
      payments: { caesar: { gross: kr(600) }, felicia: { gross: kr(600) } },
    });
    expect(missingReceipts(AGREEMENT, [shared], new Set()).map((t) => t.id)).toEqual(["T-1"]);
  });
});

describe("Kvartalsavstämning", () => {
  const posts = [tx({ id: "T-1", paymentDate: "2026-09-01" })];

  it("påminner när det gått ett kvartal sedan senaste posten", () => {
    expect(needsQuarterlyReview(posts, null, "2026-12-05").due).toBe(true);
  });

  it("påminner inte innan dess", () => {
    expect(needsQuarterlyReview(posts, null, "2026-10-01").due).toBe(false);
  });

  it("räknar från senaste avstämningen när en sådan finns", () => {
    const review = needsQuarterlyReview(posts, "2026-11-20", "2026-12-05");
    expect(review.due).toBe(false);
    expect(review.since).toBe("2026-11-20");
  });

  it("påminner inte när ingenting registrerats än", () => {
    expect(needsQuarterlyReview([], null, "2026-12-05")).toEqual({ due: false, since: null });
  });
});
