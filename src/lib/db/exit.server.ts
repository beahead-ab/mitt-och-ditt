import { createHash } from "node:crypto";

import { asUser } from "./client.server";
import { loadHousehold } from "./household.server";
import { canonicalStringify, sameResult } from "@/lib/engine/canonical";
import { calculate, determineValuation, exitDeadlines, type EngineInput } from "@/lib/engine";
import type { Ore } from "@/lib/engine";

/**
 * Exitprocessen, värderingarna och den frysta slutavräkningen.
 *
 * Slutavräkningen sparar både sina indata och sitt resultat. Den kan därefter
 * räknas om ur exakt samma indata, och gör den inte det har underlaget ändrats
 * – vilket är precis vad som ska gå att upptäcka.
 */

export type ExitKind = "extern_forsaljning" | "utkop" | "dodsfall" | "annan";

export type ExitProcess = {
  id: string;
  processDate: string;
  kind: ExitKind;
  status: "pagaende" | "genomford" | "avbruten";
  takeoverPartyId: string | null;
  takeoverNotifiedAt: string | null;
  checklist: Record<string, boolean>;
  note: string | null;
  completedAt: string | null;
  deadlines: { takeoverNoticeBy: string; saleOrBuyoutBy: string };
  /**
   * Källdagarna för avtalets punkt 22. Bara dagarna lagras; fristerna räknas
   * fram, så en lagrad förfallodag aldrig kan sluta stämma med det den
   * räknats från.
   */
  dodsfall: {
    estateInventoryOn: string | null;
    takeoverDeclaredOn: string | null;
    valueEstablishedOn: string | null;
    financingArrangedOn: string | null;
  };
};

export type Valuation = {
  id: string;
  orderedByPartyId: string | null;
  broker: string;
  valuedOn: string;
  amount: Ore;
  note: string | null;
};

export type Settlement = {
  id: string;
  basis: string;
  endDate: string;
  endValue: Ore;
  endLoan: Ore;
  saleCosts: Ore;
  agreementSignedOn: string | null;
  notes: string | null;
  engineVersion: string;
  checksum: string;
  createdAt: string;
  lockedAt: string | null;
  approvedBy: string[];
};

export function checksumOf(input: unknown, result: unknown): string {
  return createHash("sha256").update(canonicalStringify({ input, result })).digest("hex");
}

export async function currentExit(
  userId: string,
  householdId: string,
): Promise<{ process: ExitProcess | null; valuations: Valuation[]; settlements: Settlement[] }> {
  return asUser(userId, async (sql) => {
    const processes = await sql<
      {
        id: string;
        process_date: string;
        kind: ExitKind;
        status: ExitProcess["status"];
        takeover_party_id: string | null;
        takeover_notified_at: Date | null;
        checklist: Record<string, boolean>;
        note: string | null;
        completed_at: Date | null;
        estate_inventory_on: string | null;
        takeover_declared_on: string | null;
        value_established_on: string | null;
        financing_arranged_on: string | null;
      }[]
    >`
      select id, process_date, kind, status, takeover_party_id, takeover_notified_at,
             checklist, note, completed_at,
             estate_inventory_on, takeover_declared_on, value_established_on,
             financing_arranged_on
      from exit_processes where household_id = ${householdId}
      order by process_date desc limit 1
    `;

    const row = processes[0];
    const process: ExitProcess | null = row
      ? {
          id: row.id,
          processDate: asDate(row.process_date),
          kind: row.kind,
          status: row.status,
          takeoverPartyId: row.takeover_party_id,
          takeoverNotifiedAt: row.takeover_notified_at?.toISOString() ?? null,
          checklist: row.checklist ?? {},
          note: row.note,
          completedAt: row.completed_at?.toISOString() ?? null,
          deadlines: (() => {
            const { takeoverNoticeBy, saleOrBuyoutBy } = exitDeadlines(asDate(row.process_date));
            return { takeoverNoticeBy, saleOrBuyoutBy };
          })(),
          dodsfall: {
            estateInventoryOn: row.estate_inventory_on ? asDate(row.estate_inventory_on) : null,
            takeoverDeclaredOn: row.takeover_declared_on ? asDate(row.takeover_declared_on) : null,
            valueEstablishedOn: row.value_established_on ? asDate(row.value_established_on) : null,
            financingArrangedOn: row.financing_arranged_on
              ? asDate(row.financing_arranged_on)
              : null,
          },
        }
      : null;

    const valuationRows = process
      ? await sql<
          {
            id: string;
            ordered_by_party_id: string | null;
            broker: string;
            valued_on: string;
            amount_ore: string;
            note: string | null;
          }[]
        >`
          select id, ordered_by_party_id, broker, valued_on, amount_ore, note
          from valuations where exit_process_id = ${process.id}
          order by created_at
        `
      : [];

    const settlementRows = await sql<
      {
        id: string;
        basis: string;
        end_date: string;
        end_value_ore: string;
        end_loan_ore: string;
        sale_costs_ore: string;
        agreement_signed_on: string | null;
        notes: string | null;
        engine_version: string;
        checksum: string;
        created_at: Date;
        locked_at: Date | null;
      }[]
    >`
      select id, basis, end_date, end_value_ore, end_loan_ore, sale_costs_ore,
             agreement_signed_on, notes, engine_version, checksum, created_at, locked_at
      from settlements where household_id = ${householdId}
      order by created_at desc
    `;

    const approvals = await sql<{ entity_id: string; party_id: string }[]>`
      select entity_id, party_id from document_approvals
      where household_id = ${householdId} and entity_type = 'settlement' and decision = 'approved'
    `;

    return {
      process,
      valuations: valuationRows.map((v) => ({
        id: v.id,
        orderedByPartyId: v.ordered_by_party_id,
        broker: v.broker,
        valuedOn: asDate(v.valued_on),
        amount: Number(v.amount_ore),
        note: v.note,
      })),
      settlements: settlementRows.map((s) => ({
        id: s.id,
        basis: s.basis,
        endDate: asDate(s.end_date),
        endValue: Number(s.end_value_ore),
        endLoan: Number(s.end_loan_ore),
        saleCosts: Number(s.sale_costs_ore),
        agreementSignedOn: s.agreement_signed_on ? asDate(s.agreement_signed_on) : null,
        notes: s.notes,
        engineVersion: s.engine_version,
        checksum: s.checksum,
        createdAt: s.created_at.toISOString(),
        lockedAt: s.locked_at?.toISOString() ?? null,
        approvedBy: approvals.filter((a) => a.entity_id === s.id).map((a) => a.party_id),
      })),
    };
  });
}

