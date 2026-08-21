import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { TransactionList } from "@/components/transaction-list";
import { useHouseholdData } from "@/hooks/use-household-data";
import { compareDates } from "@/lib/engine";

export const Route = createFileRoute("/_authenticated/transaktioner/historik")({
  head: () => ({ meta: [{ title: "Historik – Mitt & Ditt" }] }),
  component: History,
});

function History() {
  const { agreement, transactions } = useHouseholdData();
  const sorted = [...transactions].sort((x, y) => compareDates(y.paymentDate, x.paymentDate));

  return (
    <>
      <PageHeader
        eyebrow="Transaktioner"
        title="Historik"
        description="Godkända poster raderas aldrig. Fel rättas med en ny, länkad korrigeringspost."
      />
      <TransactionList
        transactions={sorted}
        parties={agreement.parties}
        empty="Inga registrerade poster än."
      />
    </>
  );
}
