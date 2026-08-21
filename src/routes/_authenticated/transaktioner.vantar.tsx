import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { TransactionList } from "@/components/transaction-list";
import { pendingTransactions } from "@/lib/calculation";
import { useHouseholdData } from "@/hooks/use-household-data";

export const Route = createFileRoute("/_authenticated/transaktioner/vantar")({
  head: () => ({ meta: [{ title: "Väntar på godkännande – Mitt & Ditt" }] }),
  component: Pending,
});

function Pending() {
  const { agreement, transactions } = useHouseholdData();
  const pending = pendingTransactions(transactions);

  return (
    <>
      <PageHeader
        eyebrow="Transaktioner"
        title="Väntar på godkännande"
        description="Posterna påverkar inte andelarna förrän båda parter har godkänt dem."
      />
      <TransactionList
        transactions={pending}
        parties={agreement.parties}
        empty="Inga poster väntar på godkännande."
      />
    </>
  );
}
