import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { ComingUp } from "@/components/coming-up";

export const Route = createFileRoute("/_authenticated/system/hushall")({
  head: () => ({ meta: [{ title: "Hushåll – Mitt & Ditt" }] }),
  component: Pagesystemhushall,
});

function Pagesystemhushall() {
  return (
    <>
      <PageHeader
        eyebrow="Systemadmin"
        title="Hushåll"
        description="Endast för behörig administratör."
      />
      <ComingUp stage="etapp 2">
        <p>Hushåll, bostad och avtalskoppling.</p>
      </ComingUp>
    </>
  );
}
