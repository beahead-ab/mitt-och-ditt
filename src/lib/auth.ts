import { DEMO_USER, isDemo } from "@/lib/demo";

export type SessionUser = {
  id: string;
  email: string | null;
  /** Vilken part i hushållet användaren är. Styr vad hen får godkänna. */
  partyId: string | null;
};

/**
 * Sessionshantering. I demoläge finns en fast användare. Riktig inloggning –
 * inbjudningsbaserade konton med cookie-session mot Postgres – byggs i etapp 2.
 */
export async function currentUser(): Promise<SessionUser | null> {
  if (isDemo) {
    return { id: DEMO_USER.id, email: DEMO_USER.email, partyId: DEMO_USER.partyId };
  }
  return null;
}

export async function signOut(): Promise<void> {
  // Etapp 2: rensar sessionskakan på servern.
}
