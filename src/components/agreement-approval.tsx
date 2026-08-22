import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Explain, TERMS } from "@/components/explain";
import { useHousehold } from "@/components/household-context";
import { Button } from "@/components/ui/button";
import { pendingAgreement } from "@/lib/agreement.functions";
import { isDemo } from "@/lib/demo";
import { toKronor } from "@/lib/engine";
import { fmtAndel, fmtDate, fmtEnheter, fmtKr } from "@/lib/format";
import { approveDocumentFn } from "@/lib/transactions.functions";

/**
 * Granska och godkänn startuppgifterna.
 *
 * Kortet visade tidigare startvärde, lån, enheter och en kontrollsumma - allt
 * riktigt, men inte det man behöver för att kunna säga ja. Innebörden av det
 * man godkänner är "det här ger dig 39,1304 % av enheterna", och den siffran
 * stod ingenstans. Nu står den överst och kontrollsumman längst ner, där ett
 * bevis hör hemma.
 */
export function AgreementApproval() {
  const { household } = useHousehold();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["pending-agreement", household?.id],
    queryFn: () => pendingAgreement({ data: { householdId: household?.id as string } }),
    enabled: !isDemo && Boolean(household?.id),
  });

  const approve = useMutation({
    mutationFn: () =>
      approveDocumentFn({
        data: {
          householdId: household?.id as string,
          entityType: "agreement_version",
          entityId: query.data?.id as string,
        },
      }),
    onSuccess: () => {
      toast.success("Du har godkänt överenskommelsen");
      void queryClient.invalidateQueries();
    },
    onError: () => toast.error("Kunde inte registrera godkännandet."),
  });

  const draft = query.data;
  if (!draft || !household) return null;

  const names = Object.fromEntries(household.parties.map((p) => [p.partyId, p.name]));
  const mig = draft.myPartyId;
  const iHaveApproved = mig ? draft.approvedBy.includes(mig) : false;
  const waitingFor = household.parties
    .filter((p) => !draft.approvedBy.includes(p.partyId))
    .map((p) => p.name);

  // Vem som fyllt i, och därmed vem frågan gäller.
  const motpart = household.parties.find((p) => p.partyId !== mig);
  const minaEnheter = mig ? (draft.startUnits[mig] ?? 0) : 0;
  const minAndel = draft.totalUnits > 0 ? minaEnheter / draft.totalUnits : 0;

  return (
    <section data-testid="godkann-avtal" className="tile-surface p-5 sm:p-6">
      <p className="eyebrow text-primary">Din tur · uppstart 3 av 4</p>
      <h2 className="mt-1 font-serif text-xl font-medium leading-snug tracking-tight">
        {motpart ? `${motpart.name} har fyllt i köpet. Stämmer det?` : "Stämmer uppgifterna?"}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Godkänner ni båda börjar uppgifterna gälla och beräkningen startar från tillträdesdagen.
      </p>

      {mig && (
        <div className="mt-5 rounded-md bg-secondary p-4">
          <p className="text-sm text-muted-foreground">Det här ger dig</p>
          <p className="tabular mt-0.5 font-serif text-[40px] font-medium leading-none tracking-tight">
            {fmtAndel(minAndel)}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {fmtEnheter(minaEnheter)} andelsenheter av {fmtEnheter(draft.totalUnits)}. Betalar du
            mer än din del framöver flyttas enheter från {motpart?.name ?? "motparten"} till dig.{" "}
            <Explain {...TERMS.andelsenhet} label="Vad är en andelsenhet?" />
          </p>
        </div>
      )}

      <p className="eyebrow mt-6">Uppgifterna att godkänna</p>
      <dl className="mt-2 grid gap-2 text-sm">
        {household.propertyAddress && <Row label="Bostad" value={household.propertyAddress} />}
        <Row label="Startdag" value={fmtDate(draft.startDate)} />
        <Row label="Startvärde" value={fmtKr(toKronor(draft.startValue))} />
        <Row label="Bolån på startdagen" value={fmtKr(toKronor(draft.initialLoan))} />
        {Object.entries(draft.startUnits).map(([partyId, units]) => (
          <Row
            key={partyId}
            label={`Startenheter ${names[partyId] ?? partyId}`}
            value={fmtEnheter(units)}
          />
        ))}
        {Object.entries(draft.formalOwnership ?? {}).map(([partyId, share]) => (
          <Row
            key={`formal-${partyId}`}
            label={`Formell ägarandel ${names[partyId] ?? partyId}`}
            value={fmtAndel(share)}
          />
        ))}
      </dl>

      <div className="mt-5 grid gap-2">
        <Button
          className="h-11"
          disabled={iHaveApproved || approve.isPending || !mig}
          onClick={() => approve.mutate()}
        >
          {iHaveApproved ? "Du har godkänt uppgifterna" : "Godkänn uppgifterna"}
        </Button>
        {!iHaveApproved && motpart && (
          <p className="text-sm text-muted-foreground">
            Stämmer något inte – be {motpart.name} rätta. En rättelse blir en ny version, och båda
            godkännandena faller.
          </p>
        )}
      </div>

      <p className="mt-4 border-t border-hairline pt-3 text-sm text-muted-foreground">
        {waitingFor.length === 0
          ? "Båda har godkänt."
          : `Väntar på ${waitingFor.join(" och ")}. Ingen kan godkänna åt den andra.`}
      </p>
      {draft.reason && <p className="mt-1 text-sm text-muted-foreground">{draft.reason}</p>}
      {draft.checksum && (
        <p className="mt-1 break-all font-mono text-[0.68rem] text-muted-foreground">
          Version {draft.version} · kontrollsumma {draft.checksum}
        </p>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-hairline pb-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
