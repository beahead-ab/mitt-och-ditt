import { useCallback } from "react";

import { DataGrid } from "@/components/data-grid";
import { usePartyName } from "@/components/household-context";
import { TransactionList } from "@/components/transaction-list";
import type { AgreementParams, CostCategoryRule, Transaction } from "@/lib/engine";
import { transactionColumns } from "@/lib/grid-columns";
import { fieldHistory, type RecordVersion } from "@/lib/revisions";

/**
 * Transaktionerna som matris på skärmar med plats, och som kortlista på
 * telefon. En bred tabell går inte att läsa på en liten skärm, och samma
 * uppgifter ska ändå vara åtkomliga där.
 */
export function TransactionView({
  transactions,
  agreement,
  rules,
  revisions,
  empty,
  onActivate,
}: {
  transactions: Transaction[];
  agreement: AgreementParams;
  rules: CostCategoryRule[];
  revisions?: Map<string, RecordVersion<Transaction>[]>;
  empty: string;
  onActivate?: (tx: Transaction) => void;
}) {
  const partyName = usePartyName();
  const columns = transactionColumns(agreement, rules, partyName);

  // Cellens historik härleds ur postens versioner med samma formatering som
  // rutnätet visar, så historiken kan aldrig säga emot det synliga värdet.
  const cellHistory = useCallback(
    (tx: Transaction, columnKey: string) => {
      const versions = revisions?.get(tx.id);
      const column = columns.find((c) => c.key === columnKey);
      if (!versions || !column) return [];
      return fieldHistory(versions, (values) => column.text(values));
    },
    [revisions, columns],
  );

  return (
    <>
      <div className="hidden md:block">
        <DataGrid
          caption="Transaktioner"
          columns={columns}
          rows={transactions}
          rowKey={(tx) => tx.id}
          onActivate={onActivate}
          cellHistory={revisions ? cellHistory : undefined}
          personName={partyName}
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
