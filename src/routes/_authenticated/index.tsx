import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarClock, FileWarning, Receipt, Scale } from "lucide-react";
import { useMemo } from "react";

import { PageHeader } from "@/components/app-shell";
import { Explain, TERMS } from "@/components/explain";
import { ExportMenu } from "@/components/export-menu";
import { useHousehold, usePartyName } from "@/components/household-context";
import { NoAgreement } from "@/components/no-agreement";
import { NoHousehold } from "@/components/no-household";
import { Räknare, StatusCard } from "@/components/status-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAttachmentReferences } from "@/hooks/use-attachments";
import { useExports } from "@/hooks/use-exports";
import { useHouseholdData } from "@/hooks/use-household-data";
import { useMyParty } from "@/hooks/use-my-party";
import { useMyTurn } from "@/hooks/use-my-turn";
import { defaultEndpoint, missingReceipts, run } from "@/lib/calculation";
import { isDemo } from "@/lib/demo";
import { toKronor } from "@/lib/engine";
import { fmtAndel, fmtDate, fmtKr } from "@/lib/format";
import { reconciliationState } from "@/lib/reconciliation.functions";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Översikt – Mitt & Ditt" }] }),
  component: Overview,
});

/** Procentenheter, med tecken. En andelsförändring är alltid liten och alltid viktig. */
function fmtProcentenheter(delta: number): string {
  const pe = delta * 100;
  const tecken = pe >= 0 ? "+" : "−";
  return `${tecken}${new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(Math.abs(pe))} pe`;
}

