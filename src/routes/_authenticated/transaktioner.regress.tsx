import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { useHousehold, usePartyName } from "@/components/household-context";
import { MoneyField } from "@/components/money-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMyParty } from "@/hooks/use-my-party";
import { isDemo } from "@/lib/demo";
import { toKronor } from "@/lib/engine";
import { fmtDate, fmtKr } from "@/lib/format";
import {
  createRegressClaim,
  listRegressClaims,
  listReferenceRates,
  settleRegressClaim,
  type Regresskrav,
} from "@/lib/regress.functions";

/**
 * Regresskrav med dröjsmålsränta (avtal 12.3).
 *
 * En regressfordran uppstår när den ena parten betalat mer till banken än vad
 * den interna fördelningen säger. Att framställa ett skriftligt krav är den
 * enes ensidiga handling - men det är vad som startar klockan, så dagen måste
 * registreras. Trettio dagar senare förfaller fordran och räntan börjar löpa.
 */
export const Route = createFileRoute("/_authenticated/transaktioner/regress")({
  head: () => ({ meta: [{ title: "Regresskrav – Mitt & Ditt" }] }),
  component: RegressPage,
});

function RegressPage() {
  const { household } = useHousehold();
  const partyName = usePartyName();
  const myPartyId = useMyParty();
  const queryClient = useQueryClient();

  const [belopp, setBelopp] = useState<number | null>(null);
  const [kravdag, setKravdag] = useState("");
  const [beskrivning, setBeskrivning] = useState("");

  const krav = useQuery({
    queryKey: ["regress", household?.id],
    queryFn: () => listRegressClaims({ data: { householdId: household!.id } }),
    enabled: !isDemo && Boolean(household?.id),
  });

  const rantor = useQuery({
    queryKey: ["reference-rates"],
    queryFn: () => listReferenceRates(),
    enabled: !isDemo,
  });

  const skapa = useMutation({
    mutationFn: () =>
      createRegressClaim({
        data: {
          householdId: household!.id,
          amountKr: belopp ?? 0,
          demandedOn: kravdag,
          description: beskrivning || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Kravet registrerat");
      setBelopp(null);
      setKravdag("");
      setBeskrivning("");
      void queryClient.invalidateQueries({ queryKey: ["regress"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte registrera kravet."),
  });

  if (isDemo) {
    return (
      <>
        <PageHeader eyebrow="Transaktioner" title="Regresskrav" />
        <div className="tile-surface p-6 text-sm leading-relaxed text-muted-foreground">
          Regresskrav kräver databas. Här registreras det skriftliga kravet, och räntan räknas fram
          enligt 6 § räntelagen från trettio dagar efter kravet.
        </div>
      </>
    );
  }

  const saknarRantor = (rantor.data ?? []).length === 0;

  return (
    <>
      <PageHeader
        eyebrow="Transaktioner"
        title="Regresskrav"
        description="När den ena betalat mer till banken än den interna fördelningen säger. Fordran förfaller trettio dagar efter skriftligt krav, och därefter löper dröjsmålsränta."
      />

      {saknarRantor && (
        <div className="mb-6 rounded-md border border-[color:var(--data-gold)]/40 bg-[color:var(--data-gold)]/10 p-4 text-sm leading-relaxed">
          Referensräntan är inte ifylld. Utan den kan räntan inte räknas – tjänsten gissar inte,
          eftersom en gissad sats ger ett belopp som ser riktigt ut men är fel. Kraven går att
          registrera ändå; räntan visas när satserna finns.{" "}
          <Link to="/system/rantor" className="text-primary underline underline-offset-4">
            Fyll i referensräntan
          </Link>
        </div>
      )}

      <section className="tile-surface mb-6 p-5">
        <p className="eyebrow mb-1">Framställ ett krav</p>
        <p className="mb-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Kravet gäller för din egen räkning – du kan inte registrera ett krav i motpartens namn.
          Dagen du anger är den dag du framställde kravet skriftligt; det är den som startar
          klockan.
        </p>

        <form
          className="grid max-w-xl gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            skapa.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="regress-belopp">Belopp</Label>
            <MoneyField id="regress-belopp" value={belopp} onChange={setBelopp} className="h-9" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="regress-dag">Dagen kravet framställdes</Label>
            <Input
              id="regress-dag"
              type="date"
              className="h-9"
              value={kravdag}
              onChange={(event) => setKravdag(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="regress-text">Vad kravet gäller</Label>
            <Textarea
              id="regress-text"
              value={beskrivning}
              onChange={(event) => setBeskrivning(event.target.value)}
              placeholder="Till exempel: amortering och ränta betald för bådas räkning i mars."
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={skapa.isPending || !belopp || belopp <= 0 || !kravdag}>
              Registrera kravet
            </Button>
          </div>
        </form>
      </section>

      {(krav.data ?? []).length === 0 ? (
        <div className="tile-surface p-8 text-center">
          <p className="text-sm font-medium">Inga regresskrav registrerade</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Det vanliga är att inga finns. De uppstår först när någon betalat mer än sin del och
            behövt kräva in det.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {(krav.data ?? []).map((k) => (
            <Kravkort
              key={k.id}
              krav={k}
              partyName={partyName}
              mittParti={myPartyId}
              householdId={household!.id}
            />
          ))}
        </div>
      )}
    </>
  );
}

function Kravkort({
  krav,
  partyName,
  mittParti,
  householdId,
}: {
  krav: Regresskrav;
  partyName: (id: string) => string;
  mittParti: string | null;
  householdId: string;
}) {
  const queryClient = useQueryClient();
  const [reglerar, setReglerar] = useState(false);
  const [dag, setDag] = useState("");
  const [belopp, setBelopp] = useState<number | null>(null);

  const reglera = useMutation({
    mutationFn: () =>
      settleRegressClaim({
        data: {
          householdId,
          claimId: krav.id,
          settledOn: dag,
          settledAmountKr: belopp ?? 0,
        },
      }),
    onSuccess: () => {
      toast.success("Fordran reglerad");
      setReglerar(false);
      void queryClient.invalidateQueries({ queryKey: ["regress"] });
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte reglera fordran."),
  });

  const minFordran = krav.creditorPartyId === mittParti;
  const ranta = krav.ranta;
  const totalt = ranta.ok ? krav.amountOre + ranta.ranta : krav.amountOre;

  return (
    <section className="tile-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {partyName(krav.creditorPartyId)} kräver {partyName(krav.debtorPartyId)}
            {minFordran ? " (din fordran)" : ""}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Skriftligt krav {fmtDate(krav.demandedOn)}
            {ranta.ok && ` · förfaller ${fmtDate(ranta.forfallodag)}`}
          </p>
        </div>
        <p className="tabular font-serif text-xl font-medium">{fmtKr(toKronor(krav.amountOre))}</p>
      </div>

      {krav.description && <p className="mt-2 text-sm">{krav.description}</p>}

      <div className="mt-4 rounded-md bg-secondary p-4 text-sm">
        {!ranta.ok ? (
          <p className="text-muted-foreground">Räntan kan inte räknas: {ranta.skal}</p>
        ) : ranta.dagar === 0 ? (
          <p className="text-muted-foreground">
            Ingen ränta har börjat löpa. Fordran förfaller {fmtDate(ranta.forfallodag)}.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                Dröjsmålsränta i {ranta.dagar} dagar
                {krav.settledOn ? ` fram till regleringen` : " fram till idag"}
              </span>
              <span className="tabular font-medium">{fmtKr(toKronor(ranta.ranta))}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 border-t border-hairline pt-1.5">
              <span className="font-medium">Kapital och ränta</span>
              <span className="tabular font-medium">{fmtKr(toKronor(totalt))}</span>
            </div>
            <ul className="mt-2 grid gap-0.5 text-xs text-muted-foreground">
              {ranta.perioder.map((p) => (
                <li key={p.from} className="tabular">
                  {fmtDate(p.from)}–{fmtDate(p.to)}: {p.dagar} dagar med {p.rantesats} %
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{ranta.dagrakning}</p>
          </>
        )}
      </div>

      {krav.settledOn ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Reglerad {fmtDate(krav.settledOn)} med{" "}
          <span className="tabular">{fmtKr(toKronor(krav.settledAmountOre ?? 0))}</span>.
        </p>
      ) : minFordran ? (
        <div className="mt-4">
          {!reglerar ? (
            <Button variant="outline" size="sm" onClick={() => setReglerar(true)}>
              Reglera fordran
            </Button>
          ) : (
            <form
              className="grid max-w-md gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                reglera.mutate();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor={`dag-${krav.id}`}>Betalningsdag</Label>
                <Input
                  id={`dag-${krav.id}`}
                  type="date"
                  className="h-9"
                  value={dag}
                  onChange={(event) => setDag(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`belopp-${krav.id}`}>Betalt belopp</Label>
                <MoneyField
                  id={`belopp-${krav.id}`}
                  value={belopp}
                  onChange={setBelopp}
                  className="h-9"
                />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" size="sm" disabled={reglera.isPending || !dag}>
                  Bekräfta regleringen
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setReglerar(false)}>
                  Avbryt
                </Button>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                En reglering går inte att ta tillbaka.
              </p>
            </form>
          )}
        </div>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">Registrerat av {krav.createdByName}</p>
    </section>
  );
}
