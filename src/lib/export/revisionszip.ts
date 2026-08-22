import { zipSync, strToU8 } from "fflate";

import type { Paketfil } from "@/lib/revisionspaket.functions";

/**
 * Packar revisionsunderlaget till en zip i webbläsaren.
 *
 * Filerna kommer färdiga från servern, med sina checksummor redan uträknade
 * över exakt det innehåll som packas här. Räknades de om på vägen skulle
 * innehållsförteckningen kunna stämma med något annat än det man faktiskt
 * laddade ner.
 */
export function byggRevisionszip(filer: Paketfil[]): Blob {
  const innehall: Record<string, Uint8Array> = {};
  for (const fil of filer) {
    innehall[fil.namn] = strToU8(fil.innehall);
  }
  // Nivå 6 är en rimlig avvägning: CSV komprimerar bra, och paketet ska gå att
  // öppna i vilket standardverktyg som helst.
  const packad = zipSync(innehall, { level: 6 });
  return new Blob([packad as unknown as BlobPart], { type: "application/zip" });
}

export function revisionszipNamn(skapad: string): string {
  const stamp = skapad.slice(0, 19).replace(/[:T]/g, "-");
  return `mitt-och-ditt-revisionsunderlag-${stamp}.zip`;
}
