import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

/** Klientens IP bakom proxyn. Används för försöksspärrarna. */
function klientIp(): string | undefined {
  return getRequestHeader("x-forwarded-for") ?? getRequestHeader("x-real-ip") ?? undefined;
}

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
    const { autentisera } = await import("./login.server");
    const { pruneSessions, startSession } = await import("./session.server");

    const ip = getRequestHeader("x-forwarded-for") ?? getRequestHeader("x-real-ip") ?? undefined;
    const { userId } = await autentisera(data.email, data.password, ip);

    await pruneSessions();
    await startSession(userId, getRequestHeader("user-agent") ?? undefined);
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
    const { loggaHändelse, räknaFörsök } = await import("./throttle.server");

    // En inbjudningstoken är en väg in i ett hushåll. Utan spärr går den att
    // gissa hur många gånger som helst. Kategorin fanns men användes inte.
    const spärr = await räknaFörsök("invite", { ip: klientIp() });
    if (!spärr.tillåtet) {
      await loggaHändelse("invite.spärrad", { ip: klientIp() });
      // Samma svar som en ogiltig länk: en spärr får inte avslöja att någon
      // gissat rätt.
      return { valid: false as const };
    }

    const rows = await owner()<
      {
        email: string;
        display_name: string;
        household: string;
        inviter: string | null;
        address: string | null;
        expires_at: Date;
        accepted_at: Date | null;
        revoked_at: Date | null;
      }[]
    >`
      select i.email, i.display_name, h.name as household,
             u.name as inviter, p.address,
             i.expires_at, i.accepted_at, i.revoked_at
      from invites i
      join households h on h.id = i.household_id
      left join users u on u.id = i.invited_by
      left join properties p on p.household_id = i.household_id
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
      // Vem som bjudit in och till vilken bostad. Utan det säger sidan bara
      // "skapa ett konto", och den som fått länken vet inte vad hen tackar ja
      // till. Adressen saknas innan uppstarten är gjord - då räcker
      // hushållets namn.
      inviter: invite.inviter,
      address: invite.address,
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
    const { loggaHändelse: logga, räknaFörsök: räkna } = await import("./throttle.server");

    // Samma spärr som vid uppslaget. Att acceptera är det som faktiskt skapar
    // kontot, så här är gissning som mest värd att stoppa.
    const spärr = await räkna("invite", { ip: klientIp() });
    if (!spärr.tillåtet) {
      await logga("invite.spärrad", { ip: klientIp() });
      throw new Error("Inbjudan är inte längre giltig.");
    }

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
      // Att lösa in en länk som skickats till adressen är samma bevis som
      // bekräftelsemailet ger. Den som kommer in genom en inbjudan ska inte
      // behöva bekräfta en gång till.
      const [user] = await tx<{ id: string }[]>`
        insert into users (email, name, password_hash, email_verified_at)
        values (${invite.email}, ${data.name}, ${passwordHash}, now())
        on conflict (email) do update
          set name = excluded.name,
              password_hash = excluded.password_hash,
              email_verified_at = coalesce(users.email_verified_at, now())
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

    try {
      const { notifieraMotpartAccepterade } = await import("@/lib/mail/handelser.server");
      const { owner } = await import("@/lib/db/client.server");
      const [inbjudan] = await owner()<
        { household_id: string; invited_by: string | null; namn: string }[]
      >`
        select i.household_id, i.invited_by, m.display_name as namn
          from invites i
          join household_members m
            on m.household_id = i.household_id and m.user_id = ${userId}
         where i.accepted_by = ${userId}
         order by i.accepted_at desc limit 1`;
      if (inbjudan?.invited_by) {
        await notifieraMotpartAccepterade({
          householdId: inbjudan.household_id,
          inbjudarensUserId: inbjudan.invited_by,
          motpartensNamn: inbjudan.namn,
        });
      }
    } catch {
      // Kontot är redan skapat; ett uteblivet besked får inte fälla det.
    }

    await startSession(userId, getRequestHeader("user-agent") ?? undefined);
    return { ok: true as const };
  });
