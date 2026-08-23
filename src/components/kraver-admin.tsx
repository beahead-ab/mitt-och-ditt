import { EmptyState, PageHeader } from "@/components/app-shell";

/**
 * Sidan kräver administratörsbehörighet.
 *
 * Serverfunktionerna nekar redan varje åtgärd, så det här är inte tjänstens
 * skydd - skyddet ligger i `admin()` i admin.functions.ts och mail.functions.ts.
 * Men utan den här vakten renderade sidorna sina formulär ändå: en vanlig part
 * som kom in under /system såg tomma listor och ifyllbara fält för att lägga
 * till användare och skicka inbjudningar. Ingenting hände när de skickades,
 * vilket är rätt men obegripligt.
 *
 * En sida som inte är ens egen ska säga det, inte se trasig ut.
 */
export function KraverAdmin({ titel }: { titel: string }) {
  return (
    <>
      <PageHeader eyebrow="Systemadmin" title={titel} />
      <EmptyState
        title="Kräver administratörsbehörighet"
        hint="Den här sidan hör till förvaltningen av tjänsten, inte till ditt hushåll. Dina egna uppgifter finns under Översikt, Transaktioner och Överenskommelse."
      />
    </>
  );
}
