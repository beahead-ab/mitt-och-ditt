import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Komplett revisionspaket. Tunt omslag; logiken ligger i
 * revisionspaket.server.ts och går därför att pröva rakt av.
 */
export type { Paketfil, Revisionspaket, PaketFel } from "./revisionspaket.server";

export const revisionPackage = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { byggRevisionspaket } = await import("./revisionspaket.server");

    const user = await readSession();
    if (!user) return { ok: false as const, skal: "Ej inloggad." };
    return byggRevisionspaket(user.id, data.householdId);
  });
