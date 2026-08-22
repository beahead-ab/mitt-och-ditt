import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Rantebesked } from "@/lib/rantelagen";

/**
 * Regressfordringar med dröjsmålsränta (avtal 12.3).
 *
 * Räntan räknas på servern och inte i klienten. Det är ett belopp någon ska
 * betala, och då ska det bara finnas ett svar - inte ett per webbläsare med en
 * egen uppfattning om vilka referensräntor som finns.
 */

export type Regresskrav = {
  id: string;
  creditorPartyId: string;
  debtorPartyId: string;
  amountOre: number;
  demandedOn: string;
  description: string | null;
  settledOn: string | null;
  settledAmountOre: number | null;
  /** Räntan fram till regleringsdagen, eller fram till idag om den är obetald. */
  ranta: Rantebesked;
  createdByName: string;
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange datum som ÅÅÅÅ-MM-DD.");

function idag(): string {
  return new Date().toISOString().slice(0, 10);
}

export const listRegressClaims = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<Regresskrav[]> => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const { drojsmalsranta } = await import("@/lib/rantelagen");

    const user = await readSession();
    if (!user) return [];

    return asUser(user.id, async (sql) => {
      const rader = await sql<
        {
          id: string;
          creditor_party_id: string;
          debtor_party_id: string;
          amount_ore: string;
          demanded_on: string;
          description: string | null;
          settled_on: string | null;
          settled_amount_ore: string | null;
          created_by_name: string;
        }[]
      >`
        select k.id, k.creditor_party_id, k.debtor_party_id, k.amount_ore, k.demanded_on,
               k.description, k.settled_on, k.settled_amount_ore, u.name as created_by_name
          from regress_claims k join users u on u.id = k.created_by
         where k.household_id = ${data.householdId}
         order by k.demanded_on desc, k.created_at desc
      `;

      // Referensräntorna är globala och läses en gång för hela listan.
      const satser = await sql<{ from_date: string; percent: string }[]>`
        select from_date, percent from reference_rates order by from_date`;
      const referensrantor = satser.map((s) => ({
        fromDate: String(s.from_date).slice(0, 10),
        percent: Number(s.percent),
      }));

      const nu = idag();

      return rader.map((rad) => {
        const demandedOn = String(rad.demanded_on).slice(0, 10);
        const settledOn = rad.settled_on ? String(rad.settled_on).slice(0, 10) : null;
        return {
          id: rad.id,
          creditorPartyId: rad.creditor_party_id,
          debtorPartyId: rad.debtor_party_id,
          amountOre: Number(rad.amount_ore),
          demandedOn,
          description: rad.description,
          settledOn,
          settledAmountOre: rad.settled_amount_ore ? Number(rad.settled_amount_ore) : null,
          // En reglerad fordran slutar löpa den dag den reglerades. En obetald
          // räknas fram till idag, så beloppet är levande.
          ranta: drojsmalsranta({
            belopp: Number(rad.amount_ore),
            kravdag: demandedOn,
            tillDag: settledOn ?? nu,
            referensrantor,
          }),
          createdByName: rad.created_by_name,
        };
      });
    });
  });

export const createRegressClaim = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        amountKr: z.number().int().min(1).max(100_000_000_000),
        demandedOn: isoDate,
        description: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const { kr } = await import("@/lib/engine");

    const user = await readSession();
    if (!user) throw new Error("Ej inloggad.");

    return asUser(user.id, async (sql) => {
      // Partsrollerna bestäms på servern av vem som är inloggad. Klienten kan
      // alltså inte framställa ett krav i motpartens namn - och policyn
      // upprepar samma kontroll som ett andra skyddslager.
      const [hushall] = await sql<{ party_a: string; party_b: string }[]>`
        select party_a, party_b from households where id = ${data.householdId}`;
      if (!hushall) throw new Error("Hushållet finns inte.");

      const [medlem] = await sql<{ party_id: string }[]>`
        select party_id from household_members
         where household_id = ${data.householdId} and user_id = ${user.id}`;
      if (!medlem) throw new Error("Du tillhör inte hushållet.");

      const motpart = medlem.party_id === hushall.party_a ? hushall.party_b : hushall.party_a;

      const [rad] = await sql<{ id: string }[]>`
        insert into regress_claims
          (household_id, creditor_party_id, debtor_party_id, amount_ore, demanded_on,
           description, created_by)
        values (${data.householdId}, ${medlem.party_id}, ${motpart}, ${kr(data.amountKr)},
                ${data.demandedOn}, ${data.description || null}, ${user.id})
        returning id
      `;

      await sql`
        insert into audit_events (household_id, event_type, entity_type, entity_id, actor_id)
        values (${data.householdId}, 'regress.demanded', 'regress_claim', ${rad.id}, ${user.id})
      `;

      return { id: rad.id };
    });
  });

export const settleRegressClaim = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        claimId: z.string().uuid(),
        settledOn: isoDate,
        settledAmountKr: z.number().int().min(0).max(100_000_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const { kr } = await import("@/lib/engine");

    const user = await readSession();
    if (!user) throw new Error("Ej inloggad.");

    return asUser(user.id, async (sql) => {
      const rader = await sql<{ id: string }[]>`
        update regress_claims
           set settled_on = ${data.settledOn}, settled_amount_ore = ${kr(data.settledAmountKr)}
         where id = ${data.claimId} and household_id = ${data.householdId}
        returning id
      `;
      // Policyn släpper bara igenom borgenären och bara en oreglerad fordran,
      // så noll rader betyder att något av det inte stämde.
      if (rader.length === 0) {
        throw new Error("Bara den som har fordran kan reglera den, och bara en gång.");
      }

      await sql`
        insert into audit_events (household_id, event_type, entity_type, entity_id, actor_id)
        values (${data.householdId}, 'regress.settled', 'regress_claim', ${data.claimId},
                ${user.id})
      `;
      return { ok: true as const };
    });
  });

/** Referensräntorna, för administratörens sida och för att visa vad som saknas. */
export const listReferenceRates = createServerFn({ method: "GET" }).handler(async () => {
  const { readSession } = await import("@/lib/auth/session.server");
  const { asUser } = await import("@/lib/db/client.server");

  const user = await readSession();
  if (!user) return [];

  return asUser(user.id, async (sql) => {
    const rader = await sql<{ from_date: string; percent: string; source: string | null }[]>`
      select from_date, percent, source from reference_rates order by from_date desc`;
    return rader.map((r) => ({
      fromDate: String(r.from_date).slice(0, 10),
      percent: Number(r.percent),
      source: r.source,
    }));
  });
});

export const addReferenceRate = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        fromDate: isoDate,
        percent: z.number().min(-10).max(50),
        source: z.string().trim().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");

    const user = await readSession();
    if (!user) throw new Error("Ej inloggad.");

    return asUser(user.id, async (sql) => {
      // Radnivåsäkerheten släpper bara igenom administratören.
      const rader = await sql<{ from_date: string }[]>`
        insert into reference_rates (from_date, percent, source, created_by)
        values (${data.fromDate}, ${data.percent}, ${data.source || null}, ${user.id})
        on conflict (from_date) do update
          set percent = excluded.percent, source = excluded.source
        returning from_date
      `;
      if (rader.length === 0) throw new Error("Bara administratören kan ändra referensräntan.");
      return { ok: true as const };
    });
  });
