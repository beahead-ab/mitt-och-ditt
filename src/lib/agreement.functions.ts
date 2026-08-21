import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Avtalsversioner som väntar på parternas godkännande. */
export const pendingAgreement = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const user = await readSession();
    if (!user) return null;

    return asUser(user.id, async (sql) => {
      const rows = await sql<
        {
          id: string;
          version: number;
          start_date: string;
          start_value_ore: string;
          initial_loan_ore: string;
          total_units: string;
          start_units: Record<string, number>;
          reason: string | null;
        }[]
      >`
        select v.id, v.version, v.start_date, v.start_value_ore, v.initial_loan_ore,
               v.total_units, v.start_units, v.reason
        from agreement_versions v join agreements a on a.id = v.agreement_id
        where a.household_id = ${data.householdId} and v.effective_at is null
        order by v.version desc limit 1
      `;
      const version = rows[0];
      if (!version) return null;

      const approvals = await sql<{ party_id: string }[]>`
        select party_id from document_approvals
        where entity_type = 'agreement_version' and entity_id = ${version.id}
          and decision = 'approved'
      `;
      const me = await sql<{ party_id: string }[]>`
        select party_id from household_members
        where household_id = ${data.householdId} and user_id = ${user.id}
      `;

      return {
        id: version.id,
        version: version.version,
        startDate:
          typeof version.start_date === "string"
            ? version.start_date.slice(0, 10)
            : new Date(version.start_date).toISOString().slice(0, 10),
        startValue: Number(version.start_value_ore),
        initialLoan: Number(version.initial_loan_ore),
        totalUnits: Number(version.total_units),
        startUnits: version.start_units,
        reason: version.reason,
        approvedBy: approvals.map((a) => a.party_id),
        myPartyId: me[0]?.party_id ?? null,
      };
    });
  });
