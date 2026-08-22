import { HelpCircle } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EXAMPLES, type ExampleKey } from "@/lib/examples";

/**
 * "Vad betyder detta?" – varje modellbegrepp ska kunna öppnas och förklaras
 * med ett konkret exempel, på enkel svenska.
 *
 * Med `label` blir avtryckaren en synlig textlänk i stället för en
 * frågetecken-ikon. Ikonen är 14 px, har mindre träffyta än ett finger behöver,
 * och säger inte att det finns ett framräknat exempel bakom. Räkneexemplen är
 * tjänstens starkaste pedagogik och ska inte vara gömda - så textlänk är
 * förstahandsvalet, och ikonen finns kvar där den står inne i en tät rad.
 */
export function Explain({
  term,
  summary,
  example,
  worked,
  reference,
  label,
  children,
}: {
  term: string;
  summary: string;
  example?: ReactNode;
  /** Räkneexempel ur avtalets bilaga 1, framräknat av beräkningsmotorn. */
  worked?: ExampleKey;
  reference?: string;
  /** Synlig text på avtryckaren. Utan den visas frågetecken-ikonen. */
  label?: string;
  children?: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger
        className={
          label
            ? "text-left text-sm text-primary underline underline-offset-4"
            : "inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
        }
        aria-label={label ? undefined : `Vad betyder ${term}?`}
      >
        {label ?? <HelpCircle className="size-3.5" />}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">{term}</DialogTitle>
          <DialogDescription className="text-left text-sm leading-relaxed text-foreground">
            {summary}
          </DialogDescription>
        </DialogHeader>
        {worked ? (
          <WorkedExampleBlock name={worked} />
        ) : (
          example && (
            <div className="rounded-md border border-hairline bg-secondary/60 p-3 text-sm leading-relaxed">
              <p className="eyebrow mb-1.5">Exempel</p>
              {example}
            </div>
          )
        )}
        {children}
        {reference && <p className="text-xs text-muted-foreground">{reference}</p>}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Räkneexemplet körs genom samma beräkningsmotor som parternas riktiga
 * avräkning. Ändras en regel ändras exemplet med den – de kan aldrig glida
 * isär.
 */
function WorkedExampleBlock({ name }: { name: ExampleKey }) {
  const example = useMemo(() => EXAMPLES[name](), [name]);
  return (
    <div className="rounded-md border border-hairline bg-secondary/60 p-3">
      <p className="eyebrow mb-1.5">Räkneexempel</p>
      <p className="text-sm leading-relaxed">{example.outcome}</p>
      <dl className="mt-2.5 grid gap-1 border-t border-hairline pt-2.5 text-sm">
        {example.steps.map((step) => (
          <div key={step.label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{step.label}</dt>
            <dd className="tabular text-right">{step.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2.5 text-xs text-muted-foreground">
        Framräknat av tjänstens beräkningsmotor med avtalets exempelsiffror.
      </p>
    </div>
  );
}

/** Förklaringstexterna samlade, så att de är identiska överallt i tjänsten. */
export const TERMS = {
  andelsenhet: {
    term: "Andelsenhet",
    summary:
      "En intern räkneenhet som visar hur mycket av bostadens värde var och en av er har betalat för. Enheten är inte en juridisk andel av bostadsrätten.",
    example:
      "Ni startade med 1 380 000 enheter: en enhet per krona ni la in kontant. Betalar någon mer än sin del senare flyttas enheter från den andra parten.",
    worked: "washingMachine" as const,
    reference: "Avtalet, punkt 6",
  },
  internAndel: {
    term: "Intern ekonomisk andel",
    summary:
      "Din andel av enheterna, uttryckt i procent. Den används bara när ni räknar av mot varandra – den ändrar inte vem som formellt äger bostadsrätten.",
    example: "1 200 000 enheter av totalt 1 380 000 är 86,9565 %.",
    reference: "Avtalet, punkt 6.1 och 5.2",
  },
  nettokapital: {
    term: "Nettokapital",
    summary: "Bostadens beräknade värde minus det lån som är kvar på bostaden den dagen.",
    worked: "linearValue" as const,
    reference: "Avtalet, punkt 9.1",
  },
  enhetsvarde: {
    term: "Värde per andelsenhet",
    summary:
      "Nettokapitalet delat med antalet enheter. Det visar vad en enhet är värd just den dagen, och avgör hur många enheter en överbetalning ger.",
    worked: "washingMachine" as const,
    reference: "Avtalet, punkt 9.3",
  },
  linjartVarde: {
    term: "Beräknat värde",
    summary:
      "Värdet mellan köp och försäljning räknas som en rak linje mellan startvärdet och slutvärdet. Det är en överenskommen räknemetod, inte en värdering av bostaden.",
    worked: "linearValue" as const,
    reference: "Avtalet, punkt 8.2 och 8.4",
  },
  overbetalning: {
    term: "Överbetalning",
    summary:
      "Det belopp du betalat utöver din del av en kostnad, efter avdrag för rabatt, återbetalning, försäkringsersättning och skatteeffekt som du fått.",
    worked: "interest" as const,
    reference: "Avtalet, punkt 7.5–7.6",
  },
  personligFordran: {
    term: "Personlig fordran",
    summary:
      "En överbetalning som inte kunde omvandlas till enheter – till exempel när nettokapitalet var noll eller den andra parten inte hade enheter kvar. Den regleras i kronor, utan värdeuppräkning.",
    worked: "personalClaim" as const,
    reference: "Avtalet, punkt 9.4, 10.4 och 14.5",
  },
  kostnadsnyckel: {
    term: "Kostnadsnyckel",
    summary:
      "Den fördelning som avgör hur mycket var och en ska bära av en kostnad. Normalt era interna andelar precis före betalningen, om ni inte avtalat något annat för just den posten.",
    example: "Är dina andelar 87/13 bär ni kostnaden i samma proportion.",
    reference: "Avtalet, punkt 7.4",
  },
  utanforModellen: {
    term: "Utanför enhetsmodellen",
    summary:
      "Månadsavgift, försäkring och liknande delas hälften vardera och ger inga enheter. Har någon betalat mer än sin del regleras det krona för krona.",
    example:
      "Betalar du hela månadsavgiften på 4 850 kr ska den andra parten betala tillbaka 2 425 kr.",
    reference: "Avtalet, punkt 7.2",
  },
  prognos: {
    term: "Prognos",
    summary:
      "Så länge bostaden inte är såld är slutvärdet ett antagande. Eftersom enhetsvärdet beror på antagandet ändras även tidigare enhetsöverföringar när ni byter antagande.",
    worked: "valueChange" as const,
    reference: "Avtalet, punkt 6.4 och 25.3",
  },
} as const;
