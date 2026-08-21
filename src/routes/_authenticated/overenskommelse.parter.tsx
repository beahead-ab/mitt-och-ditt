import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { ComingUp } from "@/components/coming-up";

export const Route = createFileRoute("/_authenticated/overenskommelse/parter")({
  head: () => ({ meta: [{ title: "Parter – Mitt & Ditt" }] }),
  component: Pageoverenskommelseparter,
});

function Pageoverenskommelseparter() {
  return (
    <>
      <PageHeader
        eyebrow="Överenskommelse"
        title="Parter"
        description="Vilka som ingår i hushållet och vem som får godkänna vad."
      />
      <ComingUp stage="etapp 2">
        <p>
          Parterna kopplas till inbjudna konton. Ingen kan godkänna för den andra – spärren ligger i
          databasen, inte bara i gränssnittet.
        </p>
        <p className="mt-2">
          Personnummer lagras inte i tjänsten. De finns i det undertecknade avtalet och behövs inte
          för någon funktion här.
        </p>
      </ComingUp>
    </>
  );
}
