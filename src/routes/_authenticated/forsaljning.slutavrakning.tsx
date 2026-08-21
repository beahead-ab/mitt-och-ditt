import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Lock, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { ExportMenu } from "@/components/export-menu";
import { useHousehold } from "@/components/household-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useHouseholdData } from "@/hooks/use-household-data";
import { useMyParty } from "@/hooks/use-my-party";
import { today } from "@/lib/calculation";
import { isDemo } from "@/lib/demo";
import { kr, toKronor, type EngineResult } from "@/lib/engine";
import {
  createSettlementFn,
  getExit,
  getSettlementResult,
  verifySettlementFn,
} from "@/lib/exit.functions";
import { exportFilename } from "@/lib/export/csv";
import { downloadText } from "@/lib/export/download";
import { downloadMarkdownAsPdf } from "@/lib/export/pdf";
import { settlementMarkdown, type ValueBasis } from "@/lib/export/settlement";
import { fmtDateTime, fmtKr } from "@/lib/format";
import { approveDocumentFn } from "@/lib/transactions.functions";

export const Route = createFileRoute("/_authenticated/forsaljning/slutavrakning")({
  head: () => ({ meta: [{ title: "Slutavräkning – Mitt & Ditt" }] }),
  component: SettlementPage,
});

function SettlementPage() {
  const { household } = useHousehold();
  const { agreement } = useHouseholdData();
  const myPartyId = useMyParty();
  const queryClient = useQueryClient();

  const [basis, setBasis] = useState<ValueBasis>("extern-forsaljning");
  const [endDate, setEndDate] = useState(today);
  const [endValue, setEndValue] = useState("");
  const [endLoan, setEndLoan] = useState("");
  const [saleCosts, setSaleCosts] = useState("0");
  const [notes, setNotes] = useState("");

  const query = useQuery({
    queryKey: ["exit", household?.id],
    queryFn: () => getExit({ data: { householdId: household?.id as string } }),
    enabled: !isDemo && Boolean(household?.id),
  });

  const money = (value: string) => kr(Number(value.replace(/\s/g, "").replace(",", ".")) || 0);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["exit"] });

  const create = useMutation({
    mutationFn: () =>
      createSettlementFn({
        data: {
          householdId: household?.id as string,
          basis,
          endDate,
          endValue: money(endValue),
          endLoan: money(endLoan),
          saleCosts: money(saleCosts),
          notes: notes || undefined,
          exitProcessId: query.data?.process?.id,
        },
      }),
    onSuccess: (result) => {
      toast.success(`Slutavräkningen skapad. Checksumma ${result.checksum.slice(0, 12)}…`);
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message || "Kunde inte skapa slutavräkningen."),
  });

  const approve = useMutation({
    mutationFn: (settlementId: string) =>
      approveDocumentFn({
        data: {
          householdId: household?.id as string,
          entityType: "settlement",
          entityId: settlementId,
        },
      }),
    onSuccess: () => {
      toast.success("Du har godkänt slutavräkningen");
      void refresh();
    },
    onError: () => toast.error("Kunde inte registrera godkännandet."),
  });

  if (isDemo) {
    return (
      <>
        <PageHeader eyebrow="Försäljning & utköp" title="Slutavräkning" />
        <div className="tile-surface p-6 text-sm text-muted-foreground">
          Slutavräkningen kräver databas.
        </div>
      </>
    );
  }

  const settlements = query.data?.settlements ?? [];
  const outcome = query.data?.outcome ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Försäljning & utköp"
        title="Slutavräkning"
        description="Beräkningen fryses med sina indata och kan alltid räknas om och jämföras."
      />

      {settlements.length > 0 && (
        <div className="mb-6 grid gap-4">
          {settlements.map((settlement) => (
            <SettlementCard
              key={settlement.id}
              householdId={household?.id as string}
              settlement={settlement}
              agreement={agreement}
              names={Object.fromEntries((household?.parties ?? []).map((p) => [p.partyId, p.name]))}
              householdName={household?.name ?? ""}
              propertyAddress={household?.propertyAddress ?? null}
              myPartyId={myPartyId}
              onApprove={() => approve.mutate(settlement.id)}
              approving={approve.isPending}
            />
          ))}
        </div>
      )}

      <section className="tile-surface p-5">
        <p className="eyebrow mb-3">Ny slutavräkning</p>
        {outcome?.value != null && (
          <p className="mb-4 rounded-md border border-hairline bg-secondary/60 p-3 text-sm">
            Värderingarna ger {fmtKr(toKronor(outcome.value))} som fastställt värde.
          </p>
        )}
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="basis">Slutvärdets grund</Label>
            <Select value={basis} onValueChange={(value) => setBasis(value as ValueBasis)}>
              <SelectTrigger id="basis">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="extern-forsaljning">Extern försäljning</SelectItem>
                <SelectItem value="utkopsvardering">Utköpsvärdering</SelectItem>
                <SelectItem value="annan">Annan grund</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="endDate">Slutdag</Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="endValue">Slutvärde</Label>
            <Input
              id="endValue"
              inputMode="decimal"
              className="tabular"
              value={endValue}
              onChange={(event) => setEndValue(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="endLoan">Kvarvarande externa lån</Label>
            <Input
              id="endLoan"
              inputMode="decimal"
              className="tabular"
              value={endLoan}
              onChange={(event) => setEndLoan(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="saleCosts">Faktiska direkta försäljningskostnader</Label>
            <Input
              id="saleCosts"
              inputMode="decimal"
              className="tabular"
              value={saleCosts}
              onChange={(event) => setSaleCosts(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Vid utköp normalt 0. Hypotetiskt mäklararvode dras aldrig av.
            </p>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="notes">Underlag och kommentarer</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Tas med i protokollet."
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Beräknar …" : "Skapa och frys slutavräkningen"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Underlaget hämtas om från databasen när avräkningen skapas, så det som fryses är
              hushållets faktiska poster.
            </p>
          </div>
        </form>
      </section>
    </>
  );
}

type SettlementRow = {
  id: string;
  basis: string;
  endDate: string;
  endValue: number;
  endLoan: number;
  saleCosts: number;
  agreementSignedOn: string | null;
  notes: string | null;
  engineVersion: string;
  checksum: string;
  createdAt: string;
  lockedAt: string | null;
  approvedBy: string[];
};

function SettlementCard({
  householdId,
  settlement,
  agreement,
  names,
  householdName,
  propertyAddress,
  myPartyId,
  onApprove,
  approving,
}: {
  householdId: string;
  settlement: SettlementRow;
  agreement: ReturnType<typeof useHouseholdData>["agreement"];
  names: Record<string, string>;
  householdName: string;
  propertyAddress: string | null;
  myPartyId: string | null;
  onApprove: () => void;
  approving: boolean;
}) {
  const [verification, setVerification] = useState<Awaited<
    ReturnType<typeof verifySettlementFn>
  > | null>(null);

  const verify = useMutation({
    mutationFn: () => verifySettlementFn({ data: { householdId, settlementId: settlement.id } }),
    onSuccess: (result) => {
      setVerification(result);
      toast[result?.matches ? "success" : "error"](
        result?.matches
          ? "Omräkningen gav exakt samma resultat"
          : "Omräkningen avviker från den frysta beräkningen",
      );
    },
    onError: () => toast.error("Kunde inte verifiera avräkningen."),
  });

  async function protocol(as: "pdf" | "md") {
    if (!agreement) return;
    const raw = await getSettlementResult({ data: { householdId, settlementId: settlement.id } });
    if (!raw) throw new Error("Kunde inte hämta den frysta beräkningen.");
    const result = JSON.parse(raw) as EngineResult;

    const markdown = settlementMarkdown(
      {
        householdName,
        propertyAddress,
        agreement,
        names,
        generatedAt: new Date().toISOString(),
        engineVersion: settlement.engineVersion,
      },
      result,
      {
        agreementSignedOn: settlement.agreementSignedOn,
        endDate: settlement.endDate,
        basis: settlement.basis as ValueBasis,
        endValue: settlement.endValue,
        endLoan: settlement.endLoan,
        saleCosts: settlement.saleCosts,
        notes: settlement.notes,
        checksum: settlement.checksum,
      },
    );

    const filename = exportFilename("slutberakningsprotokoll", as, settlement.createdAt);
    if (as === "pdf") downloadMarkdownAsPdf(markdown, "Slutberäkningsprotokoll", filename);
    else downloadText(markdown, filename, "text/markdown");
  }

  const iHaveApproved = myPartyId ? settlement.approvedBy.includes(myPartyId) : false;

  return (
    <section className="tile-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {settlement.lockedAt && <Lock className="size-3.5 text-muted-foreground" />}
            <p className="text-sm font-medium">Slutvärde {fmtKr(toKronor(settlement.endValue))}</p>
          </div>
          <p className="tabular mt-0.5 text-xs text-muted-foreground">
            Skapad {fmtDateTime(settlement.createdAt)} · motor {settlement.engineVersion} ·
            checksumma {settlement.checksum.slice(0, 16)}…
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {settlement.lockedAt
              ? `Låst ${fmtDateTime(settlement.lockedAt)}. Kan inte ändras.`
              : `Godkänd av ${settlement.approvedBy.length} av 2 parter.`}
          </p>
        </div>
        <ExportMenu
          label="Protokoll"
          groups={[
            {
              title: "Slutberäkningsprotokoll",
              choices: [
                {
                  label: "Protokoll (PDF)",
                  hint: "Bilaga 3, klart att skriva under.",
                  run: () => protocol("pdf"),
                },
                { label: "Protokoll (Markdown)", run: () => protocol("md") },
              ],
            },
          ]}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
        <Button
          size="sm"
          variant="outline"
          disabled={verify.isPending}
          onClick={() => verify.mutate()}
        >
          <RefreshCw className="mr-1.5 size-3.5" />
          Verifiera igen
        </Button>
        {!settlement.lockedAt && myPartyId && (
          <Button size="sm" disabled={iHaveApproved || approving} onClick={onApprove}>
            {iHaveApproved ? "Du har godkänt" : "Godkänn slutavräkningen"}
          </Button>
        )}
      </div>

      {verification && (
        <div
          className={`mt-3 rounded-md border p-3 ${
            verification.matches
              ? "border-hairline bg-secondary/60"
              : "border-destructive/40 bg-destructive/10"
          }`}
        >
          <div className="flex items-center gap-1.5">
            {verification.matches ? (
              <ShieldCheck className="size-3.5 text-[color:var(--positive)]" />
            ) : (
              <ShieldAlert className="size-3.5 text-destructive" />
            )}
            <p className="eyebrow">Omräkning</p>
          </div>
          <p className="mt-1.5 text-sm">
            {verification.matches
              ? "Beräkningen räknades om ur sina frysta indata och gav exakt samma resultat."
              : "Omräkningen gav ett annat resultat än det frysta. Underlaget eller beräkningsmotorn har ändrats."}
          </p>
          <p className="tabular mt-1 text-xs text-muted-foreground">
            Sparad checksumma {verification.storedChecksum.slice(0, 16)}… · omräknad{" "}
            {verification.recomputedChecksum.slice(0, 16)}…
          </p>
          {verification.engineVersion !== verification.currentEngineVersion && (
            <p className="mt-1 text-xs text-muted-foreground">
              Avräkningen gjordes med motor {verification.engineVersion}, omräkningen med{" "}
              {verification.currentEngineVersion}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
