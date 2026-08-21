import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Bilagorna i ett hushåll. Radnivåsäkerheten gör urvalet. */
export const listAttachmentsFn = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { listAttachments } = await import("@/lib/db/attachments.server");
    const user = await readSession();
    if (!user) return [];
    return listAttachments(user.id, data.householdId);
  });

export const redactAttachmentFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ attachmentId: z.string().uuid(), reason: z.string().trim().min(3).max(400) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { redactAttachment } = await import("@/lib/db/attachments.server");
    const user = await readSession();
    if (!user) throw new Error("Ej inloggad.");
    await redactAttachment(user.id, data.attachmentId, data.reason);
    return { ok: true as const };
  });
