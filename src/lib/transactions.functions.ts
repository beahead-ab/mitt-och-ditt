import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Serverfunktioner för att skriva poster. Varje anrop slår upp den inloggades
 * partsroll i hushållet innan något skrivs – klienten får aldrig ange vem den
 * agerar som.
 */

const payment = z.object({
  gross: z.number().int().min(0),
  discount: z.number().int().min(0).optional(),
  refund: z.number().int().min(0).optional(),
  insurance: z.number().int().min(0).optional(),
  taxEffect: z.number().int().min(0).optional(),
  taxPreliminary: z.boolean().optional(),
});

const transactionInput = z.object({
  householdId: z.string().uuid(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).optional(),
  payments: z.record(z.string(), payment),
  specialKey: z.record(z.string(), z.number().min(0).max(1)).nullable().optional(),
  loanBalanceAfter: z.number().int().min(0).nullable().optional(),
  submit: z.boolean().default(true),
  correctsReference: z.string().max(20).optional(),
  reason: z.string().trim().max(400).optional(),
});

/** Slår upp vem den inloggade är och vilken part hen företräder. */
async function actor(householdId: string) {
  const { readSession } = await import("@/lib/auth/session.server");
  const { asUser } = await import("@/lib/db/client.server");

  const user = await readSession();
  if (!user) throw new Error("Ej inloggad.");

  const partyId = await asUser(user.id, async (sql) => {
    const rows = await sql<{ party_id: string }[]>`
      select party_id from household_members
      where household_id = ${householdId} and user_id = ${user.id}
    `;
    return rows[0]?.party_id ?? null;
  });
  if (!partyId) throw new Error("Du är inte part i det här hushållet.");

  return { userId: user.id, partyId };
}

export const saveTransaction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => transactionInput.parse(input))
  .handler(async ({ data }) => {
    const { createTransaction } = await import("@/lib/db/transactions.server");
    const { userId, partyId } = await actor(data.householdId);

    if (data.correctsReference && !data.reason) {
      throw new Error("En korrigering kräver ett angivet skäl.");
    }

    return createTransaction(
      userId,
      partyId,
      {
        householdId: data.householdId,
        paymentDate: data.paymentDate,
        category: data.category,
        description: data.description,
        payments: data.payments,
        specialKey: data.specialKey ?? null,
        loanBalanceAfter: data.loanBalanceAfter ?? null,
      },
      { submit: data.submit, correctsReference: data.correctsReference, reason: data.reason },
    );
  });

const reference = z.object({
  householdId: z.string().uuid(),
  reference: z.string().min(1).max(20),
});

export const decideTransaction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    reference
      .extend({
        decision: z.enum(["approved", "objected"]),
        note: z.string().trim().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { decide } = await import("@/lib/db/transactions.server");
    const { userId, partyId } = await actor(data.householdId);
    if (data.decision === "objected" && !data.note) {
      throw new Error("En invändning kräver en motivering.");
    }
    await decide(userId, partyId, data.householdId, data.reference, data.decision, data.note);
    return { ok: true as const };
  });

export const withdrawTransaction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => reference.parse(input))
  .handler(async ({ data }) => {
    const { withdraw } = await import("@/lib/db/transactions.server");
    const { userId } = await actor(data.householdId);
    await withdraw(userId, data.householdId, data.reference);
    return { ok: true as const };
  });

export const submitTransaction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => reference.parse(input))
  .handler(async ({ data }) => {
    const { submitDraft } = await import("@/lib/db/transactions.server");
    const { userId, partyId } = await actor(data.householdId);
    await submitDraft(userId, partyId, data.householdId, data.reference);
    return { ok: true as const };
  });

export const deleteDraftTransaction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => reference.parse(input))
  .handler(async ({ data }) => {
    const { deleteDraft } = await import("@/lib/db/transactions.server");
    const { userId } = await actor(data.householdId);
    await deleteDraft(userId, data.householdId, data.reference);
    return { ok: true as const };
  });

export const voidTransactionFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    reference.extend({ reason: z.string().trim().min(3).max(400) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { voidTransaction } = await import("@/lib/db/transactions.server");
    const { userId, partyId } = await actor(data.householdId);
    return voidTransaction(userId, partyId, data.householdId, data.reference, data.reason);
  });

export const approveDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        entityType: z.enum(["agreement_version", "cost_category_rule", "settlement", "addendum"]),
        entityId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { approveDocument } = await import("@/lib/db/transactions.server");
    const { userId, partyId } = await actor(data.householdId);
    await approveDocument(userId, partyId, data.householdId, data.entityType, data.entityId);
    return { ok: true as const };
  });
