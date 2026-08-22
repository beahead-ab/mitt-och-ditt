import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Kvartalsavstämning enligt avtalets punkt 14.4.
 *
 * En avstämning är en egen sak som ska avslutas, inte en påminnelse som
 * nollställs av aktivitet. Nästa förfallodag räknas från den senast avslutade
 * avstämningen; räknades den från senaste posten kunde återkommande
 * transaktioner skjuta upp den hur länge som helst.
 */

/** Punkterna som minst ska stämmas av. Ordningen styr hur de visas. */
export const CHECKLISTA = [
  { nyckel: "transaktioner", text: "Alla betalningar är registrerade och godkända" },
  { nyckel: "lanesaldo", text: "Lånesaldot stämmer med bankens besked" },
  { nyckel: "skatt", text: "Faktisk och preliminär skatt är uppdaterade" },
  { nyckel: "bilagor", text: "Underlag finns för de poster som kräver det" },
] as const;

/** Tre månader, samma intervall som avtalet anger. */
export const PERIOD_DAGAR = 92;

export type Avstamning = {
  id: string;
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  checklist: Record<string, boolean>;
  completedAt: string | null;
  confirmedBy: string[];
  createdBy: string;
  createdAt: string;
};

export type AvstamningsLage = {
  /** Den öppna avstämningen, om någon är påbörjad. */
  open: Avstamning | null;
  /** Den senast avslutade, som nästa förfallodag räknas från. */
  lastCompleted: Avstamning | null;
  /** När nästa avstämning ska vara gjord. */
  nextDueOn: string;
  /** Sant när förfallodagen passerats. */
  overdue: boolean;
  /** Partsroller som ännu inte bekräftat den öppna avstämningen. */
  waitingFor: string[];
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function plusDagar(datum: string, dagar: number): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dagar);
  return iso(d);
}

async function medlem(householdId: string) {
  const { readSession } = await import("@/lib/auth/session.server");
  const { asUser } = await import("@/lib/db/client.server");
  const user = await readSession();
  if (!user) throw new Error("Ej inloggad.");

  const partsroll = await asUser(user.id, async (sql) => {
    const [rad] = await sql<{ party_id: string }[]>`
      select party_id from household_members
       where household_id = ${householdId} and user_id = ${user.id}`;
    return rad?.party_id ?? null;
  });
  if (!partsroll) throw new Error("Du tillhör inte hushållet.");
  return { user, partsroll };
}

function tillAvstamning(rad: {
  id: string;
  period_start: string;
  period_end: string;
  due_on: string;
  checklist: Record<string, boolean>;
  completed_at: Date | null;
  created_at: Date;
  created_by_name: string;
  confirmed: string[];
}): Avstamning {
  return {
    id: rad.id,
    periodStart: rad.period_start,
    periodEnd: rad.period_end,
    dueOn: rad.due_on,
    checklist: rad.checklist ?? {},
    completedAt: rad.completed_at?.toISOString() ?? null,
    confirmedBy: rad.confirmed.filter(Boolean),
    createdBy: rad.created_by_name,
    createdAt: rad.created_at.toISOString(),
  };
}

export const reconciliationState = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<AvstamningsLage | null> => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const user = await readSession();
    if (!user) return null;

    return asUser(user.id, async (sql) => {
      const rader = await sql<
        {
          id: string;
          period_start: string;
          period_end: string;
          due_on: string;
          checklist: Record<string, boolean>;
          completed_at: Date | null;
          created_at: Date;
          created_by_name: string;
          confirmed: string[];
        }[]
      >`
        select r.id, r.period_start, r.period_end, r.due_on, r.checklist,
               r.completed_at, r.created_at, u.name as created_by_name,
               coalesce(array_agg(c.party_id) filter (where c.party_id is not null), '{}')
                 as confirmed
          from reconciliations r
          join users u on u.id = r.created_by
          left join reconciliation_confirmations c on c.reconciliation_id = r.id
         where r.household_id = ${data.householdId}
         group by r.id, u.name
         order by r.period_start desc
      `;

      const alla = rader.map(tillAvstamning);
      const open = alla.find((a) => a.completedAt === null) ?? null;
      const lastCompleted = alla.find((a) => a.completedAt !== null) ?? null;

      // Startpunkten: senast avslutade avstämning, annars avtalets startdag.
      const [avtal] = await sql<{ start_date: string }[]>`
        select v.start_date from agreement_versions v
         where v.agreement_id = current_agreement_id(${data.householdId})
           and v.effective_at is not null
         order by v.version desc limit 1
      `;

      const fran = lastCompleted?.periodEnd ?? avtal?.start_date ?? iso(new Date());
      const nextDueOn = open?.dueOn ?? plusDagar(fran, PERIOD_DAGAR);

      const parter = await sql<{ party_id: string }[]>`
        select party_id from household_members where household_id = ${data.householdId}`;

      return {
        open,
        lastCompleted,
        nextDueOn,
        overdue: nextDueOn <= iso(new Date()),
        waitingFor: open
          ? parter.map((p) => p.party_id).filter((p) => !open.confirmedBy.includes(p))
          : [],
      };
    });
  });

