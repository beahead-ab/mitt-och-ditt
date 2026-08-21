import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { ComingUp } from "@/components/coming-up";

export const Route = createFileRoute("/_authenticated/system/inbjudningar")({
  head: () => ({ meta: [{ title: "Inbjudningar – Mitt & Ditt" }] }),
  component: Pagesysteminbjudningar,
});

function Pagesysteminbjudningar() {
  return (
    <>
      <PageHeader
        eyebrow="Systemadmin"
        title="Inbjudningar"
        description="Tjänsten är endast för inbjudna."
      />
      <ComingUp stage="etapp 2">
        <p>Skapa och återkalla inbjudningar. Ingen öppen registrering finns.</p>
      </ComingUp>
    </>
  );
}
