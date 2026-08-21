import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { ComingUp } from "@/components/coming-up";

export const Route = createFileRoute("/_authenticated/forsaljning/varderingar")({
  head: () => ({ meta: [{ title: "Värderingar – Mitt & Ditt" }] }),
  component: Pageforsaljningvarderingar,
});

function Pageforsaljningvarderingar() {
  return (
    <>
      <PageHeader
        eyebrow="Försäljning & utköp"
        title="Värderingar"
        description="Fastställt värde vid utköp, enligt avtalets värderingsregel."
      />
      <ComingUp stage="etapp 6">
        <p>
          Varje part utser en oberoende mäklare. Skiljer sig värderingarna med högst tio procent av
          sitt genomsnitt gäller genomsnittet, annars tas en tredje värdering in och det mittersta
          värdet gäller. Beräkningen visas öppet.
        </p>
      </ComingUp>
    </>
  );
}
