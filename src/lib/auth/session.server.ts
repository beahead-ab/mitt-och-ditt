import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import { owner } from "@/lib/db/client.server";
import { SESSION_DAYS, expiresIn, hashToken, isExpired, newToken } from "./tokens";

export const SESSION_COOKIE = "mittochditt_session";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  /** Bekräftad adress krävs för att skapa ett hushåll eller bli part i ett. */
  emailVerified: boolean;
};

/**
 * Sessionerna slås upp med ägarrollen. Det är avsiktligt och den enda platsen
 * där radnivåsäkerheten kringgås: uppslaget sker innan vi vet vem användaren
 * är, så det finns ingen identitet att filtrera på än.
 */
export async function readSession(): Promise<SessionUser | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;

  const sql = owner();
  const rows = await sql<
    {
      user_id: string;
      email: string;
      name: string;
      is_admin: boolean;
      email_verified_at: Date | null;
      expires_at: Date;
      disabled_at: Date | null;
    }[]
  >`
    select s.user_id, s.expires_at, u.email, u.name, u.is_admin, u.email_verified_at,
           u.disabled_at
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)}
  `;

  const row = rows[0];
  if (!row) return null;
  if (isExpired(row.expires_at) || row.disabled_at) {
    await sql`delete from sessions where token_hash = ${hashToken(token)}`;
    return null;
  }

  // Rullande giltighet: sessionen förlängs så länge den används.
  await sql`
    update sessions
    set last_seen_at = now(), expires_at = ${expiresIn(SESSION_DAYS)}
    where token_hash = ${hashToken(token)}
  `;

  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    isAdmin: row.is_admin,
    emailVerified: row.email_verified_at !== null,
  };
}

export async function startSession(userId: string, userAgent?: string): Promise<void> {
  const token = newToken();
  const expires = expiresIn(SESSION_DAYS);
  await owner()`
    insert into sessions (token_hash, user_id, expires_at, user_agent)
    values (${hashToken(token)}, ${userId}, ${expires}, ${userAgent ?? null})
  `;

  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // I utveckling går trafiken över http; i drift alltid över https.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<void> {
  const token = getCookie(SESSION_COOKIE);
  if (token) {
    await owner()`delete from sessions where token_hash = ${hashToken(token)}`;
  }
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

/** Rensar utgångna sessioner. Körs vid inloggning, så ingen schemaläggning behövs. */
export async function pruneSessions(): Promise<void> {
  await owner()`delete from sessions where expires_at < now()`;
}
