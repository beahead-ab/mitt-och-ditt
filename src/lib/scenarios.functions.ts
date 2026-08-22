import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Sparade simulatorscenarier.
 *
 * Ett scenario är indata till en beräkning som visas, inget annat. Det ändrar
 * aldrig avtalet, transaktionerna eller andelarna - simulatorn skriver inte till
 * något av det, och tabellen har ingen koppling dit. Att ett scenario är valt
 * som utgångspunkt påverkar bara vilket antagande översiktens prognos använder,
 * och översikten säger att det är ett antagande.
 */

export type Scenario = {
  id: string;
  name: string;
  endDate: string;
  endValueOre: number;
  endLoanOre: number;
  saleCostsOre: number;
  spreadPercent: number;
  isDefault: boolean;
  createdBy: string;
  updatedAt: string;
};

const antaganden = {
  name: z.string().trim().min(1).max(60),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endValueOre: z.number().int().min(0),
  endLoanOre: z.number().int().min(0),
  saleCostsOre: z.number().int().min(0),
  spreadPercent: z.number().min(0).max(99),
};

async function medlem(householdId: string) {
  const { readSession } = await import("@/lib/auth/session.server");
  const { asUser } = await import("@/lib/db/client.server");
  const user = await readSession();
  if (!user) throw new Error("Ej inloggad.");

  const hor = await asUser(user.id, async (sql) => {
    const [rad] = await sql<{ user_id: string }[]>`
      select user_id from household_members
       where household_id = ${householdId} and user_id = ${user.id}`;
    return Boolean(rad);
  });
  if (!hor) throw new Error("Du tillhör inte hushållet.");
  return user;
}

export const listScenarios = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<Scenario[]> => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const user = await readSession();
    if (!user) return [];

    return asUser(user.id, async (sql) => {
      const rader = await sql<
        {
          id: string;
          name: string;
          end_date: string;
          end_value_ore: string;
          end_loan_ore: string;
          sale_costs_ore: string;
          spread_percent: string;
          is_default: boolean;
          created_by_name: string;
          updated_at: Date;
        }[]
      >`
        select s.id, s.name, s.end_date, s.end_value_ore, s.end_loan_ore, s.sale_costs_ore,
               s.spread_percent, s.is_default, u.name as created_by_name, s.updated_at
          from simulator_scenarios s join users u on u.id = s.created_by
         where s.household_id = ${data.householdId}
         order by s.is_default desc, s.created_at desc
      `;

      return rader.map((r) => ({
        id: r.id,
        name: r.name,
        endDate: String(r.end_date).slice(0, 10),
        endValueOre: Number(r.end_value_ore),
        endLoanOre: Number(r.end_loan_ore),
        saleCostsOre: Number(r.sale_costs_ore),
        spreadPercent: Number(r.spread_percent),
        isDefault: r.is_default,
        createdBy: r.created_by_name,
        updatedAt: r.updated_at.toISOString(),
      }));
    });
  });

export const saveScenario = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ householdId: z.string().uuid(), ...antaganden }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await medlem(data.householdId);
    const { asUser } = await import("@/lib/db/client.server");

    return asUser(user.id, async (sql) => {
      // Samma namn skriver över samma scenario. Att spara två med samma namn
      // hade bara gjort listan svår att läsa.
      const [rad] = await sql<{ id: string }[]>`
        insert into simulator_scenarios
          (household_id, name, end_date, end_value_ore, end_loan_ore, sale_costs_ore,
           spread_percent, created_by)
        values (${data.householdId}, ${data.name}, ${data.endDate}, ${data.endValueOre},
                ${data.endLoanOre}, ${data.saleCostsOre}, ${data.spreadPercent}, ${user.id})
        on conflict (household_id, name) do update
          set end_date = excluded.end_date,
              end_value_ore = excluded.end_value_ore,
              end_loan_ore = excluded.end_loan_ore,
              sale_costs_ore = excluded.sale_costs_ore,
              spread_percent = excluded.spread_percent,
              updated_at = now()
        returning id
      `;
      return { id: rad.id };
    });
  });

/**
 * Väljer vilket scenario översikten ska räkna prognosen på.
 *
 * Ett villkorat unikt index hindrar att två rader är utgångspunkt samtidigt, så
 * den gamla nollställs först. Med `null` används inget sparat scenario alls.
 */
export const setDefaultScenario = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        scenarioId: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await medlem(data.householdId);
    const { asUser } = await import("@/lib/db/client.server");

    await asUser(user.id, async (sql) => {
      await sql`
        update simulator_scenarios set is_default = false
         where household_id = ${data.householdId} and is_default`;
      if (data.scenarioId) {
        await sql`
          update simulator_scenarios set is_default = true, updated_at = now()
           where id = ${data.scenarioId} and household_id = ${data.householdId}`;
      }
    });
    return { ok: true as const };
  });

export const deleteScenario = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ householdId: z.string().uuid(), scenarioId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await medlem(data.householdId);
    const { asUser } = await import("@/lib/db/client.server");

    await asUser(user.id, async (sql) => {
      await sql`
        delete from simulator_scenarios
         where id = ${data.scenarioId} and household_id = ${data.householdId}`;
    });
    return { ok: true as const };
  });
