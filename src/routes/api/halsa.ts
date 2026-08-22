import { createFileRoute } from "@tanstack/react-router";

/**
 * Hälsokontroll för övervakning.
 *
 * Två signaler hålls isär med flit. `status` säger om tjänsten fungerar för
 * användarna - appen svarar och databasen går att fråga. `mail` är en egen
 * signal: att mailservern strular är värt ett larm, men det gör inte tjänsten
 * nere, och ett larm som ropar "nere" när man i själva verket bara inte kan
 * skicka inbjudningar slutar man snart lyssna på.
 *
 * Svaret innehåller inga adresser, inga hemligheter och inget om hushållens
 * ekonomi. Det är avsiktligt öppet, eftersom en övervakare ska kunna nå det
 * utan inloggning.
 */
export const Route = createFileRoute("/api/halsa")({
  server: {
    handlers: {
      GET: async () => {
        const start = Date.now();

        let databas: "ok" | "nere" = "nere";
        let databasFel: string | undefined;
        let mail: "ok" | "eftersläpning" | "fel" | "okänd" = "okänd";
        let koLangd = 0;
        let misslyckadeIRad = 0;

        try {
          const { owner } = await import("@/lib/db/client.server");
          const sql = owner();
          await sql`select 1`;
          databas = "ok";

          // Mailkön: hur mycket ligger och väntar, och hur många av de senaste
          // försöken i rad som gett upp.
          const [ko] = await sql<{ vantar: number }[]>`
            select count(*)::int as vantar from mail_messages
             where status in ('pending', 'sending')`;
          koLangd = ko?.vantar ?? 0;

          const senaste = await sql<{ status: string }[]>`
            select status from mail_messages
             where status in ('sent', 'failed')
             order by coalesce(sent_at, failed_at) desc limit 5`;
          for (const rad of senaste) {
            if (rad.status === "failed") misslyckadeIRad += 1;
            else break;
          }

          mail = misslyckadeIRad >= 5 ? "fel" : koLangd > 50 ? "eftersläpning" : "ok";
        } catch (error) {
          // Bara felets art, aldrig anslutningssträngen.
          databasFel = error instanceof Error ? error.name : "okänt";
        }

        const kropp = {
          status: databas === "ok" ? "ok" : "nere",
          databas,
          ...(databasFel ? { databasFel } : {}),
          mail,
          mailKo: koLangd,
          mailMisslyckadeIRad: misslyckadeIRad,
          svarstidMs: Date.now() - start,
          tid: new Date().toISOString(),
        };

        return new Response(JSON.stringify(kropp), {
          // 503 bara när tjänsten faktiskt inte fungerar. Ett mailfel ger 200
          // med mail: "fel", så övervakningen kan larma på rätt sak.
          status: databas === "ok" ? 200 : 503,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