export async function startExit(
  userId: string,
  householdId: string,
  processDate: string,
  kind: ExitKind,
  note: string | null,
): Promise<{ id: string }> {
  return asUser(userId, async (sql) => {
    const [row] = await sql<{ id: string }[]>`
      insert into exit_processes (household_id, process_date, kind, note, started_by)
      values (${householdId}, ${processDate}, ${kind}, ${note}, ${userId})
      returning id
    `;
    await sql`
      insert into audit_events
        (household_id, event_type, entity_type, entity_id, actor_id, new_value)
      values (${householdId}, 'exit.started', 'exit_process', ${row.id}, ${userId},
              ${sql.json({ processDate, kind } as never)})
    `;
    return row;
  });
}

export async function notifyTakeover(
  userId: string,
  householdId: string,
  processId: string,
  partyId: string,
): Promise<void> {
  return asUser(userId, async (sql) => {
    await sql`
      update exit_processes
      set takeover_party_id = ${partyId}, takeover_notified_at = now(), kind = 'utkop'
      where id = ${processId} and household_id = ${householdId}
    `;
    await sql`
      insert into audit_events
        (household_id, event_type, entity_type, entity_id, actor_id, new_value)
      values (${householdId}, 'exit.takeover_notified', 'exit_process', ${processId}, ${userId},
              ${sql.json({ partyId } as never)})
    `;
  });
}

export async function setChecklist(
  userId: string,
  householdId: string,
  processId: string,
  checklist: Record<string, boolean>,
): Promise<void> {
  return asUser(userId, async (sql) => {
    await sql`
      update exit_processes set checklist = ${sql.json(checklist as never)}
      where id = ${processId} and household_id = ${householdId}
    `;
  });
}

export async function addValuation(
  userId: string,
  householdId: string,
  processId: string,
  valuation: {
    orderedByPartyId: string | null;
    broker: string;
    valuedOn: string;
    amount: Ore;
    note: string | null;
  },
): Promise<void> {
  return asUser(userId, async (sql) => {
    const [row] = await sql<{ id: string }[]>`
      insert into valuations (
        exit_process_id, household_id, ordered_by_party_id, broker, valued_on,
        amount_ore, note, created_by
      ) values (
        ${processId}, ${householdId}, ${valuation.orderedByPartyId}, ${valuation.broker},
        ${valuation.valuedOn}, ${valuation.amount}, ${valuation.note}, ${userId}
      ) returning id
    `;
    await sql`
      insert into audit_events
        (household_id, event_type, entity_type, entity_id, actor_id, new_value)
      values (${householdId}, 'valuation.added', 'valuation', ${row.id}, ${userId},
              ${sql.json({ broker: valuation.broker, amount: valuation.amount } as never)})
    `;
  });
}

