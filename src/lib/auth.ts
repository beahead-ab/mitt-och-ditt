import { createServerFn } from "@tanstack/react-start";

import { DEMO_USER, isDemo } from "@/lib/demo";

export type SessionUser = {
  id: string;
  email: string | null;
  name: string;
  isAdmin: boolean;
};

/** Läser sessionen på servern. I demoläge finns en fast användare. */
export const currentUserFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionUser | null> => {
    const { readSession } = await import("@/lib/auth/session.server");
    const user = await readSession();
    return user ? { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin } : null;
  },
);

export async function currentUser(): Promise<SessionUser | null> {
  if (isDemo) {
    return { id: DEMO_USER.id, email: DEMO_USER.email, name: "Caesar", isAdmin: true };
  }
  return currentUserFn();
}
