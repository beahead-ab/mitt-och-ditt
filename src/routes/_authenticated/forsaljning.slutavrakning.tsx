import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { ComingUp } from "@/components/coming-up";

export const Route = createFileRoute("/_authenticated/forsaljning/slutavrakning")({
  head: () => ({ meta: [{ title: "Slutavräkning – Mitt & Ditt" }] }),
  component: Pageforsaljningslutavrakning,
});

function Pageforsaljningslutavrakning() {
  return (
    <>
      <PageHeader
        eyebrow="Försäljning & utköp"
        title="Slutavräkning"
        description="Bindande beräkning med verkliga uppgifter, som kan verifieras om."
      />
      <ComingUp stage="etapp 6">
        <p>
          Slutavräkningen fryser avtalsversion, godkända transaktioner, lånesaldon, slutdag,
          slutvärde och motorversion. Protokollet genereras, båda parter godkänner, och därefter
          låses beräkningen.
        </p>
        <p className="mt-2">
          Resultatet kan alltid verifieras genom att köra om beräkningen på samma frysta indata.
        </p>
      </ComingUp>
    </>
  );
}
