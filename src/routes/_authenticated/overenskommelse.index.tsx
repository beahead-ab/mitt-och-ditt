import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { Explain, TERMS } from "@/components/explain";
import { Badge } from "@/components/ui/badge";
import { AgreementApproval } from "@/components/agreement-approval";
import { ExportMenu } from "@/components/export-menu";
import { useExports } from "@/hooks/use-exports";
import { NoAgreement } from "@/components/no-agreement";
import { useHouseholdData } from "@/hooks/use-household-data";
import { toKronor } from "@/lib/engine";
import { fmtAndel, fmtDate, fmtEnheter, fmtKr } from "@/lib/format";
import { useHousehold } from "@/components/household-context";

export const Route = createFileRoute("/_authenticated/overenskommelse/")({
  head: () => ({ meta: [{ title: "Gällande överenskommelse – Mitt & Ditt" }] }),
  component: Current,
});

/** Ändringar som kräver separat undertecknat tilläggsavtal (avtal 25.1). */
const LOCKED = [
  "Samboavtalsdelen",
  "Formella ägarandelar",
  "Startvärdet",
  "Startdagen",
  "Den linjära beräkningsformeln",
  "Slutavräkningsregeln",
  "Tremånadersregeln",
];

function Current() {
  const { agreement, isLoading } = useHouseholdData();
  const { household } = useHousehold();
  const { agreementExports } = useExports(agreement);

  if (!agreement) {
    return (
      <>
        <PageHeader eyebrow="Överenskommelse" title="Gällande överenskommelse" />
        <AgreementApproval />
        <div className="mt-4">
          <NoAgreement loading={isLoading} />
        </div>
      </>
    );
  }

  const nameOf = (partyId: string) =>
    household?.parties.find((p) => p.partyId === partyId)?.name ?? partyId;

  return (
    <>
      <PageHeader
        eyebrow="Överenskommelse"
        title="Gällande överenskommelse"
        description="Grunduppgifterna som beräkningen utgår från."
        action={
          <div className="flex items-center gap-2">
            <ExportMenu groups={[{ title: "Dokument", choices: agreementExports() }]} />
          </div>
        }
      />

      <section className="tile-surface mb-4 p-5">
        <p className="eyebrow mb-3">Grunduppgifter</p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Item label="Startdag" value={fmtDate(agreement.startDate)} />
          <Item label="Startvärde" value={fmtKr(toKronor(agreement.startValue))} />
          <Item label="Bolån på startdagen" value={fmtKr(toKronor(agreement.initialLoan))} />
          <Item
            label="Totalt antal andelsenheter"
            value={fmtEnheter(agreement.totalUnits)}
            explain={TERMS.andelsenhet}
          />
        </dl>
      </section>

      <section className="tile-surface mb-4 p-5">
        <p className="eyebrow mb-3">Kapitalinsatser och startenheter</p>
        <dl className="grid gap-3 sm:grid-cols-2">
          {agreement.parties.map((party) => (
            <div key={party} className="rounded-md border border-hairline p-3">
              <dt className="text-sm font-medium">{nameOf(party)}</dt>
              <dd className="mt-1.5 grid gap-1 text-sm">
                <Line label="Startenheter" value={fmtEnheter(agreement.startUnits[party])} />
                <Line
                  label="Intern startandel"
                  value={fmtAndel(agreement.startUnits[party] / agreement.totalUnits)}
                />
                <Line label="Formell ägarandel" value="Fylls i separat" />
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-hairline pt-3 text-xs leading-relaxed text-muted-foreground">
          En andelsenhet per krona styrkt initialt eget kapital. Kapitalinsatserna hanteras
          uteslutande genom startenheterna och får aldrig registreras som transaktioner.
        </p>
      </section>

      <section className="tile-surface p-5">
        <p className="eyebrow mb-2">Kräver undertecknat tilläggsavtal</p>
        <p className="text-sm text-muted-foreground">
          Följande går inte att ändra som en vanlig inställning i tjänsten:
        </p>
        <ul className="mt-2 grid gap-1 text-sm">
          {LOCKED.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-muted-foreground" aria-hidden>
                ·
              </span>
              {item}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Item({
  label,
  value,
  explain,
}: {
  label: string;
  value: string;
  explain?: (typeof TERMS)[keyof typeof TERMS];
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {explain && <Explain {...explain} />}
      </dt>
      <dd className="tabular mt-0.5 text-base font-medium">{value}</dd>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">{value}</span>
    </span>
  );
}
