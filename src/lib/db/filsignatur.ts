/**
 * Kontroll av filens verkliga innehåll.
 *
 * Webbläsarens uppgift om filtyp är bara en uppgift - den härleds oftast ur
 * filändelsen och går att sätta till vad som helst av den som skickar. Ett
 * underlag ska vara ett kvitto eller en faktura, och därför läses de första
 * byten i filen och jämförs med vad formatet faktiskt börjar med.
 *
 * Det gör inte en fil ofarlig i sig, men det stänger den enklaste vägen: att
 * kalla något helt annat för en bild och få det lagrat och utlämnat med
 * bildens innehållstyp.
 */

/** Sant om `bytes` börjar med `signatur` från och med `offset`. */
function börjarMed(bytes: Buffer, signatur: number[], offset = 0): boolean {
  if (bytes.length < offset + signatur.length) return false;
  return signatur.every((b, i) => bytes[offset + i] === b);
}

type Kontroll = (bytes: Buffer) => boolean;

const SIGNATURER: Record<string, Kontroll> = {
  // JPEG börjar alltid med FF D8 FF.
  "image/jpeg": (b) => börjarMed(b, [0xff, 0xd8, 0xff]),

  // PNG har en åtta byte lång inledning som även fångar trasig överföring.
  "image/png": (b) => börjarMed(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),

  // WebP är en RIFF-behållare: "RIFF" följt av storlek och sedan "WEBP".
  "image/webp": (b) =>
    börjarMed(b, [0x52, 0x49, 0x46, 0x46]) && börjarMed(b, [0x57, 0x45, 0x42, 0x50], 8),

  // HEIC ligger i en ISO-behållare: "ftyp" på position 4, följt av ett märke.
  // Telefoner använder flera olika märken, så alla vanliga godtas.
  "image/heic": (b) => {
    if (!börjarMed(b, [0x66, 0x74, 0x79, 0x70], 4)) return false;
    const märke = b.subarray(8, 12).toString("latin1");
    return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(märke);
  },

  // PDF börjar med "%PDF-".
  "application/pdf": (b) => börjarMed(b, [0x25, 0x50, 0x44, 0x46, 0x2d]),
};

export type Signaturbesked = { ok: true; contentType: string } | { ok: false; skäl: string };

/**
 * Kontrollerar att innehållet stämmer med den uppgivna typen.
 *
 * Godtas även en fil vars innehåll matchar ett *annat* tillåtet format än det
 * uppgivna - då rättas typen i stället för att filen avvisas. En telefon som
 * skickar en HEIC märkt som JPEG ska inte stoppa en användare som gjort rätt.
 */
export function kontrolleraSignatur(uppgivenTyp: string, bytes: Buffer): Signaturbesked {
  const kontroll = SIGNATURER[uppgivenTyp];
  if (!kontroll) {
    return { ok: false, skäl: "Filtypen stöds inte." };
  }
  if (kontroll(bytes)) {
    return { ok: true, contentType: uppgivenTyp };
  }

  for (const [typ, annan] of Object.entries(SIGNATURER)) {
    if (typ !== uppgivenTyp && annan(bytes)) {
      return { ok: true, contentType: typ };
    }
  }

  return {
    ok: false,
    skäl: "Filens innehåll stämmer inte med filtypen. Ladda upp bilden eller PDF:en på nytt.",
  };
}
