import type postgres from "postgres";

import { asUser } from "./client.server";
import type { PartyPayment } from "@/lib/engine";

export type TransactionInput = {
  householdId: string;
  paymentDate: string;
  category: string;
  description?: string;
  payments: Record<string, PartyPayment>;
  specialKey?: Record<string, number> | null;
  loanBalanceAfter?: number | null;
};

/** Nästa lediga löpnummer i hushållet: T-0001, T-0002 och så vidare. */
async function nextReference(sql: postgres.Sql, householdId: string): Promise<string> {
  const rows = await sql<{ reference: string }[]>`
    select reference from transactions
    where household_id = ${householdId} and reference ~ '^[A-Z]-[0-9]+$'
    order by reference desc limit 1
  `;
  const last = rows[0] ? Number(rows[0].reference.split("-")[1]) : 0;
  return `T-${String(last + 1).padStart(4, "0")}`;
}

async function audit(
  sql: postgres.Sql,
  args: {
    householdId: string;
    userId: string;
    eventType: string;
    entityId: string;
    previous?: unknown;
    next?: unknown;
  },
): Promise<void> {
  await sql`
    insert into audit_events
      (household_id, event_type, entity_type, entity_id, actor_id, previous_value, new_value)
    values (
      ${args.householdId}, ${args.eventType}, 'transaction', ${args.entityId}, ${args.userId},
      ${args.previous === undefined ? null : sql.json(args.previous as never)},
      ${args.next === undefined ? null : sql.json(args.next as never)}
    )
  `;
}

/**
 * Skapar en post. `submit` avgör om den skickas för godkännande direkt eller
 * sparas som utkast. Den som registrerar bekräftar posten i samma steg – det
 * är hens godkännande – medan motparten tar ställning separat.
 */
export async function createTransaction(
  userId: string,
  partyId: string,
  input: TransactionInput,
  options: { submit: boolean; correctsReference?: string; reason?: string },
): Promise<{ reference: string }> {
  return asUser(userId, async (sql) => {
    const reference = await nextReference(sql, input.householdId);

    const [transaction] = await sql<{ id: string }[]>`
      insert into transactions (household_id, reference, created_by)
      values (${input.householdId}, ${reference}, ${userId})
      returning id
    `;

    const correctsId = options.correctsReference
      ? await referenceToId(sql, input.householdId, options.correctsReference)
      : null;

    const [version] = await sql<{ id: string }[]>`
      insert into transaction_versions (
        transaction_id, version, status, payment_date, category, description,
        payments, special_key, loan_balance_after_ore, corrects_transaction_id,
        reason, created_by
      ) values (
        ${transaction.id}, 1, ${options.submit ? "pending" : "draft"},
        ${input.paymentDate}, ${input.category}, ${input.description ?? null},
        ${sql.json(input.payments as never)},
        ${input.specialKey ? sql.json(input.specialKey as never) : null},
        ${input.loanBalanceAfter ?? null}, ${correctsId},
        ${options.reason ?? null}, ${userId}
      )
      returning id
    `;

    if (options.submit) {
      await recordApproval(sql, version.id, userId, partyId, "approved");
    }

    await audit(sql, {
      householdId: input.householdId,
      userId,
      eventType: options.submit ? "transaction.submitted" : "transaction.drafted",
      entityId: transaction.id,
      next: { reference, category: input.category, paymentDate: input.paymentDate },
    });

    return { reference };
  });
}

