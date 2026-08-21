import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useHousehold } from "@/components/household-context";
import { Button } from "@/components/ui/button";
import { pendingAgreement } from "@/lib/agreement.functions";
import { isDemo } from "@/lib/demo";
import { toKronor } from "@/lib/engine";
import { fmtDate, fmtEnheter, fmtKr } from "@/lib/format";
import { approveDocumentFn } from "@/lib/transactions.functions";

/**
 * Avtalsversionen börjar gälla först när båda parter godkänt den. Fram till
 * dess finns ingenting att räkna på, så det här är första steget för ett nytt
 * hushåll.
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
  const iHaveApproved = draft.myPartyId ? draft.approvedBy.includes(draft.myPartyId) : false;
  const waitingFor = household.parties
    .filter((p) => !draft.approvedBy.includes(p.partyId))
    .map((p) => p.name);

  return (
    <section className="tile-surface p-5">
      <p className="eyebrow">Överenskommelse att godkänna · version {draft.version}</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <Row label="Startdag" value={fmtDate(draft.startDate)} />
        <Row label="Startvärde" value={fmtKr(toKronor(draft.startValue))} />
        <Row label="Bolån på startdagen" value={fmtKr(toKronor(draft.initialLoan))} />
        <Row label="Totalt antal andelsenheter" value={fmtEnheter(draft.totalUnits)} />
        {Object.entries(draft.startUnits).map(([partyId, units]) => (
          <Row
            key={partyId}
            label={`Startenheter ${names[partyId] ?? partyId}`}
            value={fmtEnheter(units)}
          />
        ))}
      </dl>
      {draft.reason && <p className="mt-3 text-xs text-muted-foreground">{draft.reason}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
        <Button
          size="sm"
          disabled={iHaveApproved || approve.isPending || !draft.myPartyId}
          onClick={() => approve.mutate()}
        >
          {iHaveApproved ? "Du har godkänt" : "Godkänn överenskommelsen"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {waitingFor.length === 0
            ? "Båda har godkänt."
            : `Väntar på ${waitingFor.join(" och ")}. Ingen kan godkänna åt den andra.`}
        </p>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