/** Påbörjar en avstämning för perioden fram till i dag. */
export const startReconciliation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { user } = await medlem(data.householdId);
    const { asUser } = await import("@/lib/db/client.server");

    return asUser(user.id, async (sql) => {
      const [oppen] = await sql<{ id: string }[]>`
        select id from reconciliations
         where household_id = ${data.householdId} and completed_at is null`;
      if (oppen) return { id: oppen.id, redanPabörjad: true as const };

      const [senaste] = await sql<{ period_end: string }[]>`
        select period_end from reconciliations
         where household_id = ${data.householdId} and completed_at is not null
         order by period_end desc limit 1`;
      const [avtal] = await sql<{ start_date: string }[]>`
        select v.start_date from agreement_versions v
         where v.agreement_id = current_agreement_id(${data.householdId})
           and v.effective_at is not null
         order by v.version desc limit 1`;

      const start = senaste?.period_end ?? avtal?.start_date ?? iso(new Date());
      const slut = iso(new Date());

      const tom = Object.fromEntries(CHECKLISTA.map((p) => [p.nyckel, false]));

      const [rad] = await sql<{ id: string }[]>`
        insert into reconciliations
          (household_id, period_start, period_end, due_on, checklist, created_by)
        values (${data.householdId}, ${start}, ${slut},
                ${plusDagar(start, PERIOD_DAGAR)}, ${sql.json(tom)}, ${user.id})
        returning id
      `;

      await sql`
        insert into audit_events
          (household_id, event_type, entity_type, entity_id, actor_id, new_value)
        values (${data.householdId}, 'reconciliation.started', 'reconciliation', ${rad.id},
                ${user.id}, ${sql.json({ periodStart: start, periodEnd: slut } as never)})
      `;

      return { id: rad.id, redanPabörjad: false as const };
    });
  });

/** Bockar av eller ångrar en punkt i checklistan. */
export const setChecklistItem = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        reconciliationId: z.string().uuid(),
        key: z.enum(CHECKLISTA.map((p) => p.nyckel) as [string, ...string[]]),
        done: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { user } = await medlem(data.householdId);
    const { asUser } = await import("@/lib/db/client.server");

    await asUser(user.id, async (sql) => {
      await sql`
        update reconciliations
           set checklist = jsonb_set(checklist, ${[data.key]}, ${sql.json(data.done)})
         where id = ${data.reconciliationId} and household_id = ${data.householdId}
           and completed_at is null
      `;
    });
    return { ok: true as const };
  });

/**
 * Bekräftar avstämningen i eget namn.
 *
 * Att alla punkter är avbockade, och att perioden avslutas när båda bekräftat,
 * avgörs av databasen - inte här.
 */
export const confirmReconciliation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ householdId: z.string().uuid(), reconciliationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { user, partsroll } = await medlem(data.householdId);
    const { asUser } = await import("@/lib/db/client.server");
    const { enqueue } = await import("@/lib/mail/queue.server");

    const resultat = await asUser(user.id, async (sql) => {
      await sql`
        insert into reconciliation_confirmations (reconciliation_id, user_id, party_id)
        values (${data.reconciliationId}, ${user.id}, ${partsroll})
      `;

      const [rad] = await sql<{ completed_at: Date | null; period_end: string }[]>`
        select completed_at, period_end from reconciliations where id = ${data.reconciliationId}`;

      const motpart = await sql<{ user_id: string; party_id: string; email: string }[]>`
        select m.user_id, m.party_id, u.email
          from household_members m join users u on u.id = m.user_id
         where m.household_id = ${data.householdId} and m.user_id <> ${user.id}
      `;

      await sql`
        insert into audit_events
          (household_id, event_type, entity_type, entity_id, actor_id, new_value)
        values (${data.householdId}, 'reconciliation.confirmed', 'reconciliation',
                ${data.reconciliationId}, ${user.id}, ${sql.json({ partyId: partsroll } as never)})
      `;

      return { klar: rad?.completed_at !== null, motpart: motpart[0] ?? null };
    });

    // Motparten får besked när den första bekräftat, inte när båda gjort det.
    if (!resultat.klar && resultat.motpart) {
      await enqueue({
        idempotencyKey: `avstamning:${data.reconciliationId}:${resultat.motpart.party_id}`,
        template: "avstamning",
        to: resultat.motpart.email,
        householdId: data.householdId,
        recipientUserId: resultat.motpart.user_id,
        params: {
          beskrivning:
            "Din motpart har bekräftat kvartalsavstämningen. Den är klar när även du har gjort det.",
          url: `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/transaktioner/avstamning`,
        },
      });
    }

    return { ok: true as const, klar: resultat.klar };
  });