async function referenceToId(
  sql: postgres.Sql,
  householdId: string,
  reference: string,
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    select id from transactions where household_id = ${householdId} and reference = ${reference}
  `;
  return rows[0]?.id ?? null;
}

async function recordApproval(
  sql: postgres.Sql,
  versionId: string,
  userId: string,
  partyId: string,
  decision: "approved" | "objected",
  note?: string,
): Promise<void> {
  await sql`
    insert into transaction_approvals (transaction_version_id, user_id, party_id, decision, note)
    values (${versionId}, ${userId}, ${partyId}, ${decision}, ${note ?? null})
  `;
}

/** Den senaste versionen av en post, oavsett om den gäller. */
async function latestVersion(
  sql: postgres.Sql,
  householdId: string,
  reference: string,
): Promise<{ id: string; transaction_id: string; status: string; version: number } | null> {
  const rows = await sql<{ id: string; transaction_id: string; status: string; version: number }[]>`
    select v.id, v.transaction_id, v.status, v.version
    from transaction_versions v join transactions t on t.id = v.transaction_id
    where t.household_id = ${householdId} and t.reference = ${reference}
    order by v.version desc limit 1
  `;
  return rows[0] ?? null;
}

/** Godkänner eller invänder mot den senaste versionen av en post. */
export async function decide(
  userId: string,
  partyId: string,
  householdId: string,
  reference: string,
  decision: "approved" | "objected",
  note?: string,
): Promise<void> {
  return asUser(userId, async (sql) => {
    const version = await latestVersion(sql, householdId, reference);
    if (!version) throw new Error("Posten finns inte.");
    await recordApproval(sql, version.id, userId, partyId, decision, note);
    await audit(sql, {
      householdId,
      userId,
      eventType: decision === "approved" ? "transaction.approved" : "transaction.objected",
      entityId: version.transaction_id,
      next: { reference, party: partyId, note: note ?? null },
    });
  });
}

/** Drar tillbaka en post som ännu inte godkänts av båda. */
export async function withdraw(
  userId: string,
  householdId: string,
  reference: string,
): Promise<void> {
  return asUser(userId, async (sql) => {
    const version = await latestVersion(sql, householdId, reference);
    if (!version) throw new Error("Posten finns inte.");
    await sql`update transaction_versions set status = 'withdrawn' where id = ${version.id}`;
    await audit(sql, {
      householdId,
      userId,
      eventType: "transaction.withdrawn",
      entityId: version.transaction_id,
      previous: { status: version.status },
      next: { status: "withdrawn" },
    });
  });
}

/** Skickar ett utkast för motpartens godkännande. */
export async function submitDraft(
  userId: string,
  partyId: string,
  householdId: string,
  reference: string,
): Promise<void> {
  return asUser(userId, async (sql) => {
    const version = await latestVersion(sql, householdId, reference);
    if (!version) throw new Error("Posten finns inte.");
    await sql`update transaction_versions set status = 'pending' where id = ${version.id}`;
    await recordApproval(sql, version.id, userId, partyId, "approved");
    await audit(sql, {
      householdId,
      userId,
      eventType: "transaction.submitted",
      entityId: version.transaction_id,
      next: { reference },
    });
  });
}

/** Raderar ett eget utkast. Enda stället i tjänsten där något faktiskt raderas. */
export async function deleteDraft(
  userId: string,
  householdId: string,
  reference: string,
): Promise<void> {
  return asUser(userId, async (sql) => {
    const version = await latestVersion(sql, householdId, reference);
    if (!version) throw new Error("Posten finns inte.");
    if (version.status !== "draft") {
      throw new Error("Bara utkast får raderas. Använd korrigering eller makulering.");
    }
    await sql`delete from transaction_versions where id = ${version.id}`;
    await sql`update transactions set deleted_at = now() where id = ${version.transaction_id}`;
    // Raderingen loggas, så att den syns även om posten är borta.
    await audit(sql, {
      householdId,
      userId,
      eventType: "transaction.draft_deleted",
      entityId: version.transaction_id,
      previous: { reference },
    });
  });
}

/**
 * Makulerar en godkänd post. Ursprungsposten raderas aldrig – en ny, länkad
 * post med angivet skäl tar den ur beräkningen när båda godkänt (avtal 14.3).
 */
export async function voidTransaction(
  userId: string,
  partyId: string,
  householdId: string,
  reference: string,
  reason: string,
): Promise<{ reference: string }> {
  return asUser(userId, async (sql) => {
    const targetId = await referenceToId(sql, householdId, reference);
    if (!targetId) throw new Error("Posten finns inte.");

    const target = await sql<{ payment_date: string; category: string }[]>`
      select payment_date, category from transaction_versions
      where transaction_id = ${targetId} order by version desc limit 1
    `;

    const newReference = await nextReference(sql, householdId);
    const [transaction] = await sql<{ id: string }[]>`
      insert into transactions (household_id, reference, created_by)
      values (${householdId}, ${newReference}, ${userId}) returning id
    `;
    const [version] = await sql<{ id: string }[]>`
      insert into transaction_versions (
        transaction_id, version, status, payment_date, category, description,
        payments, voids_transaction_id, reason, created_by
      ) values (
        ${transaction.id}, 1, 'pending', ${target[0].payment_date},
        ${target[0].category}, ${"Makulerar " + reference}, '{}'::jsonb,
        ${targetId}, ${reason}, ${userId}
      ) returning id
    `;
    await recordApproval(sql, version.id, userId, partyId, "approved");
    await audit(sql, {
      householdId,
      userId,
      eventType: "transaction.void_requested",
      entityId: targetId,
      next: { voidedBy: newReference, reason },
    });

    return { reference: newReference };
  });
}

/** Godkänner en avtalsversion eller en kostnadsklassificering. */
export async function approveDocument(
  userId: string,
  partyId: string,
  householdId: string,
  entityType: "agreement_version" | "cost_category_rule",
  entityId: string,
): Promise<void> {
  return asUser(userId, async (sql) => {
    await sql`
      insert into document_approvals
        (entity_type, entity_id, household_id, user_id, party_id, decision)
      values (${entityType}, ${entityId}, ${householdId}, ${userId}, ${partyId}, 'approved')
    `;
    await sql`
      insert into audit_events
        (household_id, event_type, entity_type, entity_id, actor_id, new_value)
      values (${householdId}, ${entityType + ".approved"}, ${entityType}, ${entityId}, ${userId},
              ${sql.json({ party: partyId } as never)})
    `;
  });
}
