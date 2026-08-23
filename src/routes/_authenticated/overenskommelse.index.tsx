import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Explain, TERMS } from "@/components/explain";
import { Badge } from "@/components/ui/badge";
import { AgreementApproval } from "@/components/agreement-approval";
import { AgreementSetup } from "@/components/agreement-setup";
import { ExportMenu } from "@/components/export-menu";
import { useExports } from "@/hooks/use-exports";
import { useHouseholdData } from "@/hooks/use-household-data";
import { toKronor } from "@/lib/engine";
import { fmtAndel, fmtDate, fmtEnheter, fmtKr } from "@/lib/format";
import { useHousehold } from "@/components/household-context";

export const Route = createFileRoute("/_authenticated/overenskommelse/")({
  head: () => ({ meta: [{ title: "Gällande överenskommelse – Mitt & Ditt" }] }),
  component: Current,
});

/** Ändringar som kräver separat undertecknat tilläggsavtal (avtal 25.1). */

function Current() {
  const { agreement, isLoading } = useHouseholdData();
  const { household } = useHousehold();
  const { agreementExports } = useExports(agreement);

  if (!agreement) {
    return (
      <>
        <PageHeader eyebrow="Överenskommelse" title="Gällande överenskommelse" />
        <AgreementApproval />
        {!isLoading && <AgreementSetup />}
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
          {household?.propertyAddress && <Item label="Adress" value={household.propertyAddress} />}
          {household?.propertyAssociation && (
            <Item label="Bostadsrättsförening" value={household.propertyAssociation} />
          )}
          {household?.apartmentNumber && (
            <Item label="Lägenhetsnummer" value={household.apartmentNumber} />
          )}
          <Item label="Startdag" value={fmtDate(agreement.startDate)} låst />
          <Item label="Startvärde" value={fmtKr(toKronor(agreement.startValue))} låst />
          <Item label="Bolån på startdagen" value={fmtKr(toKronor(agreement.initialLoan))} låst />
          <Item label="Totalt antal andelsenheter" value={fmtEnheter(agreement.totalUnits)} låst />
        </dl>
        {/* En förklaring för sektionen, inte en per fält. Sex frågetecken på
            en sida läser man förbi; en synlig länk säger att det finns ett
            framräknat exempel bakom. */}
        <p className="mt-4 border-t border-hairline pt-3">
          <Explain {...TERMS.andelsenhet} label="Vad är en andelsenhet?" />
        </p>
      </section>

      <section className="tile-surface mb-4 p-5">
        <p className="eyebrow mb-3">Kapitalinsatser och startenheter</p>
        <dl className="grid gap-3 sm:grid-cols-2">
          {agreement.parties.map((party) => (
            <div key={party} className="rounded-md border border-hairline p-3">
              <dt className="text-sm font-medium">{nameOf(party)}</dt>
              <dd className="mt-1.5 grid gap-1 text-sm">
                <Line label="Startenheter" value={fmtEnheter(agreement.startUnits[party])} låst />
                <Line
                  label="Intern startandel"
                  value={fmtAndel(agreement.startUnits[party] / agreement.totalUnits)}
                />
                <Line
                  label="Formell ägarandel"
                  value={
                    agreement.formalOwnership?.[party] === undefined
                      ? "Saknas"
                      : fmtAndel(agreement.formalOwnership[party])
                  }
                />
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
        <p className="eyebrow mb-2">Vad som kräver ett undertecknat tillägg</p>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          Uppgifterna ovan är låsta av avtalet. De går inte att ändra som en inställning - varken av
          er eller av den som administrerar tjänsten - utan bara genom ett tillägg som båda skrivit
          under. Detsamma gäller den linjära beräkningsformeln, slutavräkningsregeln och
          tremånadersregeln, som ligger i motorn.
        </p>
        <p className="mt-3 text-sm">
          <Link to="/overenskommelse/tillagg" className="text-primary underline underline-offset-4">
            Registrera ett tilläggsavtal
          </Link>
        </p>
      </section>
    </>
  );
}

function Item({
  label,
  value,
  låst,
}: {
  label: string;
  value: string;
  /** Fältet skyddas av avtalets punkt 25.1 och ändras bara genom ett tillägg. */
  låst?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular mt-0.5 text-base font-medium">{value}</dd>
      {låst && (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          Låst av avtalet
        </p>
      )}
    </div>
  );
}

function Line({ label, value, låst }: { label: string; value: string; låst?: boolean }) {
  return (
    <span className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1 text-muted-foreground">
        {label}
        {/* Låsningen står vid uppgiften den gäller, inte bara i en allmän text
            längre ned - den som läser en rad ska se om raden går att ändra. */}
        {låst && <Lock className="size-3" aria-label="Låst av avtalet" />}
      </span>
      <span className="tabular">{value}</span>
    </span>
  );
}
