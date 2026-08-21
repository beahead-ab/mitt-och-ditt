import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Sessions- och inbjudningstoken. Klartexten lämnar servern en enda gång –
 * till kakan eller till inbjudningslänken. Databasen lagrar bara hashen, så
 * en läckt databasdump ger ingen tillgång.
 */
const TOKEN_BYTES = 32;

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Jämför två hashar i konstant tid. */
export function tokenMatches(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/** Sessionens livslängd. Förlängs vid användning. */
export const SESSION_DAYS = 30;
/** En inbjudan är kortlivad med flit. */
export const INVITE_DAYS = 7;

export function expiresIn(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isExpired(expiresAt: Date | string, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}
