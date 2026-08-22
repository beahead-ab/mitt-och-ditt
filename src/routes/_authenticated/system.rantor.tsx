import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { DemoNotice } from "@/components/demo-notice";
import { useHousehold } from "@/components/household-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isDemo } from "@/lib/demo";
import { fmtDate } from "@/lib/format";
import { addReferenceRate, listReferenceRates } from "@/lib/regress.functions";
import { RANTELAGEN_TILLAGG } from "@/lib/rantelagen";

/**
 * Riksbankens referensränta.
 *
 * En offentlig uppgift, inte hushållets - därför global och bara skrivbar av
 * administratören. En part som kunde ändra referensräntan kunde ändra sin egen
 * skuld.
 *
 * Tabellen börjar tom med flit. Att fylla den med satser ur minnet vore värre
 * än att lämna den tom: räntan skulle gå att räkna men bli fel, och felet
 * syns inte. Saknas satsen för en period vägrar beräkningen i stället.
 */
export const Route = createFileRoute("/_authenticated/system/rantor")({
  head: () => ({ meta: [{ title: "Referensränta – Mitt & Ditt" }] }),
  component: RantorPage,
});

function RantorPage() {
  const { isAdmin } = useHousehold();
  const queryClient = useQueryClient();
  const [fromDate, setFromDate] = useState("");
  const [percent, setPercent] = useState("");
  const [source, setSource] = useState("Riksbanken");

  const rantor = useQuery({
    queryKey: ["reference-rates"],
    queryFn: () => listReferenceRates(),
    enabled: !isDemo,
  });

  const spara = useMutation({
    mutationFn: () =>
      addReferenceRate({
        data: { fromDate, percent: Number(percent.replace(",", ".")), source: source || undefined },
      }),
    onSuccess: () => {
      toast.success("Referensräntan sparad");
      setFromDate("");
      setPercent("");
      void queryClient.invalidateQueries({ queryKey: ["reference-rates"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte spara satsen."),
  });

  if (isDemo) {
    return (
      <>
        <PageHeader eyebrow="Systemadmin" title="Referensränta" />
        <DemoNotice vad="Riksbankens referensränta gäller från en viss dag tills nästa avlöser den, och ändras normalt 1 januari och 1 juli. Dröjsmålsräntan på en regressfordran är referensräntan plus åtta procentenheter." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Systemadmin"
        title="Referensränta"
        description={`Dröjsmålsräntan enligt 6 § räntelagen är referensräntan plus ${RANTELAGEN_TILLAGG} procentenheter. Satsen ändras normalt 1 januari och 1 juli.`}
      />

      {isAdmin && (
        <section className="tile-surface mb-6 p-5">
          <p className="eyebrow mb-1">Lägg till en sats</p>
          <p className="mb-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Ange satsen som Riksbanken publicerat den, och dagen den börjar gälla. Skriv av från
            källan – tjänsten räknar aldrig fram en sats själv, och gissar aldrig en som saknas.
          </p>
          <form
            className="grid max-w-xl gap-3 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              spara.mutate();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="ranta-fran">Gäller från</Label>
              <Input
                id="ranta-fran"
                type="date"
                className="h-9"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ranta-sats">Sats i procent</Label>
              <Input
                id="ranta-sats"
                inputMode="decimal"
                className="tabular h-9 text-right"
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
                placeholder="2,0"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ranta-kalla">Källa</Label>
              <Input
                id="ranta-kalla"
                className="h-9"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={spara.isPending || !fromDate || !percent}>
                Spara satsen
              </Button>
            </div>
          </form>
        </section>
      )}

      {(rantor.data ?? []).length === 0 ? (
        <div className="tile-surface p-8 text-center">
          <p className="text-sm font-medium">Ingen referensränta ifylld</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Utan satser kan dröjsmålsränta inte räknas. Tjänsten vägrar hellre än gissar – en gissad
            sats ger ett belopp som ser riktigt ut men är fel.
          </p>
        </div>
      ) : (
        <div className="tile-surface overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-[oklch(0.35_0.02_60)]">
                  Gäller från
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-[oklch(0.35_0.02_60)]">
                  Referensränta
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-[oklch(0.35_0.02_60)]">
                  Dröjsmålsränta
                </th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-[oklch(0.35_0.02_60)]">
                  Källa
                </th>
              </tr>
            </thead>
            <tbody>
              {(rantor.data ?? []).map((r) => (
                <tr key={r.fromDate} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-3">{fmtDate(r.fromDate)}</td>
                  <td className="tabular px-4 py-3 text-right">{r.percent} %</td>
                  <td className="tabular px-4 py-3 text-right font-medium">
                    {r.percent + RANTELAGEN_TILLAGG} %
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.source ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
