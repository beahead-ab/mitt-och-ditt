import { Link } from "@tanstack/react-router";

/**
 * Visas på sektionssidorna innan hushållet har en gällande överenskommelse.
 *
 * Medvetet tunn. Uppstarten hör hemma på ett ställe - översikten, där hela
 * listan står - och att upprepa samma stora tomma kort på fem sidor gjorde
 * tjänsten till en rad tomma rum utan att säga vad som faktiskt saknades.
 */
export function NoAgreement({ loading }: { loading?: boolean }) {
  if (loading) {
    return (
      <div className="tile-surface p-10 text-center">
        <p className="text-sm text-muted-foreground">Hämtar underlaget …</p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-hairline bg-secondary/60 p-4 text-sm leading-relaxed">
      Ingen överenskommelse gäller än, så det finns ingenting att räkna på här.{" "}
      <Link to="/" className="text-primary underline underline-offset-4">
        Se vad som är kvar i uppstarten
      </Link>
      .
    </div>
  );
}
