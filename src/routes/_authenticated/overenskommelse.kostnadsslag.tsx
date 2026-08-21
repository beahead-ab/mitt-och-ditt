import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { PageHeader } from "@/components/app-shell";
import { DataGrid } from "@/components/data-grid";
import { Explain, TERMS } from "@/components/explain";
import { Badge } from "@/components/ui/badge";
import { useHouseholdData } from "@/hooks/use-household-data";
import { fmtDate } from "@/lib/format";
import { categoryColumns } from "@/lib/grid-columns";

export const Route = createFileRoute("/_authenticated/overenskommelse/kostnadsslag")({
  head: () => ({ meta: [{ title: "Kostnadsslag – Mitt & Ditt" }] }),
  component: Categories,
});

function Categories() {
  const { rules } = useHouseholdData();
  const sorted = useMemo(
    () =>
      [...rules].sort((a, b) =>
        a.included === b.included
          ? a.category.localeCompare(b.category, "sv")
          : a.included
            ? -1
            : 1,
      ),
    [rules],
  );

  return (
    <>
      <PageHeader
        eyebrow="Överenskommelse"
        title="Kostnadsslag"
        description="Avgör vilka kostnader som ger andelsenheter och vilka som delas vid sidan av modellen."
        info={<Explain {...TERMS.utanforModellen} />}
      />

      <div className="hidden md:block">
        <DataGrid
          caption="Kostnadsslag"
          columns={categoryColumns()}
          rows={sorted}
          rowKey={(rule) => `${rule.category}-${rule.effectiveFrom}`}
          rowTone={(rule) => (rule.approved ? "default" : "attention")}
          empty="Inga klassificeringar än."
        />
      </div>

      <ul className="grid gap-2 md:hidden">
        {sorted.map((rule) => (
          <li key={`${rule.category}-${rule.effectiveFrom}`} className="tile-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{rule.category}</p>
              <Badge variant={rule.approved ? "default" : "secondary"} className="text-[0.7rem]">
                {rule.approved ? "Gäller" : "Inväntar båda"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {rule.included ? "Ingår i enhetsmodellen" : "Delas 50/50 utanför modellen"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Gäller från {fmtDate(rule.effectiveFrom)}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm text-muted-foreground">
        Ett nytt eller oklart kostnadsslag ligger alltid utanför enhetsmodellen tills båda parter
        godkänt om det ingår, från vilket datum klassificeringen gäller och hur kostnaden annars ska
        fördelas. En klassificering gäller aldrig bakåt i tiden.
      </p>
    </>
  );
}
