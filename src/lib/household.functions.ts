import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Hushållets underlag. All åtkomst går genom radnivåsäkerheten med den
 * inloggades identitet – serverfunktionen väljer aldrig själv vad som får ses.
 */
export const listHouseholds = createServerFn({ method: "GET" }).handler(async () => {
  const { readSession } = await import("@/lib/auth/session.server");
  const { myHouseholds } = await import("@/lib/db/household.server");
  const user = await readSession();
  if (!user) return [];
  return myHouseholds(user.id);
});

export const getHousehold = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { loadHousehold } = await import("@/lib/db/household.server");
    const user = await readSession();
    if (!user) return null;

    const household = await loadHousehold(user.id, data.householdId);
    if (!household) return null;

    // Map serialiseras inte över nätet, så versionerna skickas som par.
    return { ...household, revisions: [...household.revisions.entries()] };
  });

export type PartnerInvite = {
  id: string;
  email: string;
  displayName: string;
  partyId: "caesar" | "felicia";
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdByMe: boolean;
};

async function signedIn() {
  const { readSession } = await import("@/lib/auth/session.server");
  const user = await readSession();
  if (!user) throw new Error("Ej inloggad.");
  return user;
}

/** Inbjudningarna till den inloggades eget hushåll. RLS gör urvalet. */
export const listPartnerInvites = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<PartnerInvite[]> => {
    const user = await signedIn();
    const { asUser } = await import("@/lib/db/client.server");

    return asUser(user.id, async (sql) => {
      const rows = await sql<
        {
          id: string;
          email: string;
          display_name: string;
          party_id: "caesar" | "felicia";
          created_at: Date;
          expires_at: Date;
          accepted_at: Date | null;
          revoked_at: Date | null;
          invited_by: string | null;
        }[]
      >`
        select id, email, display_name, party_id, created_at, expires_at,
               accepted_at, revoked_at, invited_by
        from invites
        where household_id = ${data.householdId}
          and party_id in ('caesar', 'felicia')
        order by created_at desc
      `;

      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        partyId: row.party_id,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        acceptedAt: row.accepted_at?.toISOString() ?? null,
        revokedAt: row.revoked_at?.toISOString() ?? null,
        createdByMe: row.invited_by === user.id,
      }));
    });
  });

/**
 * Skapar länken till den saknade motparten. Partsrollen bestäms på servern av
 * vem som är inloggad; klienten kan alltså inte själv välja eller hitta på en
 * roll. Databaspolicyn upprepar samma kontroll som ett andra skyddslager.
 */
export const createPartnerInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        email: z.string().trim().toLowerCase().email().max(255),
        displayName: z.string().trim().min(1).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await signedIn();
    const { asUser } = await import("@/lib/db/client.server");
    const { INVITE_DAYS, expiresIn, hashToken, newToken } = await import("@/lib/auth/tokens");
    const { köaInbjudan } = await import("@/lib/mail/invites.server");
    const token = newToken();
    const giltigTill = expiresIn(INVITE_DAYS);

    const skapad = await asUser(user.id, async (sql) => {
      const [membership] = await sql<{ party_id: string }[]>`
        select party_id from household_members
        where household_id = ${data.householdId} and user_id = ${user.id}
      `;
      if (!membership) throw new Error("Du tillhör inte hushållet.");

      const targetParty =
        membership.party_id === "caesar"
          ? "felicia"
          : membership.party_id === "felicia"
            ? "caesar"
            : null;
      if (!targetParty) throw new Error("Din partsroll kan inte bjuda in en motpart.");

      const [occupied] = await sql<{ id: string }[]>`
        select id from household_members
        where household_id = ${data.householdId} and party_id = ${targetParty}
      `;
      if (occupied) throw new Error("Motparten är redan ansluten till hushållet.");

      const [open] = await sql<{ id: string }[]>`
        select id from invites
        where household_id = ${data.householdId} and party_id = ${targetParty}
          and accepted_at is null and revoked_at is null and expires_at > now()
      `;
      if (open) {
        throw new Error(
          "Det finns redan en giltig inbjudan. Återkalla den först om adressen är fel.",
        );
      }

      const [invite] = await sql<{ id: string }[]>`
        insert into invites
          (email, token_hash, household_id, party_id, display_name, invited_by, expires_at)
        values (${data.email}, ${hashToken(token)}, ${data.householdId}, ${targetParty},
                ${data.displayName}, ${user.id}, ${giltigTill})
        returning id
      `;
      await sql`
        insert into audit_events
          (household_id, event_type, entity_type, entity_id, actor_id, new_value)
        values (
          ${data.householdId}, 'invite.created', 'invite', ${invite.id}, ${user.id},
          ${sql.json({ partyId: targetParty, email: data.email } as never)}
        )
      `;

      const [hushall] = await sql<{ name: string }[]>`
        select name from households where id = ${data.householdId}`;
      return { id: invite.id, hushall: hushall?.name ?? "hushållet" };
    });

    // Mailet köas efter att inbjudan finns. Krånglar köandet visas länken ändå
    // i gränssnittet, så flödet aldrig fastnar på att mailet inte gick.
    await köaInbjudan({
      inviteId: skapad.id,
      email: data.email,
      namn: data.displayName,
      hushall: skapad.hushall,
      token,
      giltigTill,
      householdId: data.householdId,
    });

    return { token, expiresInDays: INVITE_DAYS };
  });

export const revokePartnerInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ inviteId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const user = await signedIn();
    const { asUser } = await import("@/lib/db/client.server");
    const { avbrytInbjudningsmail } = await import("@/lib/mail/invites.server");

    await asUser(user.id, async (sql) => {
      const rows = await sql<{ id: string; household_id: string; party_id: string }[]>`
        update invites set revoked_at = now()
        where id = ${data.inviteId} and invited_by = ${user.id}
          and accepted_at is null and revoked_at is null
        returning id, household_id, party_id
      `;
      if (!rows[0]) throw new Error("Inbjudan kan inte återkallas.");
      await sql`
        insert into audit_events
          (household_id, event_type, entity_type, entity_id, actor_id, new_value)
        values (
          ${rows[0].household_id}, 'invite.revoked', 'invite', ${rows[0].id}, ${user.id},
          ${sql.json({ partyId: rows[0].party_id } as never)}
        )
      `;
    });

    await avbrytInbjudningsmail(data.inviteId);
    return { ok: true as const };
  });
