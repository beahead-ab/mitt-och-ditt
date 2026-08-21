import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Administration: konton, hushåll och inbjudningar.
 *
 * Administratören hanterar åtkomst, inte innehåll. Att hen inte kommer åt
 * parternas ekonomi avgörs av radnivåsäkerheten, inte av de här funktionerna –
 * de kan bara göra det policyerna redan tillåter.
 */

async function admin() {
  const { readSession } = await import("@/lib/auth/session.server");
  const user = await readSession();
  if (!user) throw new Error("Ej inloggad.");
  if (!user.isAdmin) throw new Error("Kräver administratörsbehörighet.");
  return user;
}

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  hasPassword: boolean;
  disabledAt: string | null;
  createdAt: string;
  households: string[];
};

export const listUsers = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminUser[]> => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");

    return asUser(user.id, async (sql) => {
      const rows = await sql<
        {
          id: string;
          email: string;
          name: string;
          is_admin: boolean;
          password_hash: string | null;
          disabled_at: Date | null;
          created_at: Date;
        }[]
      >`select id, email, name, is_admin, password_hash, disabled_at, created_at
      from users order by created_at`;

      const members = await sql<{ user_id: string; household: string }[]>`
      select m.user_id, h.name as household
      from household_members m join households h on h.id = m.household_id`;

      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        isAdmin: row.is_admin,
        // Lösenordshashen lämnar aldrig servern; bara om den finns.
        hasPassword: row.password_hash !== null,
        disabledAt: row.disabled_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        households: members.filter((m) => m.user_id === row.id).map((m) => m.household),
      }));
    });
  },
);

export const setUserDisabled = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), disabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await admin();
    if (data.userId === user.id && data.disabled) {
      throw new Error("Du kan inte stänga av ditt eget konto.");
    }
    const { asUser } = await import("@/lib/db/client.server");
    await asUser(user.id, async (sql) => {
      await sql`
        update users set disabled_at = ${data.disabled ? sql`now()` : null}
        where id = ${data.userId}
      `;
      // Ett avstängt konto ska inte kunna fortsätta på en öppen session.
      if (data.disabled) await sql`delete from sessions where user_id = ${data.userId}`;
    });
    return { ok: true as const };
  });

export type AdminHousehold = {
  id: string;
  name: string;
  address: string | null;
  createdAt: string;
  members: { userId: string; partyId: string; name: string }[];
};

export const listHouseholdsAdmin = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminHousehold[]> => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");

    return asUser(user.id, async (sql) => {
      const rows = await sql<
        { id: string; name: string; address: string | null; created_at: Date }[]
      >`
        select h.id, h.name, p.address, h.created_at
        from households h left join properties p on p.household_id = h.id
        order by h.created_at
      `;
      const members = await sql<
        { household_id: string; user_id: string; party_id: string; display_name: string }[]
      >`select household_id, user_id, party_id, display_name from household_members`;

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        createdAt: row.created_at.toISOString(),
        members: members
          .filter((m) => m.household_id === row.id)
          .map((m) => ({ userId: m.user_id, partyId: m.party_id, name: m.display_name })),
      }));
    });
  },
);

export const saveProperty = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        address: z.string().trim().min(1).max(200),
        association: z.string().trim().max(200).optional(),
        apartmentNumber: z.string().trim().max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");
    await asUser(user.id, async (sql) => {
      const existing = await sql<{ id: string }[]>`
        select id from properties where household_id = ${data.householdId}`;
      if (existing[0]) {
        await sql`
          update properties
          set address = ${data.address}, association = ${data.association ?? null},
              apartment_number = ${data.apartmentNumber ?? null}
          where id = ${existing[0].id}
        `;
      } else {
        await sql`
          insert into properties (household_id, address, association, apartment_number)
          values (${data.householdId}, ${data.address}, ${data.association ?? null},
                  ${data.apartmentNumber ?? null})
        `;
      }
    });
    return { ok: true as const };
  });

export type AdminInvite = {
  id: string;
  email: string;
  displayName: string;
  partyId: string;
  household: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export const listInvites = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminInvite[]> => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");

    return asUser(user.id, async (sql) => {
      const rows = await sql<
        {
          id: string;
          email: string;
          display_name: string;
          party_id: string;
          household: string;
          created_at: Date;
          expires_at: Date;
          accepted_at: Date | null;
          revoked_at: Date | null;
        }[]
      >`
        select i.id, i.email, i.display_name, i.party_id, h.name as household,
               i.created_at, i.expires_at, i.accepted_at, i.revoked_at
        from invites i join households h on h.id = i.household_id
        order by i.created_at desc
      `;
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        partyId: row.party_id,
        household: row.household,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        acceptedAt: row.accepted_at?.toISOString() ?? null,
        revokedAt: row.revoked_at?.toISOString() ?? null,
      }));
    });
  },
);

/**
 * Skapar en inbjudan. Länken visas en enda gång – bara hashen sparas, så den
 * kan inte hämtas fram i efterhand.
 */
export const createInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        email: z.string().trim().toLowerCase().email().max(255),
        displayName: z.string().trim().min(1).max(80),
        partyId: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .regex(
            /^[a-z0-9_-]+$/,
            "Partsrollen får bara innehålla små bokstäver, siffror och bindestreck.",
          ),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");
    const { INVITE_DAYS, expiresIn, hashToken, newToken } = await import("@/lib/auth/tokens");

    const token = newToken();
    await asUser(user.id, async (sql) => {
      const taken = await sql<{ id: string }[]>`
        select id from household_members
        where household_id = ${data.householdId} and party_id = ${data.partyId}`;
      if (taken[0]) throw new Error("Partsrollen är redan upptagen i hushållet.");

      await sql`
        insert into invites
          (email, token_hash, household_id, party_id, display_name, invited_by, expires_at)
        values (${data.email}, ${hashToken(token)}, ${data.householdId}, ${data.partyId},
                ${data.displayName}, ${user.id}, ${expiresIn(INVITE_DAYS)})
      `;
    });

    return { token, expiresInDays: INVITE_DAYS };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ inviteId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");
    await asUser(user.id, async (sql) => {
      await sql`
        update invites set revoked_at = now()
        where id = ${data.inviteId} and accepted_at is null and revoked_at is null
      `;
    });
    return { ok: true as const };
  });
