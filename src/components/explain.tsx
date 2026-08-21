import { HelpCircle } from "lucide-react";
import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * "Vad betyder detta?" – varje modellbegrepp ska kunna öppnas och förklaras
 * med ett konkret exempel, på enkel svenska.
 */
export function Explain({
  term,
  summary,
  example,
  reference,
  children,
}: {
  term: string;
  summary: string;
  example?: ReactNode;
  reference?: string;
  children?: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger
        className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
        aria-label={`Vad betyder ${term}?`}
      >
        <HelpCircle className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">{term}</DialogTitle>
          <DialogDescription className="text-left text-sm leading-relaxed text-foreground">
            {summary}
          </DialogDescription>
        </DialogHeader>
        {example && (
          <div className="rounded-md border border-hairline bg-secondary/60 p-3 text-sm leading-relaxed">
            <p className="eyebrow mb-1.5">Exempel</p>
            {example}
          </div>
        )}
        {children}
        {reference && <p className="text-xs text-muted-foreground">{reference}</p>}
      </DialogContent>
    </Dialog>
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
    example: "Värde 4 900 000 kr minus lån 3 000 000 kr ger 1 900 000 kr i nettokapital.",
    reference: "Avtalet, punkt 9.1",
  },
  enhetsvarde: {
    term: "Värde per andelsenhet",
    summary:
      "Nettokapitalet delat med antalet enheter. Det visar vad en enhet är värd just den dagen, och avgör hur många enheter en överbetalning ger.",
    example:
      "1 380 000 kr i nettokapital delat på 1 380 000 enheter är 1,00 kr per enhet. Överbetalar du 8 000 kr får du 8 000 enheter.",
    reference: "Avtalet, punkt 9.3",
  },
  linjartVarde: {
    term: "Beräknat värde",
    summary:
      "Värdet mellan köp och försäljning räknas som en rak linje mellan startvärdet och slutvärdet. Det är en överenskommen räknemetod, inte en värdering av bostaden.",
    example:
      "Köp för 4 500 000 kr och försäljning fem år senare för 5 500 000 kr ger cirka 4 900 000 kr efter två år.",
    reference: "Avtalet, punkt 8.2 och 8.4",
  },
  overbetalning: {
    term: "Överbetalning",
    summary:
      "Det belopp du betalat utöver din del av en kostnad, efter avdrag för rabatt, återbetalning, försäkringsersättning och skatteeffekt som du fått.",
    example:
      "Kostnaden är 10 000 kr och din del är 20 %, alltså 2 000 kr. Betalar du allt har du överbetalat 8 000 kr.",
    reference: "Avtalet, punkt 7.5–7.6",
  },
  personligFordran: {
    term: "Personlig fordran",
    summary:
      "En överbetalning som inte kunde omvandlas till enheter – till exempel när nettokapitalet var noll eller den andra parten inte hade enheter kvar. Den regleras i kronor, utan värdeuppräkning.",
    example:
      "Kan bara 180 000 kr av en överbetalning på 1 000 000 kr omvandlas blir resterande 820 000 kr en fordran.",
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
    example:
      "Antar ni ett högre slutvärde blir varje enhet dyrare, och samma överbetalning ger färre enheter.",
    reference: "Avtalet, punkt 6.4 och 25.3",
  },
} as const;
