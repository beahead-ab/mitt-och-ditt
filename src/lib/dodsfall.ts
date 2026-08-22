import { addDays, addMonths, compareDates, daysBetween } from "@/lib/engine/dates";
import type { IsoDate } from "@/lib/engine";

/**
 * Fristerna vid dödsfall (avtal 22).
 *
 * Punkten är mest tidsgränser, och tidsgränser ska räknas - inte kommas ihåg
 * av någon som just förlorat sin partner. Två frister löper efter varandra och
 * var och en börjar först när sitt underlag finns:
 *
 * - Den efterlevande har trettio dagar från bouppteckningsförrättningen på sig
 *   att meddela att hen vill överta bostaden (22.2).
 * - Därefter fyra månader från det att värdet fastställts på sig att ordna
 *   finansieringen.
 *
 * Ren funktion, utan koppling till beräkningsmotorn: fristerna påverkar inte
 * andelarna. De säger bara vad som ska hända när.
 */

/** Trettio dagar från bouppteckningsförrättningen (avtal 22.2). */
export const MEDDELANDE_DAGAR = 30;

/** Fyra månader från fastställt värde. */
export const FINANSIERING_MANADER = 4;

/** Så många dagar kvar räknas som "snart", och visas som en påminnelse. */
export const SNART_DAGAR = 14;

export type Fristlage =
  /** Underlaget som fristen räknas från saknas än. Klockan har inte startat. */
  "vantar_pa_underlag" | "loper" | "snart" | "forfallen" | "uppfylld";

export type Frist = {
  nyckel: "meddelande" | "finansiering";
  rubrik: string;
  /** Vad fristen räknas från, i klartext. */
  raknasFran: string;
  /** Dagen fristen går ut. Null när underlaget saknas. */
  forfaller: IsoDate | null;
  /** Negativt när fristen passerat. Null när klockan inte startat. */
  dagarKvar: number | null;
  lage: Fristlage;
};

export type Dodsfallslage = {
  frister: Frist[];
  /** Den frist som är mest angelägen just nu, om någon är det. */
  narmast: Frist | null;
};

export function dodsfallsfrister(args: {
  /** Dagen bouppteckningsförrättningen hölls. */
  bouppteckningPa: IsoDate | null;
  /** Dagen den efterlevande meddelade att hen vill överta. */
  meddelatPa: IsoDate | null;
  /** Dagen värdet fastställdes. */
  vardeFastställtPa: IsoDate | null;
  /** Dagen finansieringen var ordnad. */
  finansieringOrdnadPa: IsoDate | null;
  idag: IsoDate;
}): Dodsfallslage {
  const { bouppteckningPa, meddelatPa, vardeFastställtPa, finansieringOrdnadPa, idag } = args;

  const meddelande = bygg({
    nyckel: "meddelande",
    rubrik: "Meddela att du vill överta bostaden",
    raknasFran: "trettio dagar från bouppteckningsförrättningen",
    fran: bouppteckningPa,
    forfaller: bouppteckningPa ? addDays(bouppteckningPa, MEDDELANDE_DAGAR) : null,
    uppfyllt: meddelatPa,
    idag,
  });

  const finansiering = bygg({
    nyckel: "finansiering",
    rubrik: "Ordna finansieringen",
    raknasFran: "fyra månader från fastställt värde",
    fran: vardeFastställtPa,
    forfaller: vardeFastställtPa ? addMonths(vardeFastställtPa, FINANSIERING_MANADER) : null,
    uppfyllt: finansieringOrdnadPa,
    idag,
  });

  const frister = [meddelande, finansiering];

  // Den mest angelägna: förfallen före snart, snart före löpande. En frist som
  // väntar på underlag är inte angelägen - den går inte att göra något åt.
  const ordning: Fristlage[] = ["forfallen", "snart", "loper"];
  const narmast =
    ordning
      .map((lage) => frister.find((f) => f.lage === lage))
      .find((f): f is Frist => Boolean(f)) ?? null;

  return { frister, narmast };
}

function bygg(args: {
  nyckel: Frist["nyckel"];
  rubrik: string;
  raknasFran: string;
  fran: IsoDate | null;
  forfaller: IsoDate | null;
  uppfyllt: IsoDate | null;
  idag: IsoDate;
}): Frist {
  const { nyckel, rubrik, raknasFran, forfaller, uppfyllt, idag } = args;
  const bas = { nyckel, rubrik, raknasFran, forfaller };

  // Uppfyllt går före allt annat. Att en frist passerat spelar ingen roll om
  // det som skulle göras redan är gjort.
  if (uppfyllt) return { ...bas, dagarKvar: null, lage: "uppfylld" };
  if (!forfaller) return { ...bas, dagarKvar: null, lage: "vantar_pa_underlag" };

  const dagarKvar = daysBetween(idag, forfaller);
  if (compareDates(idag, forfaller) > 0) return { ...bas, dagarKvar, lage: "forfallen" };
  if (dagarKvar <= SNART_DAGAR) return { ...bas, dagarKvar, lage: "snart" };
  return { ...bas, dagarKvar, lage: "loper" };
}
