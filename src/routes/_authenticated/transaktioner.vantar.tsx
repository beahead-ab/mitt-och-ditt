import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { useHousehold } from "@/components/household-context";
import { NoAgreement } from "@/components/no-agreement";
import { TransactionActions } from "@/components/transaction-actions";
import { TransactionView } from "@/components/transaction-view";
import { useHouseholdData } from "@/hooks/use-household-data";
import { pendingTransactions } from "@/lib/calculation";
import { toKronor } from "@/lib/engine";
import { fmtDate, fmtKr } from "@/lib/format";
import { useMyParty } from "@/hooks/use-my-party";
import { isDemo } from "@/lib/demo";

export const Route = createFileRoute("/_authenticated/transaktioner/vantar")({
  head: () => ({ meta: [{ title: "Väntar på godkännande – Mitt & Ditt" }] }),
  component: Pending,
});

function Pending() {
  const { household } = useHousehold();
  const { agreement, rules, revisions, transactions, isLoading } = useHouseholdData();
  const myPartyId = useMyParty();
  const navigate = useNavigate();
  const pending = pendingTransactions(transactions);

  if (!agreement) {
    return (
      <>
        <PageHeader eyebrow="Transaktioner" title="Väntar på godkännande" />
        <NoAgreement loading={isLoading} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Transaktioner"
        title="Väntar på godkännande"
        description="Posterna påverkar inte andelarna förrän båda parter har godkänt dem."
      />

      {pending.length > 0 && household && !isDemo && myPartyId && (
        <div className="mb-6 grid gap-3">
          {pending.map((tx) => {
            const versions = revisions.get(tx.id) ?? [];
            const latest = versions[versions.length - 1];
            const registeredBy = latest?.authorId ?? "";
            const total = agreement.parties.reduce(
              (sum, p) => sum + (tx.payments[p]?.gross ?? 0),
              0,
            );
            return (
              <div key={tx.id} className="tile-surface p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {tx.id} · {tx.category}
                    </p>
                    {tx.description && (
                      <p className="mt-0.5 text-sm text-muted-foreground">{tx.description}</p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Betalningsdag {fmtDate(tx.paymentDate)}
                      {tx.reason ? ` · ${tx.reason}` : ""}
                    </p>
                  </div>
                  <p className="tabular font-serif text-lg font-medium">{fmtKr(toKronor(total))}</p>
                </div>
                <div className="mt-4">
                  <TransactionActions
                    householdId={household.id}
                    transaction={tx}
                    myPartyId={myPartyId}
                    registeredByPartyId={registeredBy}
                    iHaveDecided={Boolean(latest?.approvedBy?.[myPartyId])}
                    onCorrect={(reference) =>
                      navigate({ to: "/transaktioner", search: { korrigerar: reference } })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TransactionView
        transactions={pending}
        agreement={agreement}
        rules={rules}
        empty="Inga poster väntar på godkännande."
      />
    </>
  );
}
