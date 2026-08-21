import { createFileRoute } from "@tanstack/react-router";

/** Uppladdning av underlag. Binärt innehåll, därför en serverrutt. */
export const Route = createFileRoute("/api/bilaga/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const fail = (message: string, status = 400) =>
          new Response(JSON.stringify({ error: message }), {
            status,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });

        const { readSession } = await import("@/lib/auth/session.server");
        const user = await readSession();
        if (!user) return fail("Ej inloggad.", 401);

        const form = await request.formData();
        const file = form.get("file");
        const householdId = String(form.get("householdId") ?? "");
        const reference = form.get("reference");

        if (!(file instanceof File)) return fail("Ingen fil bifogad.");
        if (!/^[0-9a-f-]{36}$/i.test(householdId)) return fail("Ogiltigt hushåll.");

        const { MAX_BYTES, storeAttachment } = await import("@/lib/db/attachments.server");
        if (file.size > MAX_BYTES) return fail("Filen är för stor.", 413);

        try {
          const bytes = Buffer.from(await file.arrayBuffer());
          const result = await storeAttachment(
            user.id,
            householdId,
            reference ? String(reference) : null,
            { name: file.name, type: file.type, bytes },
          );
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        } catch (error) {
          return fail(error instanceof Error ? error.message : "Uppladdningen misslyckades.");
        }
      },
    },
  },
});
