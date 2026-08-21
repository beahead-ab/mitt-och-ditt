/**
 * Sidor vars innehåll kräver databas och inloggning markeras tydligt i stället
 * för att visa påhittad funktionalitet som inte finns.
 */
export function ComingUp({ stage, children }: { stage: string; children: React.ReactNode }) {
  return (
    <div className="tile-surface p-6">
      <p className="eyebrow">Byggs i {stage}</p>
      <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}
