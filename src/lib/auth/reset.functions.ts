import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

/**
 * Glömt och återställt lösenord.
 *
 * Tunna omslag. Logiken ligger i reset.server.ts, fri från förfrågan och svar,
 * så att den går att pröva rakt av.
 */

function klientIp(): string | undefined {
  return getRequestHeader("x-forwarded-for") ?? getRequestHeader("x-real-ip") ?? undefined;
}

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().toLowerCase().email().max(255) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { begärÅterställning, NEUTRALT_SVAR } = await import("./reset.server");
    try {
      await begärÅterställning(data.email, klientIp());
    } catch {
      // Även ett oväntat fel besvaras likadant. Skillnader i svar är just det
      // som gör ett sådant här formulär till ett sätt att kartlägga konton.
    }
    return { ok: true as const, message: NEUTRALT_SVAR };
  });

export const resetTokenStatus = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(10).max(200) }).parse(input))
  .handler(async ({ data }): Promise<{ valid: boolean }> => {
    const { tokenÄrGiltig } = await import("./reset.server");
    return { valid: await tokenÄrGiltig(data.token) };
  });

export const completePasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(10).max(200),
        password: z.string().min(8).max(400),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { genomförÅterställning } = await import("./reset.server");
    await genomförÅterställning(data.token, data.password, klientIp());
    return { ok: true as const };
  });
