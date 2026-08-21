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
