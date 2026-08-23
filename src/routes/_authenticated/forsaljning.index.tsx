import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DemoNotice } from "@/components/demo-notice";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, CircleCheck, CircleDot } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { Dodsfallsfrister } from "@/components/dodsfallsfrister";
import { useHousehold } from "@/components/household-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMyParty } from "@/hooks/use-my-party";
import { today } from "@/lib/calculation";
import { DEMO_EXIT, isDemo } from "@/lib/demo";
import { BUYOUT_CHECKLIST, compareDates } from "@/lib/engine";
import { getExit, notifyTakeoverFn, setChecklistFn, startExitFn } from "@/lib/exit.functions";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/forsaljning/")({
  head: () => ({ meta: [{ title: "Försäljning och utköp – Mitt & Ditt" }] }),
  component: ExitProcessPage,
});

function ExitProcessPage() {
  const { household } = useHousehold();
  const myPartyId = useMyParty();
  const queryClient = useQueryClient();
  const [processDate, setProcessDate] = useState(today);
  // Dödsfall saknades här medan servern och databasen redan godtog det. Följden
  // var att fristerna i avtalets punkt 22 aldrig gick att nå: komponenten som
  // visar dem villkoras på just den processtypen.
  const [kind, setKind] = useState<"extern_forsaljning" | "utkop" | "dodsfall" | "annan">("annan");

  const query = useQuery({
    queryKey: ["exit", household?.id],
    queryFn: () => getExit({ data: { householdId: household?.id as string } }),
    enabled: !isDemo && Boolean(household?.id),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["exit"] });

  const start = useMutation({
    mutationFn: () =>
      startExitFn({
        data: { householdId: household?.id as string, processDate, kind },
      }),
    onSuccess: () => {
      toast.success("Processdagen registrerad");
      void refresh();
    },
    onError: () => toast.error("Kunde inte registrera processdagen."),
  });

  const notify = useMutation({
    mutationFn: (processId: string) =>
      notifyTakeoverFn({ data: { householdId: household?.id as string, processId } }),
    onSuccess: () => {
      toast.success("Ditt besked om övertagande är registrerat");
      void refresh();
    },
    onError: () => toast.error("Kunde inte registrera beskedet."),
  });

  const checklist = useMutation({
    mutationFn: (payload: { processId: string; checklist: Record<string, boolean> }) =>
      setChecklistFn({ data: { householdId: household?.id as string, ...payload } }),
    onSuccess: () => void refresh(),
    onError: () => toast.error("Kunde inte spara checklistan."),
  });

  // I demoläget visas samma yta med exempeldata i stället för ett tomt rum.
  // Åtgärderna är avstängda: de skriver till databasen, som inte finns här.
  const process = isDemo ? DEMO_EXIT : (query.data?.process ?? null);
  const names = Object.fromEntries((household?.parties ?? []).map((p) => [p.partyId, p.name]));
  const now = today();

  return (
    <>
      {isDemo && (
        <p className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-secondary/60 p-3 text-sm">
          <span className="inline-flex rounded-full border border-hairline bg-card px-2.5 py-0.5 text-xs text-muted-foreground">
            Exempel
          </span>
          En påhittad process, så att ytan går att se. Åtgärderna är avstängda i demoläget.
        </p>
      )}

      <PageHeader
        eyebrow="Försäljning & utköp"
        title="Process"
        description="Processdagen startar avtalets frister. Tjänsten påminner, men genomför aldrig något externt."
      />

      {!process ? (
        <section className="tile-surface p-5">
          <p className="eyebrow mb-3">Starta processen</p>
          <p className="mb-4 text-sm text-muted-foreground">
            Avtalsmässig processdag är den första dag någon skriftligen meddelar att samboendet ska
            avvecklas, eller den dag ni skriftligen enas om att processen startar.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="processDate">Processdag</Label>
              <Input
                id="processDate"
                type="date"
                value={processDate}
                onChange={(event) => setProcessDate(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="kind">Vad processen avser</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
                <SelectTrigger id="kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="annan">Inte bestämt än</SelectItem>
                  <SelectItem value="utkop">Utköp</SelectItem>
                  <SelectItem value="extern_forsaljning">Extern försäljning</SelectItem>
                  <SelectItem value="dodsfall">Dödsfall</SelectItem>
                </SelectContent>
              </Select>
              {kind === "dodsfall" && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Två frister börjar löpa, var och en när sitt eget underlag finns: trettio dagar
                  från bouppteckningsförrättningen att meddela övertagande, och fyra månader från
                  fastställt värde att ordna finansieringen. Dagarna registreras i nästa steg.
                </p>
              )}
            </div>
          </div>
          <Button
            className="mt-4"
            disabled={isDemo || start.isPending}
            onClick={() => start.mutate()}
          >
            Registrera processdagen
          </Button>
        </section>
      ) : (
        <>
          <section className="tile-surface mb-4 p-5">
            <div className="flex items-center gap-1.5">
              <CalendarClock className="size-3.5 text-muted-foreground" />
              <p className="eyebrow">Tidslinje</p>
            </div>
            <p className="mt-2 text-sm">Processdag {fmtDate(process.processDate)}.</p>
            <ol className="mt-4 grid gap-3">
              <Milestone
                done={Boolean(process.takeoverNotifiedAt)}
                overdue={
                  !process.takeoverNotifiedAt &&
                  compareDates(now, process.deadlines.takeoverNoticeBy) > 0
                }
                label="Besked om övertagande"
                due={process.deadlines.takeoverNoticeBy}
                detail={
                  process.takeoverPartyId
                    ? `${names[process.takeoverPartyId] ?? process.takeoverPartyId} vill överta bostaden.`
                    : "Den som vill överta bostaden lämnar besked senast 14 dagar efter processdagen."
                }
              />
              <Milestone
                done={process.status === "genomford"}
                overdue={
                  process.status !== "genomford" &&
                  compareDates(now, process.deadlines.saleOrBuyoutBy) > 0
                }
                label="Utköp genomfört eller bostaden utlagd till försäljning"
                due={process.deadlines.saleOrBuyoutBy}
                detail="Senast tre månader efter processdagen ska ett utköp vara genomfört eller bostaden vara utlagd hos registrerad fastighetsmäklare."
              />
            </ol>

            {!process.takeoverNotifiedAt && myPartyId && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                disabled={isDemo || notify.isPending}
                onClick={() => notify.mutate(process.id)}
              >
                Jag vill överta bostaden
              </Button>
            )}
          </section>

          {process.kind === "dodsfall" && (
            <Dodsfallsfrister householdId={household!.id} dagar={process.dodsfall} idag={now} />
          )}

          <section className="tile-surface p-5">
            <p className="eyebrow mb-1">Checklista inför genomfört utköp</p>
            <p className="mb-4 text-sm text-muted-foreground">
              Utköpet är genomfört först när allt nedan är klart.
            </p>
            <ul className="grid gap-2.5">
              {BUYOUT_CHECKLIST.map((item) => (
                <li key={item.key} className="flex items-start gap-2.5">
                  <Checkbox
                    id={item.key}
                    disabled={isDemo}
                    checked={process.checklist[item.key] === true}
                    onCheckedChange={(checked) =>
                      checklist.mutate({
                        processId: process.id,
                        checklist: { ...process.checklist, [item.key]: checked === true },
                      })
                    }
                  />
                  <Label htmlFor={item.key} className="text-sm font-normal leading-snug">
                    {item.label}
                  </Label>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

function Milestone({
  done,
  overdue,
  label,
  due,
  detail,
}: {
  done: boolean;
  overdue: boolean;
  label: string;
  due: string;
  detail: string;
}) {
  return (
    <li className="flex gap-3">
      {done ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-[color:var(--positive)]" />
      ) : (
        <CircleDot
          className={`mt-0.5 size-4 shrink-0 ${
            overdue ? "text-destructive" : "text-muted-foreground"
          }`}
        />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          Senast {fmtDate(due)}
          {overdue ? " · fristen har passerat" : done ? " · klart" : ""}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}
