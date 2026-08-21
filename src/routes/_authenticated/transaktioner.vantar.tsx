import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { TransactionView } from "@/components/transaction-view";
import { useHouseholdData } from "@/hooks/use-household-data";
import { pendingTransactions } from "@/lib/calculation";

export const Route = createFileRoute("/_authenticated/transaktioner/vantar")({
  head: () => ({ meta: [{ title: "Väntar på godkännande – Mitt & Ditt" }] }),
  component: Pending,
});

function Pending() {
  const { agreement, rules, transactions } = useHouseholdData();
  const pending = pendingTransactions(transactions);

  return (
    <>
      <PageHeader
        eyebrow="Transaktioner"
        title="Väntar på godkännande"
        description="Posterna påverkar inte andelarna förrän båda parter har godkänt dem."
      />
      <TransactionView
        transactions={pending}
        agreement={agreement}
        rules={rules}
        empty="Inga poster väntar på godkännande."
      />
    </>
  );
}
