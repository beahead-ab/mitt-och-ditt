import { Badge } from "@/components/ui/badge";
import { toKronor, type Transaction } from "@/lib/engine";
import { fmtDate, fmtKr } from "@/lib/format";
import { PARTY_LABELS } from "@/lib/seed";

const STATUS: Record<
  Transaction["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Utkast", variant: "outline" },
  pending: { label: "Väntar på godkännande", variant: "secondary" },
  approved: { label: "Godkänd av båda", variant: "default" },
  disputed: { label: "Tvistig", variant: "destructive" },
};

export function TransactionList({
  transactions,
  parties,
  empty,
}: {
  transactions: Transaction[];
  parties: string[];
  empty: string;
}) {
  if (transactions.length === 0) {
    return (
      <div className="tile-surface p-8 text-center">
        <p className="text-sm text-muted-foreground">{empty}</p>
      </div>
    );
  }

  return (
    <ul className="grid gap-2">
      {transactions.map((tx) => {
        const total = parties.reduce((sum, p) => sum + (tx.payments[p]?.gross ?? 0), 0);
        const payers = parties.filter((p) => (tx.payments[p]?.gross ?? 0) > 0);
        const preliminary = parties.some((p) => tx.payments[p]?.taxPreliminary);
        return (
          <li key={tx.id} className="tile-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{tx.category}</p>
                {tx.description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{tx.description}</p>
                )}
              </div>
              <p className="tabular font-serif text-lg font-medium">{fmtKr(toKronor(total))}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <span className="tabular">{tx.id}</span>
              <span>{fmtDate(tx.paymentDate)}</span>
              <span>Betalt av {payers.map((p) => PARTY_LABELS[p] ?? p).join(" och ") || "–"}</span>
              <Badge variant={STATUS[tx.status].variant} className="text-[0.7rem]">
                {STATUS[tx.status].label}
              </Badge>
              {preliminary && (
                <Badge variant="outline" className="text-[0.7rem]">
                  Preliminär skatteeffekt
                </Badge>
              )}
              {tx.correctsId && (
                <Badge variant="outline" className="text-[0.7rem]">
                  Korrigerar {tx.correctsId}
                </Badge>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
