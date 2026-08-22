import { createFileRoute } from "@tanstack/react-router";
import { DemoNotice } from "@/components/demo-notice";
import { z } from "zod";

import { PageHeader } from "@/components/app-shell";
import { useHousehold } from "@/components/household-context";
import { NoAgreement } from "@/components/no-agreement";
import { TransactionForm } from "@/components/transaction-form";
import { useHouseholdData } from "@/hooks/use-household-data";
import { isDemo } from "@/lib/demo";

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
        <DemoNotice vad="Den som registrerar en betalning godkänner den i samma steg. Motparten tar ställning, och först när båda gjort det påverkar posten andelarna.">
          Poster raderas aldrig. Fel rättas med en korrigering, och en post som inte hör hit
          makuleras – båda syns i historiken.
        </DemoNotice>
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
