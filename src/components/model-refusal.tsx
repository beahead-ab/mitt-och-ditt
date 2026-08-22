import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ModelVersionError } from "@/lib/engine/engine";

/**
 * Vägran.
 *
 * När avtalet förutsätter en beräkningsmodell installationen inte kör visar
 * tjänsten inga andelar och ingen avräkning. Ett tal som ser rimligt ut men
 * bygger på fel regler är farligare än inget tal alls - det går att fatta
 * beslut på.
 *
 * Ingen primärknapp: det finns inget att göra här utom att förstå läget.
 * Samma princip som verifieringen av en frusen slutavräkning redan följer -
 * avviker motorn ska det synas, inte jämnas ut.
 */
export function ModelRefusal({ error }: { error: ModelVersionError }) {
  return (
    <section className="rounded-[var(--radius)] border border-destructive bg-card p-6">
      <div className="flex items-center gap-1.5">
        <ShieldAlert className="size-4 text-destructive" />
        <p className="eyebrow text-destructive">Beräkningen är pausad</p>
      </div>

      <h2 className="mt-1.5 font-serif text-xl font-medium leading-snug tracking-tight">
        Ert avtal förutsätter en beräkningsmodell vi inte längre kör
      </h2>

      <div className="mt-3 grid max-w-xl gap-2 text-sm leading-relaxed text-muted-foreground">
        <p>
          Handlingen bygger på modell {error.modelVersion}. Den här installationen kör{" "}
          {error.supported.join(", ")}. Att räkna ändå skulle ge tal som ser rimliga ut men följer
          andra regler än de ni skrivit under.
        </p>
        <p>
          Era poster, underlag och godkännanden ligger kvar oförändrade. Ingenting har raderats och
          ingenting räknas om.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to="/overenskommelse/versioner">Läs vad avtalet säger</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/system/revision">Hämta underlaget</Link>
        </Button>
      </div>
    </section>
  );
}
