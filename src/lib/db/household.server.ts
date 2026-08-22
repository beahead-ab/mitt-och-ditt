import type postgres from "postgres";

import { asUser } from "./client.server";
import type {
  AgreementParams,
  CostCategoryRule,
  LoanBalanceSnapshot,
  PartyPayment,
  Transaction,
  TransactionStatus,
} from "@/lib/engine";
import type { RecordVersion } from "@/lib/revisions";

export type HouseholdSummary = {
  id: string;
  name: string;
  propertyAddress: string | null;
  propertyAssociation: string | null;
  apartmentNumber: string | null;
  parties: { partyId: string; userId: string; name: string }[];
};

export type HouseholdData = {
  household: HouseholdSummary;
  agreement: AgreementParams;
  rules: CostCategoryRule[];
  transactions: Transaction[];
  revisions: Map<string, RecordVersion<Transaction>[]>;
  loanSnapshots: LoanBalanceSnapshot[];
};

/** Hushållen den inloggade är medlem i. Radnivåsäkerheten gör urvalet. */
export async function myHouseholds(userId: string): Promise<HouseholdSummary[]> {
  return asUser(userId, async (sql) => {
    const rows = await sql<
      {
        id: string;
        name: string;
        address: string | null;
        association: string | null;
        apartment_number: string | null;
      }[]
    >`
      select h.id, h.name, p.address, p.association, p.apartment_number
      from households h
      left join properties p on p.household_id = h.id
      order by h.created_at
    `;
    const members = await sql<
      { household_id: string; party_id: string; user_id: string; display_name: string }[]
    >`select household_id, party_id, user_id, display_name from household_members`;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      propertyAddress: row.address,
      propertyAssociation: row.association,
      apartmentNumber: row.apartment_number,
      parties: members
        .filter((m) => m.household_id === row.id)
        .map((m) => ({ partyId: m.party_id, userId: m.user_id, name: m.display_name })),
    }));
  });
}

type VersionRow = {
  version_id: string;
  transaction_id: string;
  reference: string;
  version: number;
  status: TransactionStatus;
  payment_date: string;
  category: string;
  description: string | null;
  payments: Record<string, PartyPayment>;
  special_key: Record<string, number> | null;
  loan_balance_after_ore: string | null;
  corrects_reference: string | null;
  voids_reference: string | null;
  reason: string | null;
  created_by: string;
  created_at: Date;
  effective_at: Date | null;
};

/**
 * Läser hela underlaget för ett hushåll och formar om det till motorns typer.
 * Transaktionerna byggs ur sina versioner: den senast gällande versionen är
 * postens nuvarande värden, och alla versioner behålls för cellhistoriken.
 */
export async function loadHousehold(
  userId: string,
  householdId: string,
): Promise<HouseholdData | null> {
  return asUser(userId, async (sql) => {
    const summary = await readSummary(sql, householdId);
    if (!summary) return null;

    const agreement = await readAgreement(sql, householdId, summary);
    if (!agreement) return null;

    const rules = await readRules(sql, householdId);
    const { transactions, revisions } = await readTransactions(sql, householdId, summary);
    const loanSnapshots = await readSnapshots(sql, householdId);

    return { household: summary, agreement, rules, transactions, revisions, loanSnapshots };
  });
}

async function readSummary(
  sql: postgres.Sql,
  householdId: string,
): Promise<HouseholdSummary | null> {
  const rows = await sql<
    {
      id: string;
      name: string;
      address: string | null;
      association: string | null;
      apartment_number: string | null;
    }[]
  >`
    select h.id, h.name, p.address, p.association, p.apartment_number
    from households h
    left join properties p on p.household_id = h.id
    where h.id = ${householdId}
  `;
  if (rows.length === 0) return null;

  const members = await sql<{ party_id: string; user_id: string; display_name: string }[]>`
    select party_id, user_id, display_name from household_members
    where household_id = ${householdId} order by joined_at
  `;
  return {
    id: rows[0].id,
    name: rows[0].name,
    propertyAddress: rows[0].address,
    propertyAssociation: rows[0].association,
    apartmentNumber: rows[0].apartment_number,
    parties: members.map((m) => ({
      partyId: m.party_id,
      userId: m.user_id,
      name: m.display_name,
    })),
  };
}

