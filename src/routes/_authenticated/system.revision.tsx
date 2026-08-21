import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { DataGrid, type GridColumn } from "@/components/data-grid";
import { ExportMenu } from "@/components/export-menu";
import { useHousehold } from "@/components/household-context";
import { useExports } from "@/hooks/use-exports";
import { useHouseholdData } from "@/hooks/use-household-data";
import { auditTrail, type AuditEvent } from "@/lib/audit.functions";
import { isDemo } from "@/lib/demo";
import { fmtDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/system/revision")({
  head: () => ({ meta: [{ title: "Revisionsunderlag – Mitt & Ditt" }] }),
  component: AuditPage,
});

const COLUMNS: GridColumn<AuditEvent>[] = [
  { key: "sequence", header: "Nr", width: 4, numeric: true, text: (e) => String(e.sequence) },
  {
    key: "occurredAt",
    header: "Tidpunkt",
    width: 11,
    text: (e) => fmtDateTime(e.occurredAt),
    sortValue: (e) => e.occurredAt,
  },
  { key: "eventType", header: "Händelse", width: 13, text: (e) => e.eventType },
  { key: "entityType", header: "Objekt", width: 8, text: (e) => e.entityType },
  { key: "actor", header: "Av", width: 8, text: (e) => e.actor ?? "" },
  { key: "previousValue", header: "Förevärde", width: 16, text: (e) => e.previousValue ?? "" },
  { key: "newValue", header: "Eftervärde", width: 16, text: (e) => e.newValue ?? "" },
  { key: "hash", header: "Hash", width: 12, text: (e) => e.hash.slice(0, 16) },
];

function AuditPage() {
  const { household } = useHousehold();
  const { agreement } = useHouseholdData();
  const { auditExport } = useExports(agreement);

  const query = useQuery({
    queryKey: ["audit", household?.id],
    queryFn: () => auditTrail({ data: { householdId: household?.id as string } }),
    enabled: !isDemo && Boolean(household?.id),
  });

  const trail = query.data;

  return (
    <>
      <PageHeader
        eyebrow="Systemadmin"
        title="Revisionsunderlag"
        description="Varje händelse i hushållet, i den ordning den inträffade."
        action={!isDemo && <ExportMenu groups={[{ title: "Underlag", choices: auditExport() }]} />}
      />

      {isDemo ? (
        <div className="tile-surface p-6">
          <p className="eyebrow">Demoläge</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Aktivitetsloggen finns i databasen. Starta utan{" "}
            <code className="font-mono">VITE_DEMO</code> för att se den.
          </p>
        </div>
      ) : query.isLoading ? (
        <div className="tile-surface p-8 text-center text-sm text-muted-foreground">
          Hämtar aktivitetsloggen …
        </div>
      ) : !trail ? (
        <div className="tile-surface p-8 text-center text-sm text-muted-foreground">
          Ingen logg att visa.
        </div>
      ) : (
        <>
          <section
            className={`mb-6 rounded-md border p-4 ${
              trail.verified
                ? "border-hairline bg-secondary/60"
                : "border-destructive/40 bg-destructive/10"
            }`}
          >
            <div className="flex items-center gap-2">
              {trail.verified ? (
                <ShieldCheck className="size-4 text-[color:var(--positive)]" />
              ) : (
                <ShieldAlert className="size-4 text-destructive" />
              )}
              <p className="eyebrow">Hashkedjan</p>
            </div>
            <p className="mt-1.5 text-sm">
              {trail.verified
                ? `Obruten. Alla ${trail.events.length} händelser stämmer med sitt innehåll och sin föregångare.`
                : `Bruten vid rad ${trail.brokenLinks.join(", ")}. Någon rad har ändrats i efterhand.`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Varje rad hashar föregående rads hash tillsammans med sitt eget innehåll. Hashen
              räknas fram av databasen, inte av tjänsten, så den som skriver kan inte förfalska den.
            </p>
          </section>

          <div className="hidden md:block">
            <DataGrid
              caption="Aktivitetslogg"
              columns={COLUMNS}
              rows={trail.events}
              rowKey={(event) => String(event.sequence)}
              empty="Ingen händelse registrerad än."
            />
          </div>
          <ul className="grid gap-2 md:hidden">
            {trail.events.map((event) => (
              <li key={event.sequence} className="tile-surface p-4">
                <p className="text-sm font-medium">{event.eventType}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {fmtDateTime(event.occurredAt)}
                  {event.actor ? ` · ${event.actor}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
