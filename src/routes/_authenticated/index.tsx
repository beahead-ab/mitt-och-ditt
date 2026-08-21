import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Clock, FileWarning, Receipt, Scale } from "lucide-react";
import { useMemo } from "react";

import { PageHeader } from "@/components/app-shell";
import { Explain, TERMS } from "@/components/explain";
import { ExportMenu } from "@/components/export-menu";
import { useHousehold } from "@/components/household-context";
import { useExports } from "@/hooks/use-exports";
import { NoAgreement } from "@/components/no-agreement";
import { StatusCard } from "@/components/status-card";
import { Badge } from "@/components/ui/badge";
import {
  defaultEndpoint,
  disputedTransactions,
  missingReceipts,
  needsQuarterlyReview,
  pendingTransactions,
  run,
} from "@/lib/calculation";
import { useAttachmentReferences } from "@/hooks/use-attachments";
import { useHouseholdData } from "@/hooks/use-household-data";
import { toKronor } from "@/lib/engine";
import { fmtAndel, fmtDate, fmtKr } from "@/lib/format";
import { PARTY_LABELS, SEED_FORMAL_OWNERSHIP } from "@/lib/seed";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Översikt – Mitt & Ditt" }] }),
  component: Overview,
});

function Overview() {
  const { household } = useHousehold();
  const { agreement, rules, transactions, isLoading } = useHouseholdData();
  const withAttachment = useAttachmentReferences();
  const { summaryExports } = useExports(agreement);

  const computed = useMemo(() => {
    if (!agreement) return null;
    const end = defaultEndpoint(agreement, rules, transactions);
    return { endpoint: end, result: run(agreement, rules, transactions, end) };
  }, [agreement, rules, transactions]);

  if (!agreement || !computed) {
    return (
      <>
        <PageHeader eyebrow="Läget nu" title={household?.propertyAddress ?? "Bostaden"} />
        <NoAgreement loading={isLoading} />
      </>
    );
  }

  const { result, endpoint } = computed;
  const [a, b] = agreement.parties;
  const review = needsQuarterlyReview(transactions, null);
  const pending = pendingTransactions(transactions);
  const disputed = disputedTransactions(transactions);
  const missing = missingReceipts(agreement, transactions, withAttachment);
  const lastEvent = result.events[result.events.length - 1];
  const netEquity = endpoint.endValue - endpoint.endLoan;
  const claimsTotal = result.claims[a] + result.claims[b];

  return (
    <>
      <PageHeader
        eyebrow="Läget nu"
        title={household?.propertyAddress ?? "Bostaden"}
        description={
          endpoint.mode === "prognos"
            ? `Prognos: avräkning ${fmtDate(endpoint.endDate)} med oförändrat värde. Ändra antagandet i simulatorn.`
            : "Slutavräkning med fastställda uppgifter."
        }
        action={
          <div className="flex items-center gap-2">
            <Badge variant={endpoint.mode === "prognos" ? "secondary" : "default"}>
              {endpoint.mode === "prognos" ? "Prognos" : "Slutavräkning"}
            </Badge>
            <ExportMenu
              groups={[{ title: "Läget nu", choices: summaryExports(result, endpoint) }]}
            />
          </div>
        }
        info={<Explain {...TERMS.prognos} />}
      />

      <section className="tile-surface mb-6 p-5 sm:p-6">
        <div className="flex items-center gap-1.5">
          <p className="eyebrow">Nettokapital</p>
          <Explain {...TERMS.nettokapital} />
        </div>
        <p className="hero-number mt-1">{fmtKr(toKronor(netEquity))}</p>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Figure label="Startvärde" value={fmtKr(toKronor(agreement.startValue))} />
          <Figure
            label={endpoint.mode === "prognos" ? "Antaget slutvärde" : "Fastställt slutvärde"}
            value={fmtKr(toKronor(endpoint.endValue))}
          />
          <Figure label="Bolån" value={fmtKr(toKronor(endpoint.endLoan))} />
        </dl>
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="tile-surface p-5">
          <div className="flex items-center gap-1.5">
            <p className="eyebrow">Intern ekonomisk andel</p>
            <Explain {...TERMS.internAndel} />
          </div>
          <div className="mt-3 grid gap-3">
            {agreement.parties.map((party) => (
              <div key={party} className="flex items-baseline justify-between gap-3">
                <span className="text-sm">{PARTY_LABELS[party] ?? party}</span>
                <span className="tabular font-serif text-xl font-medium">
                  {fmtAndel(result.finalShares[party])}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-hairline pt-3 text-xs leading-relaxed text-muted-foreground">
            Den interna ekonomiska andelen används bara i avräkningen mellan parterna. Den ändrar
            inte den formella ägarandelen i bostadsrätten.
          </p>
        </div>

        <div className="tile-surface p-5">
          <p className="eyebrow">Formell ägarandel</p>
          <div className="mt-3 grid gap-3">
            {agreement.parties.map((party) => (
              <div key={party} className="flex items-baseline justify-between gap-3">
                <span className="text-sm">{PARTY_LABELS[party] ?? party}</span>
                <span className="tabular font-serif text-xl font-medium">
                  {SEED_FORMAL_OWNERSHIP[party] == null
                    ? "–"
                    : fmtAndel(SEED_FORMAL_OWNERSHIP[party] as number)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-hairline pt-3 text-xs leading-relaxed text-muted-foreground">
            Följer köpehandlingen och föreningens uppgifter. Fylls i separat och ändras bara genom
            giltig överlåtelse.
          </p>
        </div>
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard
          icon={Clock}
          label="Väntar på godkännande"
          value={pending.length}
          hint={pending.length === 0 ? "Inget att göra" : "Påverkar inte andelarna än"}
          tone={pending.length > 0 ? "attention" : "neutral"}
          to="/transaktioner/vantar"
        />
        <StatusCard
          icon={AlertTriangle}
          label="Tvistiga poster"
          value={disputed.length}
          hint={disputed.length === 0 ? "Inga invändningar" : "Står utanför beräkningen"}
          tone={disputed.length > 0 ? "attention" : "neutral"}
          to="/transaktioner/historik"
        />
        <StatusCard
          icon={FileWarning}
          label="Saknade underlag"
          value={missing.length}
          hint={missing.length === 0 ? "Alla större poster har underlag" : "Komplettera kvitton"}
          tone={missing.length > 0 ? "attention" : "neutral"}
          to="/transaktioner/historik"
        />
        <StatusCard
          icon={Receipt}
          label="Preliminär skatt"
          value={result.preliminaryTaxCount}
          hint={
            result.preliminaryTaxCount === 0
              ? "Inga preliminära poster"
              : "Rätta när beskedet kommit"
          }
          tone={result.preliminaryTaxCount > 0 ? "attention" : "neutral"}
          to="/transaktioner/historik"
        />
      </section>

      {review.due && review.since && (
        <section className="mb-6 rounded-md border border-hairline bg-secondary/60 p-4">
          <p className="eyebrow">Dags för avstämning</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Ingenting har registrerats sedan {fmtDate(review.since)}. Enligt avtalet ska ni minst
            varje kvartal kontrollera att betalningar, lånesaldon, skatteuppgifter och underlag är
            registrerade.
          </p>
        </section>
      )}

      {claimsTotal > 0 && (
        <section className="mb-6 rounded-md border border-[color:var(--data-gold)]/40 bg-[color:var(--data-gold)]/10 p-4">
          <div className="flex items-center gap-1.5">
            <Scale className="size-3.5 text-[color:var(--data-gold)]" />
            <p className="eyebrow">Personlig fordran</p>
            <Explain {...TERMS.personligFordran} />
          </div>
          <p className="mt-1.5 text-sm">
            {agreement.parties
              .filter((p) => result.claims[p] > 0)
              .map(
                (p) =>
                  `${PARTY_LABELS[p] ?? p} har ${fmtKr(toKronor(result.claims[p]))} som inte kunnat omvandlas till andelsenheter.`,
              )
              .join(" ")}{" "}
            Beloppet regleras i kronor vid slutavräkningen.
          </p>
        </section>
      )}

      {result.outside.entries.length > 0 && (
        <section className="tile-surface mb-6 p-5">
          <div className="flex items-center gap-1.5">
            <p className="eyebrow">Utanför enhetsmodellen</p>
            <Explain {...TERMS.utanforModellen} />
          </div>
          <div className="mt-3 grid gap-2">
            {agreement.parties.map((party) => (
              <div key={party} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{PARTY_LABELS[party] ?? party}</span>
                <span className="tabular">
                  {result.outside.balance[party] === 0
                    ? "±0 kr"
                    : result.outside.balance[party] > 0
                      ? `ligger ute med ${fmtKr(toKronor(result.outside.balance[party]))}`
                      : `ska betala ${fmtKr(toKronor(-result.outside.balance[party]))}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <p className="eyebrow mb-3">Senaste händelserna</p>
        {result.events.length === 0 ? (
          <div className="tile-surface p-8 text-center">
            <p className="text-sm font-medium">Inga godkända transaktioner än</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Andelarna är oförändrade sedan startdagen.
            </p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {[...result.events]
              .reverse()
              .slice(0, 5)
              .map((event) => (
                <li key={event.date} className="tile-surface p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{fmtDate(event.date)}</span>
                    <span className="tabular text-xs text-muted-foreground">
                      {event.transactionIds.join(", ")}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {event.overpayer
                      ? `${PARTY_LABELS[event.overpayer] ?? event.overpayer} överbetalade ${fmtKr(toKronor(event.overpayment))} och fick ${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(event.transferredUnits)} andelsenheter.`
                      : "Kostnaden fördelades enligt kostnadsnyckeln utan överbetalning."}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </section>

      {lastEvent && (
        <p className="mt-6 text-xs text-muted-foreground">
          Beräkningsmotor {result.engineVersion}. Andelarna räknas om från startdagen varje gång
          antagandet eller underlaget ändras.
        </p>
      )}
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 text-base font-medium">{value}</dd>
    </div>
  );
}