// Fastställandet av slutvärdet ligger bland de rena funktionerna, eftersom
// gränssnittet behöver samma svar. Återexporteras här så anropen inte behöver
// ändras.
export { valuationOutcome } from "@/lib/engine/exit";

/**
 * Skapar slutavräkningen och fryser den. Indata hämtas om från databasen vid
 * detta tillfälle, så det som fryses är hushållets faktiska underlag – inte
 * något klienten har skickat med.
 */
export async function createSettlement(
  userId: string,
  householdId: string,
  facts: {
    basis: string;
    endDate: string;
    endValue: Ore;
    endLoan: Ore;
    saleCosts: Ore;
    agreementSignedOn: string | null;
    notes: string | null;
    exitProcessId: string | null;
  },
): Promise<{ id: string; checksum: string }> {
  const household = await loadHousehold(userId, householdId);
  if (!household) throw new Error("Hushållet finns inte.");

  const input: EngineInput = {
    agreement: household.agreement,
    categoryRules: household.rules,
    transactions: household.transactions,
    loanSnapshots: household.loanSnapshots,
    endpoint: {
      mode: "slutlig",
      endDate: facts.endDate,
      endValue: facts.endValue,
      endLoan: facts.endLoan,
      saleCosts: facts.saleCosts,
    },
  };
  const result = calculate(input);
  if (!result.settlement.checks.ok) {
    throw new Error("Kontrollerna går inte ihop. Slutavräkningen kan inte skapas.");
  }
  const checksum = checksumOf(input, result);

  return asUser(userId, async (sql) => {
    const [row] = await sql<{ id: string }[]>`
      insert into settlements (
        household_id, exit_process_id, basis, end_date, end_value_ore, end_loan_ore,
        sale_costs_ore, agreement_signed_on, notes, frozen_input, frozen_result,
        engine_version, checksum, created_by
      ) values (
        ${householdId}, ${facts.exitProcessId}, ${facts.basis}, ${facts.endDate},
        ${facts.endValue}, ${facts.endLoan}, ${facts.saleCosts}, ${facts.agreementSignedOn},
        ${facts.notes}, ${sql.json(input as never)}, ${sql.json(result as never)},
        ${result.engineVersion}, ${checksum}, ${userId}
      ) returning id
    `;
    await sql`
      insert into audit_events
        (household_id, event_type, entity_type, entity_id, actor_id, new_value)
      values (${householdId}, 'settlement.created', 'settlement', ${row.id}, ${userId},
              ${sql.json({ checksum, engineVersion: result.engineVersion } as never)})
    `;
    return { id: row.id, checksum };
  });
}

export type Verification = {
  matches: boolean;
  checksumMatches: boolean;
  storedChecksum: string;
  recomputedChecksum: string;
  engineVersion: string;
  currentEngineVersion: string;
};

/**
 * Räknar om en fryst slutavräkning ur dess egna indata och jämför. Stämmer det
 * inte har antingen underlaget eller beräkningsmotorn ändrats sedan
 * avräkningen frystes.
 */
export async function verifySettlement(
  userId: string,
  householdId: string,
  settlementId: string,
): Promise<Verification | null> {
  return asUser(userId, async (sql) => {
    const rows = await sql<
      {
        frozen_input: EngineInput;
        frozen_result: unknown;
        checksum: string;
        engine_version: string;
      }[]
    >`
      select frozen_input, frozen_result, checksum, engine_version
      from settlements where id = ${settlementId} and household_id = ${householdId}
    `;
    const row = rows[0];
    if (!row) return null;

    const recomputed = calculate(row.frozen_input);
    const recomputedChecksum = checksumOf(row.frozen_input, recomputed);

    return {
      matches: sameResult(recomputed, row.frozen_result),
      checksumMatches: recomputedChecksum === row.checksum,
      storedChecksum: row.checksum,
      recomputedChecksum,
      engineVersion: row.engine_version,
      currentEngineVersion: recomputed.engineVersion,
    };
  });
}

/** Postgres ger date-kolumner som Date eller sträng beroende på drivrutin. */
function asDate(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
