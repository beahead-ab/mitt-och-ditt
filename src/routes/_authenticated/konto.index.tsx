import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { ComingUp } from "@/components/coming-up";

export const Route = createFileRoute("/_authenticated/konto/")({
  head: () => ({ meta: [{ title: "Mitt konto – Mitt & Ditt" }] }),
  component: Pagekontoindex,
});

function Pagekontoindex() {
  return (
    <>
      <PageHeader
        eyebrow="Konto"
        title="Mitt konto"
        description="Dina uppgifter och inställningar."
      />
      <ComingUp stage="etapp 2">
        <p>Namn, e-post och lösenord. Notiser byggs senare.</p>
      </ComingUp>
    </>
  );
}
