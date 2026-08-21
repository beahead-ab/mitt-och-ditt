import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { ComingUp } from "@/components/coming-up";

export const Route = createFileRoute("/_authenticated/forsaljning/")({
  head: () => ({ meta: [{ title: "Försäljning och utköp – Mitt & Ditt" }] }),
  component: Pageforsaljningindex,
});

function Pageforsaljningindex() {
  return (
    <>
      <PageHeader
        eyebrow="Försäljning & utköp"
        title="Process"
        description="Processdag, tidslinje och checklista fram till genomförd exit."
      />
      <ComingUp stage="etapp 6">
        <p>
          När någon skriftligen startar separationsprocessen skapas en processdag med två frister:
          besked om övertagande inom 14 dagar, och utköp genomfört eller bostaden utlagd till
          försäljning inom tre månader.
        </p>
        <p className="mt-2">
          Tjänsten visar påminnelser men genomför aldrig några externa åtgärder automatiskt.
        </p>
      </ComingUp>
    </>
  );
}
