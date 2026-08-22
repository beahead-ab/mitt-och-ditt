import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { MIN_PASSWORD_LENGTH } from "./password";

/**
 * Registrering, bekräftelse och det första hushållet.
 *
 * Tunna omslag. Logiken ligger i register.server.ts, fri från förfrågan och
 * svar, så att den går att pröva rakt av.
 */

function klientIp(): string | undefined {
  return getRequestHeader("x-forwarded-for") ?? getRequestHeader("x-real-ip") ?? undefined;
}

/** Om formuläret ens ska visas. */
export const registrationOpen = createServerFn({ method: "GET" }).handler(async () => {
  const { registreringÄrÖppen } = await import("./register.server");
  return { open: registreringÄrÖppen() };
});

export const register = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().trim().toLowerCase().email().max(255),
        name: z.string().trim().min(1).max(80),
        password: z.string().min(MIN_PASSWORD_LENGTH).max(400),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { registrera } = await import("./register.server");
    return registrera(data.email, data.name, data.password, klientIp());
  });

/**
 * Löser in bekräftelselänken och loggar in på samma gång. Den som just bevisat
 * att adressen är hens ska inte mötas av ett inloggningsformulär.
 */
export const confirmEmail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(10).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const { bekräfta } = await import("./register.server");
    const { startSession } = await import("./session.server");

    const svar = await bekräfta(data.token, klientIp());
    if (!svar) return { ok: false as const };

    await startSession(svar.userId, getRequestHeader("user-agent") ?? undefined);
    return { ok: true as const };
  });

/**
 * Skapar hushållet och gör den inloggade till dess första part.
 *
 * Rollerna är 'a' och 'b'; vad parterna heter står i display_name, där ett
 * namn hör hemma. Motparten kommer in genom en inbjudan - aldrig genom att
 * någon lägger till hen.
 *
 * Radnivåsäkerheten upprepar varje villkor här som ett andra skyddslager: att
 * adressen är bekräftad, att hushållet ännu saknar parter, och taket för hur
 * många hushåll en person får skapa.
 */
export const createOwnHousehold = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ name: z.string().trim().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { readSession } = await import("./session.server");
    const { asUser } = await import("@/lib/db/client.server");

    const user = await readSession();
    if (!user) throw new Error("Ej inloggad.");

    return asUser(user.id, async (sql) => {
      const [verifierad] = await sql<{ email_verified_at: Date | null }[]>`
        select email_verified_at from users where id = ${user.id}`;
      if (!verifierad?.email_verified_at) {
        throw new Error("Bekräfta din e-postadress först. Länken ligger i din inkorg.");
      }

      const [household] = await sql<{ id: string }[]>`
        insert into households (name, party_a, party_b, created_by)
        values (${data.name}, 'a', 'b', ${user.id})
        returning id
      `;

      await sql`
        insert into household_members (household_id, user_id, party_id, display_name)
        values (${household.id}, ${user.id}, 'a', ${user.name})
      `;

      // Tomt avtalsskal, precis som när administratören lägger upp ett hushåll.
      // Skalet bär inget innehåll; innehållet kräver båda parters godkännande.
      await sql`insert into agreements (household_id) values (${household.id})`;

      await sql`
        insert into audit_events (household_id, event_type, entity_type, entity_id, actor_id)
        values (${household.id}, 'household.created', 'household', ${household.id}, ${user.id})
      `;

      return { id: household.id };
    });
  });
