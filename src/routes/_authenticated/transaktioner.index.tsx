import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { ComingUp } from "@/components/coming-up";

export const Route = createFileRoute("/_authenticated/transaktioner/")({
  head: () => ({ meta: [{ title: "Registrera transaktion – Mitt & Ditt" }] }),
  component: Register,
});

function Register() {
  return (
    <>
      <PageHeader
        eyebrow="Transaktioner"
        title="Registrera"
        description="En rad per betalning, med underlag och båda parters godkännande."
      />
      <ComingUp stage="etapp 3">
        <p>
          Registreringsformuläret sparar betalningsdag, kostnadsslag, betalare, bruttobelopp,
          rabatt, återbetalning, försäkringsersättning och faktisk skatteeffekt per part, samt
          underlag som bild eller fil.
        </p>
        <p className="mt-2">
          Den som registrerar bekräftar posten i samma steg. Motparten godkänner eller invänder
          separat – ingen kan godkänna för den andra. Först när båda godkänt påverkar posten
          andelarna.
        </p>
      </ComingUp>
    </>
  );
}
