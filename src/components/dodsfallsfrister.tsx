import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Clock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dodsfallsfrister, type Frist } from "@/lib/dodsfall";
import { setDeathDatesFn } from "@/lib/exit.functions";
import { fmtDate } from "@/lib/format";

/**
 * Fristerna vid dödsfall (avtal 22).
 *
 * Två frister löper efter varandra, och var och en börjar först när sitt eget
 * underlag finns. Tjänsten räknar dem så att ingen behöver hålla datum i
 * huvudet - allra minst den som just förlorat sin partner.
 *
 * Bara källdagarna registreras. Förfallodagarna räknas fram, aldrig lagras.
 */
export function Dodsfallsfrister({
  householdId,
  dagar,
  idag,
}: {
  householdId: string;
  dagar: {
    estateInventoryOn: string | null;
    takeoverDeclaredOn: string | null;
    valueEstablishedOn: string | null;
    financingArrangedOn: string | null;
  };
  idag: string;
}) {
  const queryClient = useQueryClient();
  const [utkast, setUtkast] = useState(dagar);

  const spara = useMutation({
    mutationFn: () => setDeathDatesFn({ data: { householdId, ...utkast } }),
    onSuccess: () => {
      toast.success("Dagarna sparade");
      void queryClient.invalidateQueries({ queryKey: ["exit"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte spara dagarna."),
  });

  const { frister, narmast } = dodsfallsfrister({
    bouppteckningPa: dagar.estateInventoryOn,
    meddelatPa: dagar.takeoverDeclaredOn,
    vardeFastställtPa: dagar.valueEstablishedOn,
    finansieringOrdnadPa: dagar.financingArrangedOn,
    idag,
  });

  return (
    <section className="tile-surface mb-4 p-5">
      <p className="eyebrow mb-1">Frister vid dödsfall</p>
      <p className="mb-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Fristerna räknas ur dagarna nedan. Var och en börjar löpa först när sitt eget underlag finns
        – att värdet inte är fastställt än betyder att fyramånadersfristen inte har startat, inte
        att den redan löper.
      </p>

      {narmast && (
        <p
          className={`mb-4 rounded-md p-3 text-sm leading-relaxed ${
            narmast.lage === "forfallen"
              ? "border border-destructive/40 bg-destructive/10"
              : "border border-[color:var(--data-gold)]/40 bg-[color:var(--data-gold)]/10"
          }`}
        >
          {narmast.lage === "forfallen"
            ? `Fristen för "${narmast.rubrik.toLowerCase()}" gick ut ${fmtDate(narmast.forfaller!)}.`
            : `${narmast.rubrik}: ${narmast.dagarKvar} dagar kvar, senast ${fmtDate(narmast.forfaller!)}.`}
        </p>
      )}

      <ul className="grid gap-2">
        {frister.map((frist) => (
          <Fristrad key={frist.nyckel} frist={frist} />
        ))}
      </ul>

      <form
        className="mt-5 grid gap-3 border-t border-hairline pt-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          spara.mutate();
        }}
      >
        <Datum
          id="bouppteckning"
          label="Bouppteckningsförrättning"
          value={utkast.estateInventoryOn}
          onChange={(v) => setUtkast((f) => ({ ...f, estateInventoryOn: v }))}
        />
        <Datum
          id="meddelat"
          label="Meddelande om övertagande"
          value={utkast.takeoverDeclaredOn}
          onChange={(v) => setUtkast((f) => ({ ...f, takeoverDeclaredOn: v }))}
        />
        <Datum
          id="varde"
          label="Värdet fastställt"
          value={utkast.valueEstablishedOn}
          onChange={(v) => setUtkast((f) => ({ ...f, valueEstablishedOn: v }))}
        />
        <Datum
          id="finansiering"
          label="Finansieringen ordnad"
          value={utkast.financingArrangedOn}
          onChange={(v) => setUtkast((f) => ({ ...f, financingArrangedOn: v }))}
        />
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={spara.isPending}>
            Spara dagarna
          </Button>
        </div>
      </form>
    </section>
  );
}

function Fristrad({ frist }: { frist: Frist }) {
  const ton =
    frist.lage === "uppfylld"
      ? "text-[color:var(--positive)]"
      : frist.lage === "forfallen"
        ? "text-destructive"
        : frist.lage === "snart"
          ? "text-[color:var(--data-gold)]"
          : "text-muted-foreground";

  const besked =
    frist.lage === "uppfylld"
      ? "Gjort"
      : frist.lage === "vantar_pa_underlag"
        ? "Har inte börjat löpa"
        : frist.lage === "forfallen"
          ? `Gick ut ${fmtDate(frist.forfaller!)}`
          : `${frist.dagarKvar} dagar kvar · senast ${fmtDate(frist.forfaller!)}`;

  return (
    <li className="flex items-start gap-2.5 rounded-md border border-hairline p-3">
      {frist.lage === "uppfylld" ? (
        <CircleCheck className={`mt-0.5 size-4 shrink-0 ${ton}`} />
      ) : (
        <Clock className={`mt-0.5 size-4 shrink-0 ${ton}`} />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">{frist.rubrik}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {besked} · {frist.raknasFran}
        </p>
      </div>
    </li>
  );
}

function Datum({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        className="h-9"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      />
    </div>
  );
}
