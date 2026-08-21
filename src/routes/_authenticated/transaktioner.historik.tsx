import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { History, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/app-shell";
import { DataGrid } from "@/components/data-grid";
import { Explain, TERMS } from "@/components/explain";
import { TransactionActions } from "@/components/transaction-actions";
import { TransactionView } from "@/components/transaction-view";
import { useHousehold } from "@/components/household-context";
import { useMyParty } from "@/hooks/use-my-party";
import { isDemo } from "@/lib/demo";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHouseholdData } from "@/hooks/use-household-data";
import { defaultEndpoint, run } from "@/lib/calculation";
import { NoAgreement } from "@/components/no-agreement";
import {
  compareDates,
  type AgreementParams,
  type CostCategoryRule,
  type Transaction,
} from "@/lib/engine";
import { fmtDateTime } from "@/lib/format";
import { dayEventColumns } from "@/lib/grid-columns";
import { recordsAsOf, timeline, type RecordVersion } from "@/lib/revisions";

export const Route = createFileRoute("/_authenticated/transaktioner/historik")({
  head: () => ({ meta: [{ title: "Historik – Mitt & Ditt" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const { agreement, rules, transactions, revisions, isLoading } = useHouseholdData();
  if (!agreement) {
    return (
      <>
        <PageHeader eyebrow="Transaktioner" title="Historik" />
        <NoAgreement loading={isLoading} />
      </>
    );
  }
  return (
    <HistoryFor
      agreement={agreement}
      rules={rules}
      transactions={transactions}
      revisions={revisions}
    />
  );
}

function HistoryFor({
  agreement,
  rules,
  transactions,
  revisions,
}: {
  agreement: AgreementParams;
  rules: CostCategoryRule[];
  transactions: Transaction[];
  revisions: Map<string, RecordVersion<Transaction>[]>;
}) {
  /** null = nuläget. Annars den tidpunkt underlaget visas som det såg ut då. */
  const [asOf, setAsOf] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { household } = useHousehold();
  const myPartyId = useMyParty();
  const navigate = useNavigate();

  // Poster som redan är ersatta eller makulerade av en godkänd post.
  const supersededReferences = useMemo(
    () =>
      new Set(
        transactions
          .filter((t) => t.status === "approved" && t.correctsId)
          .map((t) => t.correctsId as string),
      ),
    [transactions],
  );
  const voidedReferences = useMemo(
    () =>
      new Set(
        transactions
          .filter((t) => t.status === "approved" && t.voidsId)
          .map((t) => t.voidsId as string),
      ),
    [transactions],
  );

  const points = useMemo(() => timeline(revisions), [revisions]);

  const shown = useMemo(() => {
    const rows = asOf ? recordsAsOf(revisions, asOf) : transactions;
    return [...rows].sort((x, y) => compareDates(y.paymentDate, x.paymentDate));
  }, [asOf, revisions, transactions]);

  const selectedTransaction = transactions.find((t) => t.id === selected) ?? null;

  const result = useMemo(() => {
    const endpoint = defaultEndpoint(agreement, rules, shown);
    return run(agreement, rules, shown, endpoint);
  }, [agreement, rules, shown]);

  return (
    <>
      <PageHeader
        eyebrow="Transaktioner"
        title="Historik"
        description="Godkända poster raderas aldrig. Fel rättas med en korrigering, och en post som inte hör hit makuleras."
      />

      {points.length > 0 && (
        <section className="tile-surface mb-4 flex flex-wrap items-center gap-3 p-4">
          <div className="flex items-center gap-1.5">
            <History className="size-3.5 text-muted-foreground" />
            <p className="eyebrow">Visa läget</p>
          </div>
          <Select
            value={asOf ?? "nu"}
            onValueChange={(value) => setAsOf(value === "nu" ? null : value)}
          >
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nu">Nu</SelectItem>
              {[...points].reverse().map((point) => (
                <SelectItem key={point.at} value={point.at}>
                  {fmtDateTime(point.at)} · {point.changes}{" "}
                  {point.changes === 1 ? "ändring" : "ändringar"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {asOf && (
            <Button variant="ghost" size="sm" onClick={() => setAsOf(null)}>
              <RotateCcw className="mr-1.5 size-3.5" /> Tillbaka till nu
            </Button>
          )}
        </section>
      )}

      {asOf && (
        <p className="mb-4 rounded-md border border-hairline bg-secondary/60 p-3 text-sm leading-relaxed">
          Du ser underlaget som det såg ut {fmtDateTime(asOf)}. Både posterna och beräkningen är
          återskapade för den tidpunkten – ingenting här är redigerbart.
        </p>
      )}

      <TransactionView
        transactions={shown}
        agreement={agreement}
        rules={rules}
        revisions={asOf ? undefined : revisions}
        empty={
          asOf
            ? "Inga poster hade registrerats vid den tidpunkten."
            : "Inga registrerade poster än."
        }
        onActivate={(tx) => setSelected(tx.id)}
      />

      {selectedTransaction && household && myPartyId && !isDemo && !asOf && (
        <section className="tile-surface mt-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">
              {selectedTransaction.id} · {selectedTransaction.category}
            </p>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(null)}
            >
              Stäng
            </button>
          </div>
          <div className="mt-3">
            <TransactionActions
              householdId={household.id}
              transaction={selectedTransaction}
              myPartyId={myPartyId}
              registeredByPartyId={
                (revisions.get(selectedTransaction.id) ?? []).slice(-1)[0]?.authorId ?? ""
              }
              iHaveDecided={Boolean(
                (revisions.get(selectedTransaction.id) ?? []).slice(-1)[0]?.approvedBy?.[myPartyId],
              )}
              isVoided={voidedReferences.has(selectedTransaction.id)}
              isSuperseded={supersededReferences.has(selectedTransaction.id)}
              onCorrect={(reference) =>
                navigate({ to: "/transaktioner", search: { korrigerar: reference } })
              }
            />
          </div>
        </section>
      )}

      {result.events.length > 0 && (
        <section className="mt-8">
          <div className="mb-2 flex items-center gap-1.5">
            <p className="eyebrow">Dagsberäkning</p>
            <Explain {...TERMS.enhetsvarde} />
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            Varje betalningsdag med godkända poster, steg för steg. Poster samma dag nettas och
            behandlas som en samlad post.
          </p>
          <div className="hidden md:block">
            <DataGrid
              caption="Dagsberäkning"
              columns={dayEventColumns(agreement)}
              rows={result.events}
              rowKey={(event) => event.date}
              empty="Inga godkända poster påverkar andelarna än."
            />
          </div>
          <p className="text-sm text-muted-foreground md:hidden">
            Dagsberäkningen visas på större skärm, där hela matrisen får plats.
          </p>
        </section>
      )}
    </>
  );
}
