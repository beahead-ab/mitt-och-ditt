import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { PageHeader } from "@/components/app-shell";
import { DataGrid } from "@/components/data-grid";
import { Explain, TERMS } from "@/components/explain";
import { TransactionView } from "@/components/transaction-view";
import { useHouseholdData } from "@/hooks/use-household-data";
import { defaultEndpoint, run } from "@/lib/calculation";
import { compareDates } from "@/lib/engine";
import { dayEventColumns } from "@/lib/grid-columns";

export const Route = createFileRoute("/_authenticated/transaktioner/historik")({
  head: () => ({ meta: [{ title: "Historik – Mitt & Ditt" }] }),
  component: History,
});

function History() {
  const { agreement, rules, transactions } = useHouseholdData();
  const sorted = useMemo(
    () => [...transactions].sort((x, y) => compareDates(y.paymentDate, x.paymentDate)),
    [transactions],
  );
  const result = useMemo(() => {
    const endpoint = defaultEndpoint(agreement, rules, transactions);
    return run(agreement, rules, transactions, endpoint);
  }, [agreement, rules, transactions]);

  return (
    <>
      <PageHeader
        eyebrow="Transaktioner"
        title="Historik"
        description="Godkända poster raderas aldrig. Fel rättas med en ny, länkad korrigeringspost."
      />

      <TransactionView
        transactions={sorted}
        agreement={agreement}
        rules={rules}
        empty="Inga registrerade poster än."
      />

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
