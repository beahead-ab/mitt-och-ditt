import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { ComingUp } from "@/components/coming-up";

export const Route = createFileRoute("/_authenticated/overenskommelse/versioner")({
  head: () => ({ meta: [{ title: "Avtalsversioner – Mitt & Ditt" }] }),
  component: Pageoverenskommelseversioner,
});

function Pageoverenskommelseversioner() {
  return (
    <>
      <PageHeader
        eyebrow="Överenskommelse"
        title="Avtalsversioner"
        description="Varje version har en checksumma och visar när respektive part godkände den."
      />
      <ComingUp stage="etapp 3">
        <p>
          Versionerna visas med innehåll, checksumma och godkännandetidpunkt per part. En ny version
          blir gällande först när båda parter godkänt den, och tidigare versioner sparas
          oförändrade.
        </p>
      </ComingUp>
    </>
  );
}
