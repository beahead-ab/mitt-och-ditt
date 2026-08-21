import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

/** Den inloggades egna uppgifter. */

export type AccountDetails = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  households: { name: string; partyId: string }[];
  sessions: number;
};

export const myAccount = createServerFn({ method: "GET" }).handler(
  async (): Promise<AccountDetails | null> => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const user = await readSession();
    if (!user) return null;

    return asUser(user.id, async (sql) => {
      const households = await sql<{ name: string; party_id: string }[]>`
        select h.name, m.party_id
        from household_members m join households h on h.id = m.household_id
        where m.user_id = ${user.id}
      `;
      const [count] = await sql<{ n: string }[]>`
        select count(*)::text as n from sessions where user_id = ${user.id}`;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        households: households.map((h) => ({ name: h.name, partyId: h.party_id })),
        sessions: Number(count.n),
      };
    });
  },
);

export const updateName = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ name: z.string().trim().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const user = await readSession();
    if (!user) throw new Error("Ej inloggad.");

    await asUser(user.id, async (sql) => {
      await sql`update users set name = ${data.name} where id = ${user.id}`;
      // Visningsnamnet i hushållet följer med, så att motparten ser samma namn.
      await sql`update household_members set display_name = ${data.name} where user_id = ${user.id}`;
    });
    return { ok: true as const };
  });

/**
 * Byter lösenord. Det nuvarande krävs, så att någon som kommit över en öppen
 * session inte kan låsa ute kontots ägare. Alla andra sessioner avslutas.
 */
export const changePassword = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        current: z.string().min(1).max(400),
        next: z.string().min(MIN_PASSWORD_LENGTH).max(400),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { getCookie } = await import("@tanstack/react-start/server");
    const { readSession, SESSION_COOKIE } = await import("@/lib/auth/session.server");
    const { owner } = await import("@/lib/db/client.server");
    const { hashPassword, verifyPassword } = await import("@/lib/auth/password");
    const { hashToken } = await import("@/lib/auth/tokens");

    const user = await readSession();
    if (!user) throw new Error("Ej inloggad.");

    const sql = owner();
    const rows = await sql<{ password_hash: string | null }[]>`
      select password_hash from users where id = ${user.id}`;
    const stored = rows[0]?.password_hash;
    if (!stored || !(await verifyPassword(data.current, stored))) {
      throw new Error("Nuvarande lösenord stämmer inte.");
    }
    if (await verifyPassword(data.next, stored)) {
      throw new Error("Det nya lösenordet måste skilja sig från det nuvarande.");
    }

    const hash = await hashPassword(data.next);
    const token = getCookie(SESSION_COOKIE);

    await sql.begin(async (tx) => {
      await tx`update users set password_hash = ${hash} where id = ${user.id}`;
      // Den här sessionen får vara kvar; alla andra avslutas.
      if (token) {
        await tx`delete from sessions
          where user_id = ${user.id} and token_hash <> ${hashToken(token)}`;
      } else {
        await tx`delete from sessions where user_id = ${user.id}`;
      }
    });

    return { ok: true as const };
  });
