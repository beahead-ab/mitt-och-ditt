import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { PageHeader } from "@/components/app-shell";
import { useHousehold } from "@/components/household-context";
import { NoAgreement } from "@/components/no-agreement";
import { TransactionForm } from "@/components/transaction-form";
import { useHouseholdData } from "@/hooks/use-household-data";
import { DEMO_HOUSEHOLD, isDemo } from "@/lib/demo";

export const Route = createFileRoute("/_authenticated/transaktioner/")({
  // Korrigering öppnar samma formulär med posten som ska ersättas angiven.
  validateSearch: z.object({ korrigerar: z.string().max(20).optional() }),
  head: () => ({ meta: [{ title: "Registrera transaktion – Mitt & Ditt" }] }),
  component: Register,
});

function Register() {
  const { household } = useHousehold();
  const { agreement, rules, isLoading } = useHouseholdData();
  const { korrigerar } = Route.useSearch();

  return (
    <>
      <PageHeader
        eyebrow="Transaktioner"
        title={korrigerar ? `Korrigera ${korrigerar}` : "Registrera"}
        description={
          korrigerar
            ? "Den nya posten ersätter den gamla när båda parter godkänt den. Ursprungsposten ligger kvar."
            : "En rad per betalning, med underlag och båda parters godkännande."
        }
      />

      {isDemo ? (
        <>
          <p className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-secondary/60 p-3 text-sm">
            <span className="inline-flex rounded-full border border-hairline bg-card px-2.5 py-0.5 text-xs text-muted-foreground">
              Exempel
            </span>
            Formuläret går att fylla i och läsa. Att spara är avstängt i demoläget.
          </p>
          <TransactionForm
            disabled
            householdId={DEMO_HOUSEHOLD.id}
            parties={(household?.parties ?? []).map((p) => ({ partyId: p.partyId, name: p.name }))}
            rules={rules}
            correctsReference={korrigerar}
          />
        </>
      ) : !agreement || !household ? (
        <NoAgreement loading={isLoading} />
      ) : (
        <TransactionForm
          householdId={household.id}
          parties={household.parties.map((p) => ({ partyId: p.partyId, name: p.name }))}
          rules={rules}
          correctsReference={korrigerar}
        />
      )}
    </>
  );
}
