import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DemoNotice } from "@/components/demo-notice";
import { createFileRoute } from "@tanstack/react-router";
import { Check, CircleAlert } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { useHousehold } from "@/components/household-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useMyParty } from "@/hooks/use-my-party";
import { isDemo } from "@/lib/demo";
import { fmtDate, fmtDateTime } from "@/lib/format";
import {
  CHECKLISTA,
  confirmReconciliation,
  reconciliationState,
  setChecklistItem,
  startReconciliation,
} from "@/lib/reconciliation.functions";

export const Route = createFileRoute("/_authenticated/transaktioner/avstamning")({
  head: () => ({ meta: [{ title: "Kvartalsavstämning – Mitt & Ditt" }] }),
  component: AvstamningPage,
});

function AvstamningPage() {
  const { household } = useHousehold();
  const minPartsroll = useMyParty();
  const klient = useQueryClient();
  const householdId = household?.id as string;

  const query = useQuery({
    queryKey: ["reconciliation", householdId],
    queryFn: () => reconciliationState({ data: { householdId } }),
    enabled: !isDemo && Boolean(householdId),
  });

  const starta = useMutation({
    mutationFn: () => startReconciliation({ data: { householdId } }),
    onSuccess: () => void klient.invalidateQueries({ queryKey: ["reconciliation"] }),
    onError: (fel: Error) => toast.error(fel.message || "Kunde inte påbörja avstämningen."),
  });

  const bocka = useMutation({
    mutationFn: (args: { reconciliationId: string; key: string; done: boolean }) =>
      setChecklistItem({ data: { householdId, ...args } }),
    onSuccess: () => void klient.invalidateQueries({ queryKey: ["reconciliation"] }),
    onError: (fel: Error) => toast.error(fel.message || "Kunde inte spara."),
  });

  const bekrafta = useMutation({
    mutationFn: (reconciliationId: string) =>
      confirmReconciliation({ data: { householdId, reconciliationId } }),
    onSuccess: (svar) => {
      toast.success(
        svar.klar
          ? "Avstämningen är klar. En ny tremånadersperiod har börjat."
          : "Din bekräftelse är registrerad. Nu väntar vi på din motpart.",
      );
      void klient.invalidateQueries();
    },
    onError: (fel: Error) => toast.error(fel.message || "Kunde inte bekräfta avstämningen."),
  });

  const lage = query.data;
  const namn = Object.fromEntries((household?.parties ?? []).map((p) => [p.partyId, p.name]));

  return (
    <>
      <PageHeader
        eyebrow="Transaktioner"
        title="Kvartalsavstämning"
        description="Minst var tredje månad går ni igenom att allt är registrerat. Perioden är klar när ni båda bekräftat, och nästa förfallodag räknas därifrån."
      />

      {isDemo ? (
        <DemoNotice vad="Var tredje månad går ni igenom samma checklista var för sig – transaktioner, lånesaldo, skatteeffekter och underlag – och perioden avslutas först när båda bekräftat. Nästa förfallodag räknas från den senast avslutade avstämningen, inte från senaste posten." />
      ) : !lage ? (
        <EmptyState title="Läser in …" />
      ) : (
        <div className="grid gap-6">
          <section className="tile-surface p-5">
            <p className="eyebrow mb-2">Nästa avstämning</p>
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-serif text-lg">{fmtDate(lage.nextDueOn)}</p>
              {lage.overdue && (
                <Badge variant="destructive">
                  <CircleAlert className="mr-1 size-3" />
                  Förfallen
                </Badge>
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {lage.lastCompleted
                ? `Räknat från den senast avslutade avstämningen ${fmtDate(lage.lastCompleted.periodEnd)}.`
                : "Räknat från avtalets startdag, eftersom ingen avstämning avslutats än."}
            </p>
            {lage.open && lage.waitingFor.length > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                Väntar på: {lage.waitingFor.map((p) => namn[p] ?? p).join(", ")}
              </p>
            )}
          </section>

          {!lage.open ? (
            <section className="tile-surface p-5">
              <p className="mb-3 text-sm">
                Ingen avstämning är påbörjad. Starta en när ni gått igenom perioden tillsammans.
              </p>
              <Button disabled={starta.isPending} onClick={() => starta.mutate()}>
                Påbörja avstämning
              </Button>
            </section>
          ) : (
            <section className="tile-surface p-5">
              <p className="eyebrow mb-1">
                Period {fmtDate(lage.open.periodStart)} – {fmtDate(lage.open.periodEnd)}
              </p>
              <p className="mb-4 text-xs text-muted-foreground">
                Påbörjad av {lage.open.createdBy} {fmtDateTime(lage.open.createdAt)}
              </p>

              <ul className="grid gap-3">
                {CHECKLISTA.map((punkt) => {
                  const klar = lage.open?.checklist[punkt.nyckel] === true;
                  return (
                    <li key={punkt.nyckel} className="flex items-start gap-3">
                      <Checkbox
                        id={punkt.nyckel}
                        checked={klar}
                        disabled={bocka.isPending}
                        onCheckedChange={(v) =>
                          bocka.mutate({
                            reconciliationId: lage.open!.id,
                            key: punkt.nyckel,
                            done: v === true,
                          })
                        }
                      />
                      <label htmlFor={punkt.nyckel} className="text-sm leading-snug">
                        {punkt.text}
                      </label>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button
                  disabled={
                    bekrafta.isPending ||
                    !minPartsroll ||
                    lage.open.confirmedBy.includes(minPartsroll)
                  }
                  onClick={() => bekrafta.mutate(lage.open!.id)}
                >
                  <Check className="mr-1.5 size-4" />
                  {minPartsroll && lage.open.confirmedBy.includes(minPartsroll)
                    ? "Du har bekräftat"
                    : "Bekräfta avstämningen"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Alla punkter måste vara avbockade. Spärren ligger i databasen, så en bekräftelse
                  betyder alltid att listan var genomgången.
                </p>
              </div>
            </section>
          )}

          {lage.lastCompleted && (
            <section className="tile-surface p-5">
              <p className="eyebrow mb-2">Senast avslutade</p>
              <p className="text-sm">
                Period {fmtDate(lage.lastCompleted.periodStart)} –{" "}
                {fmtDate(lage.lastCompleted.periodEnd)}, klar{" "}
                {fmtDateTime(lage.lastCompleted.completedAt as string)}. Bekräftad av{" "}
                {lage.lastCompleted.confirmedBy.map((p) => namn[p] ?? p).join(" och ")}.
              </p>
            </section>
          )}
        </div>
      )}
    </>
  );
}
