import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { useHousehold } from "@/components/household-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { today } from "@/lib/calculation";
import { isDemo } from "@/lib/demo";
import { kr, toKronor } from "@/lib/engine";
import { addValuationFn, getExit } from "@/lib/exit.functions";
import { fmtDate, fmtKr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/forsaljning/varderingar")({
  head: () => ({ meta: [{ title: "Värderingar – Mitt & Ditt" }] }),
  component: ValuationsPage,
});

function ValuationsPage() {
  const { household } = useHousehold();
  const queryClient = useQueryClient();
  const [broker, setBroker] = useState("");
  const [valuedOn, setValuedOn] = useState(today);
  const [amount, setAmount] = useState("");
  const [joint, setJoint] = useState(false);

  const query = useQuery({
    queryKey: ["exit", household?.id],
    queryFn: () => getExit({ data: { householdId: household?.id as string } }),
    enabled: !isDemo && Boolean(household?.id),
  });

  const add = useMutation({
    mutationFn: () =>
      addValuationFn({
        data: {
          householdId: household?.id as string,
          processId: query.data?.process?.id as string,
          broker,
          valuedOn,
          amount: kr(Number(amount.replace(/\s/g, "").replace(",", ".")) || 0),
          forParty: !joint,
        },
      }),
    onSuccess: () => {
      toast.success("Värderingen registrerad");
      setBroker("");
      setAmount("");
      void queryClient.invalidateQueries({ queryKey: ["exit"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte spara värderingen."),
  });

  if (isDemo) {
    return (
      <>
        <PageHeader eyebrow="Försäljning & utköp" title="Värderingar" />
        <div className="tile-surface p-6 text-sm text-muted-foreground">
          Värderingar kräver databas.
        </div>
      </>
    );
  }

  const process = query.data?.process ?? null;
  const valuations = query.data?.valuations ?? [];
  const outcome = query.data?.outcome ?? null;
  const names = Object.fromEntries((household?.parties ?? []).map((p) => [p.partyId, p.name]));

  return (
    <>
      <PageHeader
        eyebrow="Försäljning & utköp"
        title="Värderingar"
        description="Vid utköp fastställs slutvärdet av oberoende mäklarvärderingar."
      />

      {!process ? (
        <div className="tile-surface p-8 text-center">
          <p className="text-sm font-medium">Ingen process har startats</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Registrera processdagen först, under Process.
          </p>
        </div>
      ) : (
        <>
          <section className="tile-surface mb-4 p-5">
            <p className="eyebrow mb-3">Registrerade värderingar</p>
            {valuations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Varje part utser en oberoende registrerad fastighetsmäklare med lokal erfarenhet.
                Båda får samma uppdrag: sannolikt marknadsvärde vid normal öppen försäljning.
              </p>
            ) : (
              <ul className="grid gap-2">
                {valuations.map((valuation) => (
                  <li
                    key={valuation.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-hairline p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{valuation.broker}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(valuation.valuedOn)} ·{" "}
                        {valuation.orderedByPartyId
                          ? `utsedd av ${names[valuation.orderedByPartyId] ?? valuation.orderedByPartyId}`
                          : "gemensam tredje värdering"}
                      </p>
                    </div>
                    <p className="tabular font-serif text-lg font-medium">
                      {fmtKr(toKronor(valuation.amount))}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {outcome && (
            <section
              className={`mb-4 rounded-md border p-4 ${
                outcome.value === null
                  ? "border-[color:var(--data-gold)]/40 bg-[color:var(--data-gold)]/10"
                  : "border-hairline bg-secondary/60"
              }`}
            >
              <p className="eyebrow">Fastställt slutvärde</p>
              <p className="mt-1.5 text-sm">
                {outcome.value === null
                  ? "Kan inte fastställas ännu."
                  : `${fmtKr(toKronor(outcome.value))} enligt ${outcome.method === "median" ? "medianen av tre värderingar" : "genomsnittet"}.`}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{outcome.explanation}</p>
            </section>
          )}

          <section className="tile-surface p-5">
            <p className="eyebrow mb-3">Lägg till värdering</p>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                add.mutate();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="broker">Mäklare</Label>
                <Input
                  id="broker"
                  value={broker}
                  onChange={(event) => setBroker(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="valuedOn">Värderingsdag</Label>
                <Input
                  id="valuedOn"
                  type="date"
                  value={valuedOn}
                  onChange={(event) => setValuedOn(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="amount">Värderat belopp</Label>
                <Input
                  id="amount"
                  inputMode="decimal"
                  className="tabular"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0"
                  required
                />
              </div>
              <label className="flex items-center justify-between gap-3 self-end text-sm">
                <span className="text-muted-foreground">Gemensam tredje värdering</span>
                <Switch checked={joint} onCheckedChange={(checked) => setJoint(checked === true)} />
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={add.isPending}>
                  Registrera värderingen
                </Button>
              </div>
            </form>
          </section>
        </>
      )}
    </>
  );
}
