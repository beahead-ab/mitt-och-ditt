import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Lock } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app-shell";
import { useHousehold } from "@/components/household-context";
import { useMyParty } from "@/hooks/use-my-party";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listAgreementVersions, type Avtalsversion } from "@/lib/agreement.functions";
import { isDemo } from "@/lib/demo";
import { toKronor } from "@/lib/engine";
import { fmtDate, fmtDateTime, fmtEnheter, fmtKr } from "@/lib/format";
import { approveDocumentFn } from "@/lib/transactions.functions";

export const Route = createFileRoute("/_authenticated/overenskommelse/versioner")({
  head: () => ({ meta: [{ title: "Avtalsversioner – Mitt & Ditt" }] }),
  component: VersionerPage,
});

const STATUS = {
  gällande: { text: "Gäller nu", variant: "default" as const },
  utkast: { text: "Utkast", variant: "secondary" as const },
  ersatt: { text: "Ersatt", variant: "outline" as const },
};

function VersionerPage() {
  const { household } = useHousehold();
  const minPartsroll = useMyParty();
  const klient = useQueryClient();

  const query = useQuery({
    queryKey: ["agreement-versions", household?.id],
    queryFn: () => listAgreementVersions({ data: { householdId: household?.id as string } }),
    enabled: !isDemo && Boolean(household?.id),
  });

  const godkann = useMutation({
    mutationFn: (versionId: string) =>
      approveDocumentFn({
        data: {
          householdId: household?.id as string,
          entityType: "agreement_version",
          entityId: versionId,
        },
      }),
    onSuccess: () => {
      toast.success("Ditt godkännande är registrerat.");
      void klient.invalidateQueries();
    },
    onError: (fel: Error) => toast.error(fel.message || "Kunde inte registrera godkännandet."),
  });

  const versioner = query.data ?? [];
  const namn = Object.fromEntries((household?.parties ?? []).map((p) => [p.partyId, p.name]));

  return (
    <>
      <PageHeader
        eyebrow="Överenskommelse"
        title="Avtalsversioner"
        description="Varje version av överenskommelsen, vad som ändrats och vilka som godkänt. En ny version börjar gälla först när båda godkänt exakt samma innehåll."
      />

      {isDemo ? (
        <EmptyState title="Demoläge" hint="Avtalsversioner kräver databas." />
      ) : versioner.length === 0 ? (
        <EmptyState
          title="Ingen avtalsversion ännu"
          hint="Den första versionen skapas när ni fyller i överenskommelsens startuppgifter."
        />
      ) : (
        <ul className="grid gap-4">
          {[...versioner].reverse().map((v) => (
            <VersionKort
              key={v.id}
              version={v}
              namn={namn}
              minPartsroll={minPartsroll}
              godkanner={godkann.isPending}
              onGodkann={() => godkann.mutate(v.id)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function VersionKort({
  version,
  namn,
  minPartsroll,
  godkanner,
  onGodkann,
}: {
  version: Avtalsversion;
  namn: Record<string, string>;
  minPartsroll: string | null;
  godkanner: boolean;
  onGodkann: () => void;
}) {
  const status = STATUS[version.status];
  const jagHarGodkant = minPartsroll ? version.approvedBy.includes(minPartsroll) : false;
  const kanGodkanna = version.status === "utkast" && Boolean(minPartsroll) && !jagHarGodkant;
  const vantarPa = Object.keys(namn).filter((p) => !version.approvedBy.includes(p));

  return (
    <li className="tile-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-serif text-base font-medium">Version {version.version}</p>
            <Badge variant={status.variant}>{status.text}</Badge>
            {version.effectiveAt && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                title="En version som börjat gälla kan inte ändras av någon"
              >
                <Lock className="size-3" />
                låst
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Skapad av {version.createdBy} {fmtDateTime(version.createdAt)}
            {version.effectiveAt && ` · gäller från ${fmtDateTime(version.effectiveAt)}`}
          </p>
          {version.reason && <p className="mt-2 text-sm">{version.reason}</p>}
        </div>

        {kanGodkanna && (
          <Button size="sm" disabled={godkanner} onClick={onGodkann}>
            <Check className="mr-1.5 size-4" />
            Godkänn version {version.version}
          </Button>
        )}
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <Rad etikett="Startdag" varde={fmtDate(version.startDate)} />
        <Rad etikett="Startvärde" varde={fmtKr(toKronor(Number(version.startValueOre)))} />
        <Rad
          etikett="Bolån på startdagen"
          varde={fmtKr(toKronor(Number(version.initialLoanOre)))}
        />
        <Rad etikett="Totalt antal enheter" varde={fmtEnheter(Number(version.totalUnits))} />
        {Object.entries(version.startUnits).map(([part, enheter]) => (
          <Rad
            key={part}
            etikett={`Startenheter ${namn[part] ?? part}`}
            varde={fmtEnheter(Number(enheter))}
          />
        ))}
      </dl>

      {version.changes.length > 0 && (
        <div className="mt-4 rounded-md border border-[var(--hairline)] p-3">
          <p className="eyebrow mb-2">Ändrat mot version {version.version - 1}</p>
          <ul className="grid gap-1 text-sm">
            {version.changes.map((c) => (
              <li key={c.field}>
                <span className="text-muted-foreground">{c.field}:</span> {c.before} →{" "}
                <strong className="font-medium">{c.after}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Godkänd av:{" "}
          {version.approvedBy.length === 0
            ? "ingen ännu"
            : version.approvedBy.map((p) => namn[p] ?? p).join(", ")}
        </span>
        {version.status === "utkast" && vantarPa.length > 0 && (
          <span>Väntar på: {vantarPa.map((p) => namn[p] ?? p).join(", ")}</span>
        )}
        {version.objectedBy.length > 0 && (
          <span className="text-destructive">
            Invändning från: {version.objectedBy.map((p) => namn[p] ?? p).join(", ")}
          </span>
        )}
      </div>

      {version.checksum && (
        <p className="mt-2 break-all font-mono text-[0.7rem] text-muted-foreground">
          Checksumma {version.checksum}
        </p>
      )}
    </li>
  );
}

function Rad({ etikett, varde }: { etikett: string; varde: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--hairline)] py-1 last:border-0 sm:border-0">
      <dt className="text-muted-foreground">{etikett}</dt>
      <dd className="text-right tabular-nums">{varde}</dd>
    </div>
  );
}
