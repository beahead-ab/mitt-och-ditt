import { DataGrid } from "@/components/data-grid";
import { TransactionList } from "@/components/transaction-list";
import { transactionColumns } from "@/lib/grid-columns";
import type { AgreementParams, CostCategoryRule, Transaction } from "@/lib/engine";

/**
 * Transaktionerna som matris på skärmar med plats, och som kortlista på
 * telefon. En bred tabell går inte att läsa på en liten skärm, och samma
 * uppgifter ska ändå vara åtkomliga där.
 */
export function TransactionView({
  transactions,
  agreement,
  rules,
  empty,
  onActivate,
}: {
  transactions: Transaction[];
  agreement: AgreementParams;
  rules: CostCategoryRule[];
  empty: string;
  onActivate?: (tx: Transaction) => void;
}) {
  return (
    <>
      <div className="hidden md:block">
        <DataGrid
          caption="Transaktioner"
          columns={transactionColumns(agreement, rules)}
          rows={transactions}
          rowKey={(tx) => tx.id}
          onActivate={onActivate}
          rowTone={(tx) =>
            tx.status === "approved" ? "default" : tx.status === "disputed" ? "attention" : "muted"
          }
          empty={empty}
        />
      </div>
      <div className="md:hidden">
        <TransactionList transactions={transactions} parties={agreement.parties} empty={empty} />
      </div>
    </>
  );
}
