import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Revisionsunderlaget: hela aktivitetsloggen plus svaret på den enda fråga som
 * betyder något — är kedjan obruten? Verifieringen görs av databasen, som
 * räknar om varje rads hash ur dess innehåll.
 */

export type AuditEvent = {
  sequence: number;
  eventType: string;
  entityType: string;
  entityId: string | null;
  actor: string | null;
  /** Före- och eftervärde som JSON-text, redo att visas och exporteras. */
  previousValue: string | null;
  newValue: string | null;
  occurredAt: string;
  hash: string;
  prevHash: string;
};

export type AuditTrail = {
  events: AuditEvent[];
  /** Antal rader vars hash inte stämde med innehållet. Noll betyder obruten. */
  brokenLinks: number[];
  verified: boolean;
};

export const auditTrail = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<AuditTrail | null> => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser, owner } = await import("@/lib/db/client.server");
    const user = await readSession();
    if (!user) return null;

    const events = await asUser(user.id, async (sql) => {
      const rows = await sql<
        {
          sequence: string;
          event_type: string;
          entity_type: string;
          entity_id: string | null;
          actor_name: string | null;
          previous_value: unknown;
          new_value: unknown;
          occurred_at: Date;
          hash: string;
          prev_hash: string;
        }[]
      >`
        select e.sequence, e.event_type, e.entity_type, e.entity_id,
               u.name as actor_name, e.previous_value, e.new_value,
               e.occurred_at, e.hash, e.prev_hash
        from audit_events e
        left join users u on u.id = e.actor_id
        where e.household_id = ${data.householdId}
        order by e.sequence
      `;
      return rows.map((row) => ({
        sequence: Number(row.sequence),
        eventType: row.event_type,
        entityType: row.entity_type,
        entityId: row.entity_id,
        actor: row.actor_name,
        previousValue: row.previous_value === null ? null : JSON.stringify(row.previous_value),
        newValue: row.new_value === null ? null : JSON.stringify(row.new_value),
        occurredAt: row.occurred_at.toISOString(),
        hash: row.hash,
        prevHash: row.prev_hash,
      }));
    });

    // Radnivåsäkerheten har redan avgjort att användaren får se hushållet.
    // Verifieringen räknar om hasharna och kör därför som ägare.
    if (events.length === 0) return { events: [], brokenLinks: [], verified: true };

    const checks = await owner()<{ sequence: string; ok: boolean }[]>`
      select sequence, ok from verify_audit_chain(${data.householdId})
    `;
    const brokenLinks = checks.filter((row) => !row.ok).map((row) => Number(row.sequence));

    return { events, brokenLinks, verified: brokenLinks.length === 0 };
  });
