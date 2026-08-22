import type { ReactNode } from "react";

/**
 * Demoläget mitt i produktionsytan.
 *
 * Tre sidor svarade "kräver databas" - ett besked riktat till en utvecklare,
 * mitt i den yta någon utvärderar tjänsten i. Den som tittar möter då ett tomt
 * rum och lär sig ingenting om vad sidan gör.
 *
 * Här står i stället vad sidan är till för, märkt som exempel, med åtgärderna
 * avstängda. Innehållet är inte påhittade siffror: att visa tal som ser äkta
 * ut i ett läge utan databas vore att lova något tjänsten inte kan hålla.
 */
export function DemoNotice({
  vad,
  children,
}: {
  /** Vad sidan gör, i en mening. */
  vad: string;
  children?: ReactNode;
}) {
  return (
    <section className="tile-surface p-5 sm:p-6">
      <span className="inline-flex rounded-full border border-hairline px-2.5 py-0.5 text-xs text-muted-foreground">
        Exempel
      </span>
      <p className="mt-3 max-w-xl text-sm leading-relaxed">{vad}</p>
      {children && (
        <div className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
      <p className="mt-4 border-t border-hairline pt-3 text-xs text-muted-foreground">
        Demoläget räknar på exempeldata i webbläsaren. Det som skrivs till databasen – att
        registrera, godkänna och låsa – är avstängt här.
      </p>
    </section>
  );
}
