import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Serverfunktioner för försäljning och utköp. Partsrollen slås alltid upp på
 * servern; klienten får aldrig ange vem den agerar som.
 */

const household = z.object({ householdId: z.string().uuid() });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

export const getExit = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => household.parse(input))
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { currentExit, valuationOutcome } = await import("@/lib/db/exit.server");
    const user = await readSession();
    if (!user) return null;

    const state = await currentExit(user.id, data.householdId);
    const outcome = valuationOutcome(state.valuations);
    return { ...state, outcome };
  });

export const startExitFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    household
      .extend({
        processDate: isoDate,
        kind: z.enum(["extern_forsaljning", "utkop", "dodsfall", "annan"]),
        note: z.string().trim().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { startExit } = await import("@/lib/db/exit.server");
    const { userId } = await actor(data.householdId);
    return startExit(userId, data.householdId, data.processDate, data.kind, data.note ?? null);
  });

export const notifyTakeoverFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    household.extend({ processId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { notifyTakeover } = await import("@/lib/db/exit.server");
    const { userId, partyId } = await actor(data.householdId);
    // Man kan bara anmäla sitt eget övertagande, inte motpartens.
    await notifyTakeover(userId, data.householdId, data.processId, partyId);
    return { ok: true as const };
  });

export const setChecklistFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    household
      .extend({ processId: z.string().uuid(), checklist: z.record(z.string(), z.boolean()) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { setChecklist } = await import("@/lib/db/exit.server");
    const { userId } = await actor(data.householdId);
    await setChecklist(userId, data.householdId, data.processId, data.checklist);
    return { ok: true as const };
  });

export const addValuationFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    household
      .extend({
        processId: z.string().uuid(),
        broker: z.string().trim().min(1).max(120),
        valuedOn: isoDate,
        amount: z.number().int().positive(),
        forParty: z.boolean().default(true),
        note: z.string().trim().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { addValuation } = await import("@/lib/db/exit.server");
    const { userId, partyId } = await actor(data.householdId);
    await addValuation(userId, data.householdId, data.processId, {
      // Den tredje värderingen tas in gemensamt och tillhör ingen part.
      orderedByPartyId: data.forParty ? partyId : null,
      broker: data.broker,
      valuedOn: data.valuedOn,
      amount: data.amount,
      note: data.note ?? null,
    });
    return { ok: true as const };
  });

export const createSettlementFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    household
      .extend({
        basis: z.enum(["extern-forsaljning", "utkopsvardering", "annan"]),
        endDate: isoDate,
        endValue: z.number().int(),
        endLoan: z.number().int().min(0),
        saleCosts: z.number().int().min(0).default(0),
        agreementSignedOn: isoDate.optional(),
        notes: z.string().trim().max(2000).optional(),
        exitProcessId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { createSettlement } = await import("@/lib/db/exit.server");
    const { userId } = await actor(data.householdId);
    return createSettlement(userId, data.householdId, {
      basis: data.basis,
      endDate: data.endDate,
      endValue: data.endValue,
      endLoan: data.endLoan,
      saleCosts: data.saleCosts,
      agreementSignedOn: data.agreementSignedOn ?? null,
      notes: data.notes ?? null,
      exitProcessId: data.exitProcessId ?? null,
    });
  });

export const verifySettlementFn = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    household.extend({ settlementId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { verifySettlement } = await import("@/lib/db/exit.server");
    const user = await readSession();
    if (!user) return null;
    return verifySettlement(user.id, data.householdId, data.settlementId);
  });

/** Hämtar en fryst slutavräkning för att kunna visa och exportera protokollet. */
export const getSettlementResult = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    household.extend({ settlementId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const user = await readSession();
    if (!user) return null;

    return asUser(user.id, async (sql) => {
      const rows = await sql<{ frozen_result: unknown }[]>`
        select frozen_result from settlements
        where id = ${data.settlementId} and household_id = ${data.householdId}
      `;
      return rows[0] ? JSON.stringify(rows[0].frozen_result) : null;
    });
  });
