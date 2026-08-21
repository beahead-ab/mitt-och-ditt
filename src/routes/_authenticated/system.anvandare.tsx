import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { ComingUp } from "@/components/coming-up";

export const Route = createFileRoute("/_authenticated/system/anvandare")({
  head: () => ({ meta: [{ title: "Användare – Mitt & Ditt" }] }),
  component: Pagesystemanvandare,
});

function Pagesystemanvandare() {
  return (
    <>
      <PageHeader
        eyebrow="Systemadmin"
        title="Användare"
        description="Endast för behörig administratör."
      />
      <ComingUp stage="etapp 2">
        <p>Inbjudna konton och deras koppling till hushåll och part.</p>
      </ComingUp>
    </>
  );
}
