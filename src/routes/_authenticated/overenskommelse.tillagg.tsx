import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { ComingUp } from "@/components/coming-up";

export const Route = createFileRoute("/_authenticated/overenskommelse/tillagg")({
  head: () => ({ meta: [{ title: "Tilläggsavtal – Mitt & Ditt" }] }),
  component: Pageoverenskommelsetillagg,
});

function Pageoverenskommelsetillagg() {
  return (
    <>
      <PageHeader
        eyebrow="Överenskommelse"
        title="Tilläggsavtal"
        description="Grundläggande förändringar kräver ett separat undertecknat tillägg."
      />
      <ComingUp stage="etapp 3">
        <p>
          Här laddas det undertecknade tillägget upp och bekräftas av båda parter. Först då låses
          motsvarande fält upp i den gällande överenskommelsen.
        </p>
      </ComingUp>
    </>
  );
}
