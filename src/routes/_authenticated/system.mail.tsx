import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isDemo } from "@/lib/demo";
import { fmtDateTime } from "@/lib/format";
import { listMail, retryMail, type MailRad } from "@/lib/mail.functions";

export const Route = createFileRoute("/_authenticated/system/mail")({
  head: () => ({ meta: [{ title: "Mailstatus – Mitt & Ditt" }] }),
  component: MailPage,
});

/** Mallnamnen är korta i databasen; här står vad de betyder. */
const MALLTEXT: Record<string, string> = {
  inbjudan: "Inbjudan",
  inbjudan_ny: "Ny inbjudan",
  losenord_aterstall: "Återställ lösenord",
  losenord_bytt: "Lösenordet ändrat",
  motpart_accepterade: "Motparten anslöt",
  post_vantar: "Post väntar på beslut",
  post_beslutad: "Beslut om post",
  dokument_vantar: "Dokument väntar på godkännande",
  processdag: "Processdag",
  avstamning: "Kvartalsavstämning",
  veckosammanfattning: "Veckosammanfattning",
  konto_status: "Kontots status",
};

const STATUSTEXT: Record<MailRad["status"], { text: string; ton: "vantar" | "klar" | "fel" }> = {
  pending: { text: "Väntar", ton: "vantar" },
  sending: { text: "Skickas", ton: "vantar" },
  sent: { text: "Levererat", ton: "klar" },
  failed: { text: "Gav upp", ton: "fel" },
  cancelled: { text: "Avbrutet", ton: "vantar" },
};

function MailPage() {
  const klient = useQueryClient();

  const query = useQuery({
    queryKey: ["mail"],
    queryFn: () => listMail(),
    enabled: !isDemo,
    // Kön rör sig av sig själv, så vyn hämtar om med jämna mellanrum.
    refetchInterval: 15_000,
  });

  const forsokIgen = useMutation({
    mutationFn: (id: string) => retryMail({ data: { id } }),
    onSuccess: (svar) => {
      if (svar.ok) {
        toast.success(svar.message);
        void klient.invalidateQueries({ queryKey: ["mail"] });
      } else {
        toast.error(svar.message);
      }
    },
    onError: (fel: Error) => toast.error(fel.message),
  });

  const rader = query.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Systemadmin"
        title="Mailstatus"
        description="Leveransen av tjänstens mail. Innehållet visas aldrig här – det ligger krypterat och oåtkomligt tills mailet gått fram."
      />

      {isDemo ? (
        <EmptyState title="Demoläge" hint="Mailkön kräver databas." />
      ) : rader.length === 0 ? (
        <EmptyState
          title="Inga mail ännu"
          hint="Här listas inbjudningar, återställningar och besked när de köats."
        />
      ) : (
        <section className="tile-surface overflow-x-auto p-0">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--hairline)] text-left">
                <th className="px-4 py-3 font-medium">Tidpunkt</th>
                <th className="px-4 py-3 font-medium">Mottagare</th>
                <th className="px-4 py-3 font-medium">Mall</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Försök</th>
                <th className="px-4 py-3 font-medium">Anmärkning</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rader.map((rad) => {
                const status = STATUSTEXT[rad.status];
                return (
                  <tr key={rad.id} className="border-b border-[var(--hairline)] last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      {fmtDateTime(rad.sentAt ?? rad.createdAt)}
                    </td>
                    <td className="px-4 py-3">{rad.recipient}</td>
                    <td className="px-4 py-3">{MALLTEXT[rad.template] ?? rad.template}</td>
                    <td className="px-4 py-3">
                      <Badge variant={status.ton === "fel" ? "destructive" : "secondary"}>
                        {status.text}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {rad.attempts} / {rad.maxAttempts}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{rad.lastError ?? "–"}</td>
                    <td className="px-4 py-3 text-right">
                      {rad.status === "failed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={forsokIgen.isPending}
                          onClick={() => forsokIgen.mutate(rad.id)}
                        >
                          <RefreshCw className="mr-1.5 size-3.5" />
                          Försök igen
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
