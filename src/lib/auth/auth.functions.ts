import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

/**
 * Inloggning, utloggning och inbjudningar. Tjänsten är endast för inbjudna –
 * det finns ingen öppen registrering någonstans i flödet.
 */

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(400),
});

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => credentials.parse(input))
  .handler(async ({ data }) => {
    const { owner } = await import("@/lib/db/client.server");
    const { verifyPassword } = await import("./password");
    const { pruneSessions, startSession } = await import("./session.server");

    const rows = await owner()<
      { id: string; password_hash: string | null; disabled_at: Date | null }[]
    >`
      select id, password_hash, disabled_at from users where lower(email) = ${data.email}
    `;
    const user = rows[0];

    // Samma svar oavsett om kontot finns eller lösenordet är fel, så att
    // svaret inte avslöjar vilka e-postadresser som har konto.
    const ok = user?.password_hash
      ? !user.disabled_at && (await verifyPassword(data.password, user.password_hash))
      : false;
    if (!ok || !user) {
      throw new Error("Fel e-postadress eller lösenord.");
    }

    await pruneSessions();
    await startSession(user.id, getRequestHeader("user-agent") ?? undefined);
    return { ok: true as const };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { endSession } = await import("./session.server");
  await endSession();
  return { ok: true as const };
});

/** Uppgifterna bakom en inbjudningslänk, innan den accepteras. */
export const inviteDetails = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(10).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const { owner } = await import("@/lib/db/client.server");
    const { hashToken, isExpired } = await import("./tokens");

    const rows = await owner()<
      {
        email: string;
        display_name: string;
        household: string;
        expires_at: Date;
        accepted_at: Date | null;
        revoked_at: Date | null;
      }[]
    >`
      select i.email, i.display_name, h.name as household, i.expires_at, i.accepted_at, i.revoked_at
      from invites i join households h on h.id = i.household_id
      where i.token_hash = ${hashToken(data.token)}
    `;
    const invite = rows[0];
    if (!invite || invite.revoked_at || invite.accepted_at || isExpired(invite.expires_at)) {
      return { valid: false as const };
    }
    return {
      valid: true as const,
      email: invite.email,
      name: invite.display_name,
      household: invite.household,
    };
  });

/**
 * Accepterar en inbjudan och skapar kontot. Kör som ägare eftersom användaren
 * ännu inte finns och därför inte kan omfattas av radnivåsäkerheten.
 */
export const acceptInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(10).max(200),
        name: z.string().trim().min(1).max(80),
        password: z.string().min(8).max(400),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { owner } = await import("@/lib/db/client.server");
    const { hashPassword } = await import("./password");
    const { hashToken, isExpired } = await import("./tokens");
    const { startSession } = await import("./session.server");

    const sql = owner();
    const userId = await sql.begin(async (tx) => {
      const rows = await tx<
        {
          id: string;
          email: string;
          household_id: string;
          party_id: string;
          display_name: string;
          expires_at: Date;
          accepted_at: Date | null;
          revoked_at: Date | null;
        }[]
      >`
        select id, email, household_id, party_id, display_name, expires_at, accepted_at, revoked_at
        from invites where token_hash = ${hashToken(data.token)}
        for update
      `;
      const invite = rows[0];
      if (!invite || invite.revoked_at || invite.accepted_at || isExpired(invite.expires_at)) {
        throw new Error("Inbjudan är inte längre giltig.");
      }

      const passwordHash = await hashPassword(data.password);
      const [user] = await tx<{ id: string }[]>`
        insert into users (email, name, password_hash)
        values (${invite.email}, ${data.name}, ${passwordHash})
        on conflict (email) do update set name = excluded.name, password_hash = excluded.password_hash
        returning id
      `;

      await tx`
        insert into household_members (household_id, user_id, party_id, display_name)
        values (${invite.household_id}, ${user.id}, ${invite.party_id}, ${data.name})
        on conflict (household_id, user_id) do nothing
      `;
      await tx`
        update invites set accepted_at = now(), accepted_by = ${user.id} where id = ${invite.id}
      `;
      await tx`
        insert into audit_events (household_id, event_type, entity_type, entity_id, actor_id, new_value)
        values (${invite.household_id}, 'invite.accepted', 'user', ${user.id}, ${user.id},
                ${sql.json({ party_id: invite.party_id })})
      `;
      return user.id;
    });

    await startSession(userId, getRequestHeader("user-agent") ?? undefined);
    return { ok: true as const };
  });
