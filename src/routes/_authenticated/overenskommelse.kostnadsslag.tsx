import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";
import { Explain, TERMS } from "@/components/explain";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { useHouseholdData } from "@/hooks/use-household-data";

export const Route = createFileRoute("/_authenticated/overenskommelse/kostnadsslag")({
  head: () => ({ meta: [{ title: "Kostnadsslag – Mitt & Ditt" }] }),
  component: Categories,
});

function Categories() {
  const { rules: rawRules } = useHouseholdData();
  const rules = [...rawRules].sort((a, b) =>
    a.included === b.included ? a.category.localeCompare(b.category, "sv") : a.included ? -1 : 1,
  );

  return (
    <>
      <PageHeader
        eyebrow="Överenskommelse"
        title="Kostnadsslag"
        description="Avgör vilka kostnader som ger andelsenheter och vilka som delas vid sidan av modellen."
        info={<Explain {...TERMS.utanforModellen} />}
      />

      <div className="tile-surface overflow-x-auto p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kostnadsslag</TableHead>
              <TableHead>Behandling</TableHead>
              <TableHead>Gäller från</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={`${rule.category}-${rule.effectiveFrom}`}>
                <TableCell className="font-medium">{rule.category}</TableCell>
                <TableCell>
                  {rule.included ? "Ingår i enhetsmodellen" : "Delas 50/50 utanför modellen"}
                </TableCell>
                <TableCell className="tabular">{fmtDate(rule.effectiveFrom)}</TableCell>
                <TableCell>
                  <Badge variant={rule.approved ? "default" : "secondary"}>
                    {rule.approved ? "Gäller" : "Inväntar båda"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        Ett nytt eller oklart kostnadsslag ligger alltid utanför enhetsmodellen tills båda parter
        godkänt om det ingår, från vilket datum klassificeringen gäller och hur kostnaden annars ska
        fördelas. En klassificering gäller aldrig bakåt i tiden.
      </p>
    </>
  );
}