function Overview() {
  const { household, emailVerified, isLoading: laddarHushall } = useHousehold();
  const partyName = usePartyName();
  const myPartyId = useMyParty();
  const { agreement, rules, transactions, isLoading } = useHouseholdData();
  const minTur = useMyTurn();

  // Avstämningen läses ur databasen, inte gissas ur posterna. Räknades den från
  // senaste transaktionen kunde återkommande betalningar skjuta upp den hur
  // länge som helst - påminnelsen nollställdes av just det den kontrollerar.
  const avstamning = useQuery({
    queryKey: ["reconciliation", household?.id],
    queryFn: () => reconciliationState({ data: { householdId: household?.id as string } }),
    enabled: !isDemo && Boolean(household?.id),
  });
  const withAttachment = useAttachmentReferences();
  const { summaryExports } = useExports(agreement);

  const computed = useMemo(() => {
    if (!agreement) return null;
    const end = defaultEndpoint(agreement, rules, transactions);
    return { endpoint: end, result: run(agreement, rules, transactions, end) };
  }, [agreement, rules, transactions]);

  // Vad ett godkännande faktiskt innebär, räknat i samma motor som avräkningen.
  // Beslutsvyn ska svara på frågan den ställer: inte "godkänner du?" utan
  // "godkänner du det här, och vad blir din andel då?".
  const konsekvens = useMemo(() => {
    const post = minTur.items[0];
    if (!post || !agreement || !computed || !myPartyId) return null;

    const medPosten = transactions.map((tx) =>
      tx.id === post.transaction.id ? { ...tx, status: "approved" as const } : tx,
    );
    const slut = defaultEndpoint(agreement, rules, medPosten);
    const efter = run(agreement, rules, medPosten, slut);

    const före = computed.result.finalShares[myPartyId];
    const nu = efter.finalShares[myPartyId];
    return { post, andelEfter: nu, delta: nu - före };
  }, [minTur.items, agreement, rules, transactions, computed, myPartyId]);

  // Utan hushåll finns ingenting att visa läget för. Då är översikten
  // uppstarten i stället - den som skapat sitt konto själv ska mötas av nästa
  // steg, inte av ett tomt rum.
  if (!laddarHushall && !household) {
    return (
      <>
        <PageHeader eyebrow="Välkommen" title="Kom igång" />
        <NoHousehold emailVerified={emailVerified} />
      </>
    );
  }

  if (!agreement || !computed) {
    return (
      <>
        <PageHeader eyebrow="Läget nu" title={household?.propertyAddress ?? "Bostaden"} />
        <NoAgreement loading={isLoading} />
      </>
    );
  }

  const { result, endpoint } = computed;
  const parties = agreement.parties;
  const jag = myPartyId ?? parties[0];
  const motpart = parties.find((p) => p !== jag) ?? parties[1];

  const missing = missingReceipts(agreement, transactions, withAttachment);
  const netEquity = endpoint.endValue - endpoint.endLoan;
  const claimsTotal = parties.reduce((sum, p) => sum + result.claims[p], 0);
  const minPosition = result.settlement.finalPosition[jag];
  const minAndel = result.finalShares[jag];
  const utanförSaldo = result.outside.balance[jag] ?? 0;

  return (
    <>
      <PageHeader
        eyebrow={household?.propertyAddress ?? "Bostaden"}
        title="Om ni avräknar idag"
        action={
          <div className="flex items-center gap-2">
            <Badge variant={endpoint.mode === "prognos" ? "secondary" : "default"}>
              {endpoint.mode === "prognos" ? "Prognos · oförändrat värde" : "Slutavräkning"}
            </Badge>
            <ExportMenu
              groups={[{ title: "Läget nu", choices: summaryExports(result, endpoint) }]}
            />
          </div>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {/* Min position först. Nettokapitalet är bostadens tal; det här är mitt. */}
        <section className="tile-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="eyebrow">Din del, {partyName(jag)}</p>
            <p className="tabular text-sm text-muted-foreground">
              {fmtAndel(minAndel)} av {fmtKr(toKronor(result.settlement.saleNet))}
            </p>
          </div>
          <p className="hero-number mt-1" data-testid="min-position">
            {fmtKr(toKronor(minPosition))}
          </p>

          <Andelsstapel andel={minAndel} />

          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>
              {partyName(jag)} {fmtAndel(minAndel)}
            </span>
            {motpart && (
              <span className="text-muted-foreground">
                {partyName(motpart)} {fmtAndel(result.finalShares[motpart])} ·{" "}
                {fmtKr(toKronor(result.settlement.finalPosition[motpart]))}
              </span>
            )}
          </div>

          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline pt-3 text-sm">
            <Figure label="Nettokapital" value={fmtKr(toKronor(netEquity))} />
            <Figure
              label={endpoint.mode === "prognos" ? "Antaget värde" : "Slutvärde"}
              value={fmtKr(toKronor(endpoint.endValue))}
            />
            <Figure label="Bolån" value={fmtKr(toKronor(endpoint.endLoan))} />
          </dl>

          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {utanförSaldo !== 0 && (
              <>
                {utanförSaldo > 0
                  ? `Plus ${fmtKr(toKronor(utanförSaldo))} du ligger ute med utanför enhetsmodellen. `
                  : `Minus ${fmtKr(toKronor(-utanförSaldo))} du ska betala utanför enhetsmodellen. `}
              </>
            )}
            <Explain {...TERMS.internAndel} label="Så räknas det fram" />
          </p>
        </section>

        {konsekvens ? (
          <DinTur
            konsekvens={konsekvens}
            parties={parties}
            partyName={partyName}
            antal={minTur.count}
          />
        ) : (
          <section className="tile-surface flex flex-col justify-center p-5 sm:p-6">
            <p className="eyebrow">Inget väntar på dig</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Allt som registrerats är avgjort. Nästa gång någon av er lägger in en betalning hamnar
              den här tills båda tagit ställning.
            </p>
            <p className="mt-4 text-sm">
              <Link to="/transaktioner" className="text-primary underline underline-offset-4">
                Registrera en betalning
              </Link>
            </p>
          </section>
        )}
      </div>

      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatusCard
          icon={FileWarning}
          state="Åtgärda"
          tone={missing.length > 0 ? "attention" : "neutral"}
          action={
            missing.length > 0
              ? {
                  to: "/transaktioner/historik",
                  search: { saknar: "underlag" },
                  label: `Visa de ${missing.length === 1 ? "saknade" : missing.length} posterna`,
                }
              : undefined
          }
        >
          {missing.length === 0 ? (
            "Alla godkända poster över tusenlappen har underlag."
          ) : (
            <>
              <Räknare>{missing.length}</Räknare> godkända poster över 1 000 kr saknar kvitto
            </>
          )}
        </StatusCard>

        <StatusCard
          icon={Receipt}
          state="Preliminärt"
          tone={result.preliminaryTaxCount > 0 ? "attention" : "neutral"}
          action={
            result.preliminaryTaxCount > 0
              ? {
                  to: "/transaktioner/historik",
                  search: { skatt: "preliminar" },
                  label: "Rätta när beskedet kommit",
                }
              : undefined
          }
        >
          {result.preliminaryTaxCount === 0 ? (
            "Ingen post vilar på en preliminär skatteeffekt."
          ) : (
            <>
              <Räknare>{result.preliminaryTaxCount}</Räknare> med preliminär skatteeffekt
            </>
          )}
        </StatusCard>

        <StatusCard
          icon={CalendarClock}
          state="Avstämning"
          tone={avstamning.data?.overdue ? "attention" : "neutral"}
          action={{ to: "/transaktioner/avstamning", label: "Stäm av tillsammans" }}
        >
          {avstamning.data?.overdue
            ? `Inget registrerat sedan ${fmtDate(avstamning.data.nextDueOn)} – kvartalskontrollen är förfallen`
            : avstamning.data
              ? `Nästa avstämning senast ${fmtDate(avstamning.data.nextDueOn)}`
              : "Kvartalskontrollen görs av er båda tillsammans"}
        </StatusCard>
      </section>

      {claimsTotal > 0 && (
        <section className="mb-6 rounded-md border border-[color:var(--data-gold)]/40 bg-[color:var(--data-gold)]/10 p-4">
          <div className="flex items-center gap-1.5">
            <Scale className="size-3.5 text-[color:var(--data-gold)]" />
            <p className="eyebrow">Personlig fordran</p>
          </div>
          <p className="mt-1.5 text-sm">
            {parties
              .filter((p) => result.claims[p] > 0)
              .map(
                (p) =>
                  `${partyName(p)} har ${fmtKr(toKronor(result.claims[p]))} som inte kunnat omvandlas till andelsenheter.`,
              )
              .join(" ")}{" "}
            Beloppet regleras i kronor vid slutavräkningen.{" "}
            <Explain {...TERMS.personligFordran} label="Varför blir det så?" />
          </p>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="eyebrow">Så har andelen ändrats</p>
          <Link
            to="/transaktioner/historik"
            className="text-sm text-primary underline underline-offset-4"
          >
            Hela historiken
          </Link>
        </div>

        {result.events.length === 0 ? (
          <div className="tile-surface p-8 text-center">
            <p className="text-sm font-medium">Inga godkända transaktioner än</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Andelarna är oförändrade sedan startdagen.
            </p>
          </div>
        ) : (
          <div className="tile-surface overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <Th>Dag</Th>
                  <Th>Vad hände</Th>
                  <Th right>Överbetalning</Th>
                  <Th right>Din andel efter</Th>
                </tr>
              </thead>
              <tbody>
                {[...result.events]
                  .reverse()
                  .slice(0, 5)
                  .map((event) => (
                    <tr key={event.date} className="border-b border-hairline last:border-0">
                      <Td>{fmtDate(event.date)}</Td>
                      <Td>
                        {event.overpayer
                          ? `${partyName(event.overpayer)} betalade mer än sin del`
                          : "Kostnaden fördelades enligt nyckeln"}{" "}
                        <span className="text-muted-foreground">
                          · {event.transactionIds.join(", ")}
                        </span>
                      </Td>
                      <Td right>
                        {event.overpayer
                          ? `${partyName(event.overpayer)} ${fmtKr(toKronor(event.overpayment))}`
                          : "–"}
                      </Td>
                      <Td right>{fmtAndel(event.sharesAfter[jag])}</Td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-muted-foreground">
        Beräkningsmotor {result.engineVersion} · räknas om från startdagen{" "}
        {fmtDate(agreement.startDate)}
      </p>
    </>
  );
}

/**
 * Andelsstapeln.
 *
 * En förändring på några tiondels procentenheter syns inte i en stapel, och
 * ska inte göra det - stapeln säger storleksordningen, siffrorna säger exakt
 * vad som gäller.
 */
function Andelsstapel({ andel }: { andel: number }) {
  return (
    <div
      className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[oklch(0.86_0.06_45)]"
      role="img"
      aria-label={`Din andel: ${fmtAndel(andel)}`}
    >
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${Math.max(0, Math.min(1, andel)) * 100}%` }}
      />
    </div>
  );
}

/**
 * Beslutet med sin konsekvens.
 *
 * Kortet visade tidigare bara att något väntade. Frågan man ställer sig är en
 * annan: vad blir min andel om jag godkänner? Svaret räknas i samma motor som
 * avräkningen, så det som står här är samma tal som kommer att gälla.
 */
function DinTur({
  konsekvens,
  parties,
  partyName,
  antal,
}: {
  konsekvens: {
    post: {
      transaction: {
        id: string;
        category: string;
        description?: string;
        payments: Record<string, { gross?: number } | undefined>;
      };
      registeredByPartyId: string;
    };
    andelEfter: number;
    delta: number;
  };
  parties: readonly string[];
  partyName: (id: string) => string;
  antal: number;
}) {
  const { post, andelEfter, delta } = konsekvens;
  const tx = post.transaction;
  const total = parties.reduce((sum, p) => sum + (tx.payments[p]?.gross ?? 0), 0);

  return (
    <section
      data-testid="din-tur"
      className="rounded-[var(--radius)] border border-primary bg-card p-5 sm:p-6"
    >
      <p className="eyebrow text-primary">Din tur</p>
      <p className="mt-1.5 font-serif text-lg font-medium leading-snug">
        {partyName(post.registeredByPartyId)} har registrerat en post du inte tagit ställning till.
      </p>

      <div className="mt-4 rounded-md border border-hairline p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium">
            {tx.category}
            {tx.description ? ` · ${tx.description}` : ""}
          </span>
          <span className="tabular font-serif text-lg font-medium">{fmtKr(toKronor(total))}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Godkänner du blir din andel{" "}
          <span className="tabular font-medium text-foreground">{fmtAndel(andelEfter)}</span> (
          {fmtProcentenheter(delta)}).
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild className="h-11 flex-1 sm:flex-none">
          <Link to="/transaktioner/vantar">Granska och godkänn</Link>
        </Button>
        <Button asChild variant="outline" className="h-11">
          <Link to="/transaktioner/vantar">Invänd</Link>
        </Button>
      </div>

      {antal > 1 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {antal - 1} till väntar på ditt ställningstagande.
        </p>
      )}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-[oklch(0.35_0.02_60)] ${right ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={`px-4 py-3 ${right ? "tabular text-right" : ""}`}>{children}</td>;
}
