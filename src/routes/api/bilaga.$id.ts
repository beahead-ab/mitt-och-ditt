import { createFileRoute } from "@tanstack/react-router";

/**
 * Nedladdning av en bilaga. Filen ligger utanför webbroten och når ingen utan
 * att först passera radnivåsäkerheten – en gissad URL ger 404, oavsett om
 * bilagan finns eller inte.
 */
export const Route = createFileRoute("/api/bilaga/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const notFound = new Response("Bilagan finns inte.", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });

        if (!/^[0-9a-f-]{36}$/i.test(params.id)) return notFound;

        const { readSession } = await import("@/lib/auth/session.server");
        const user = await readSession();
        if (!user) return notFound;

        const { readAttachment } = await import("@/lib/db/attachments.server");
        const attachment = await readAttachment(user.id, params.id);
        if (!attachment) return notFound;

        return new Response(new Uint8Array(attachment.bytes), {
          headers: {
            "Content-Type": attachment.meta.contentType,
            "Content-Length": String(attachment.meta.byteSize),
            // Underlag ska visas, inte köras. inline med sniffskydd.
            "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.meta.filename)}`,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; img-src 'self'; object-src 'none'",
            // Privat innehåll får aldrig mellanlagras av ombud.
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