async function readAgreement(
  sql: postgres.Sql,
  householdId: string,
  summary: HouseholdSummary,
): Promise<AgreementParams | null> {
  const rows = await sql<
    {
      start_date: string;
      start_value_ore: string;
      initial_loan_ore: string;
      total_units: string;
      start_units: Record<string, number>;
      formal_ownership: Record<string, number> | null;
      model_version: string;
    }[]
  >`
    select v.start_date, v.start_value_ore, v.initial_loan_ore, v.total_units,
           v.start_units, v.formal_ownership, v.model_version
    from agreement_versions v
    -- Det boende som gäller nu. Med en boendekedja finns flera avtal, och
    -- "högsta versionsnumret i hushållet" skulle blanda ihop två bostäder.
    where v.agreement_id = current_agreement_id(${householdId})
      and v.effective_at is not null
    order by v.version desc limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  const parties = summary.parties.map((p) => p.partyId);
  if (parties.length !== 2) return null;

  return {
    startDate: asDate(row.start_date),
    startValue: Number(row.start_value_ore),
    initialLoan: Number(row.initial_loan_ore),
    parties: [parties[0], parties[1]],
    startUnits: row.start_units,
    formalOwnership: row.formal_ownership ?? undefined,
    totalUnits: Number(row.total_units),
    modelVersion: row.model_version,
  };
}

async function readRules(sql: postgres.Sql, householdId: string): Promise<CostCategoryRule[]> {
  const rows = await sql<
    {
      category: string;
      effective_from: string;
      included: boolean;
      outside_split: Record<string, number> | null;
      reduces_loan: boolean;
      effective_at: Date | null;
    }[]
  >`
    select category, effective_from, included, outside_split, reduces_loan, effective_at
    from cost_category_rules where household_id = ${householdId}
    order by effective_from
  `;
  return rows.map((row) => ({
    category: row.category,
    effectiveFrom: asDate(row.effective_from),
    included: row.included,
    outsideSplit: row.outside_split ?? undefined,
    reducesLoan: row.reduces_loan,
    // En klassificering gäller först när båda parter godkänt den.
    approved: row.effective_at !== null,
  }));
}

async function readSnapshots(
  sql: postgres.Sql,
  householdId: string,
): Promise<LoanBalanceSnapshot[]> {
  const rows = await sql<{ balance_date: string; balance_ore: string }[]>`
    select balance_date, balance_ore from loan_balance_snapshots
    where household_id = ${householdId} order by balance_date
  `;
  return rows.map((row) => ({
    date: asDate(row.balance_date),
    balance: Number(row.balance_ore),
  }));
}

async function readTransactions(
  sql: postgres.Sql,
  householdId: string,
  summary: HouseholdSummary,
): Promise<{ transactions: Transaction[]; revisions: Map<string, RecordVersion<Transaction>[]> }> {
  const rows = await sql<VersionRow[]>`
    select
      v.id as version_id, t.id as transaction_id, t.reference, v.version, v.status,
      v.payment_date, v.category,
      v.description, v.payments, v.special_key, v.loan_balance_after_ore,
      corrected.reference as corrects_reference, voided.reference as voids_reference,
      v.reason, v.created_by, v.created_at, v.effective_at
    from transaction_versions v
    join transactions t on t.id = v.transaction_id
    left join transactions corrected on corrected.id = v.corrects_transaction_id
    left join transactions voided on voided.id = v.voids_transaction_id
    where t.household_id = ${householdId} and t.deleted_at is null
    order by t.reference, v.version
  `;

  const approvals = await sql<
    { transaction_version_id: string; party_id: string; decided_at: Date; decision: string }[]
  >`
    select a.transaction_version_id, a.party_id, a.decided_at, a.decision
    from transaction_approvals a
    join transaction_versions v on v.id = a.transaction_version_id
    join transactions t on t.id = v.transaction_id
    where t.household_id = ${householdId}
  `;

  const revisions = new Map<string, RecordVersion<Transaction>[]>();

  for (const row of rows) {
    const values = toTransaction(row);
    const versions = revisions.get(row.reference) ?? [];
    versions.push({
      version: row.version,
      values,
      authorId: partyOf(summary, row.created_by) ?? row.created_by,
      createdAt: row.created_at.toISOString(),
      approvedBy: approvalMap(summary, approvals, row),
      effectiveAt: row.effective_at ? row.effective_at.toISOString() : null,
      reason: row.reason ?? undefined,
    });
    revisions.set(row.reference, versions);
  }

  // Postens nuvarande värden är den senast gällande versionen. Har ingen
  // version börjat gälla än visas den senaste versionen, alltså utkastet.
  const transactions = [...revisions.values()].map((versions) => {
    const effective = versions.filter((v) => v.effectiveAt !== null);
    const chosen =
      effective.length > 0 ? effective[effective.length - 1] : versions[versions.length - 1];
    return chosen.values;
  });

  return { transactions, revisions };
}

function toTransaction(row: VersionRow): Transaction {
  return {
    id: row.reference,
    paymentDate: asDate(row.payment_date),
    category: row.category,
    description: row.description ?? undefined,
    payments: row.payments ?? {},
    specialKey: row.special_key,
    loanBalanceAfter:
      row.loan_balance_after_ore === null ? null : Number(row.loan_balance_after_ore),
    status: row.status,
    correctsId: row.corrects_reference,
    voidsId: row.voids_reference,
    reason: row.reason ?? undefined,
  };
}

function partyOf(summary: HouseholdSummary, userId: string): string | null {
  return summary.parties.find((p) => p.userId === userId)?.partyId ?? null;
}

function approvalMap(
  summary: HouseholdSummary,
  approvals: {
    transaction_version_id: string;
    party_id: string;
    decided_at: Date;
    decision: string;
  }[],
  row: VersionRow,
): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const party of summary.parties) {
    const match = approvals.find(
      (a) =>
        a.party_id === party.partyId &&
        a.decision === "approved" &&
        a.transaction_version_id === row.version_id,
    );
    map[party.partyId] = match ? match.decided_at.toISOString() : null;
  }
  return map;
}

/** Postgres ger date-kolumner som Date eller sträng beroende på drivrutin. */
function asDate(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
