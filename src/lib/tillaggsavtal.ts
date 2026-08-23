/**
 * Vad ett tilläggsavtal gör med avtalets strukturerade värden.
 *
 * Ren logik, skild från serverfunktionen, eftersom det är här ett fel blir
 * dyrast: värdena går rakt in i beräkningsmotorn, och ett tillägg som ändrar
 * mer än det säger sig ändra skriver om historien utan att någon ser det.
 */

/** Fälten motorn läser, och som därför bara får ändras avsiktligt. */
export const AVTALSFALT = [
  "startDate",
  "startValueOre",
  "initialLoanOre",
  "totalUnits",
  "startUnits",
  "formalOwnership",
] as const;

export type Avtalsfalt = (typeof AVTALSFALT)[number];

/** Vad varje fält heter för en människa. */
export const FALTNAMN: Record<Avtalsfalt, string> = {
  startDate: "Startdag",
  startValueOre: "Startvärde",
  initialLoanOre: "Ursprungligt lån",
  totalUnits: "Totalt antal andelsenheter",
  startUnits: "Startenheter per part",
  formalOwnership: "Formella ägarandelar",
};

export type Avtalsvarden = {
  startDate: string;
  startValueOre: string;
  initialLoanOre: string;
  totalUnits: string;
  startUnits: Record<string, number>;
  formalOwnership: Record<string, number> | null;
};

export type Tillaggsandringar = Partial<Avtalsvarden>;

/**
 * Slår ihop gällande värden med tilläggets ändringar.
 *
 * Det som inte anges behåller sitt värde. Startdagen ingår i det: den är
 * bostadsköpets tillträdesdag och tidslinjens origo för hela den linjära
 * beräkningen, och den har ingenting med tilläggets giltighetsdag att göra.
 *
 * Att sätta startdagen till tilläggets giltighetsdag - vilket koden tidigare
 * gjorde - flyttar inte bara kurvan. Motorn utesluter poster vars
 * betalningsdag ligger före startdagen, så varje historisk transaktion föll ur
 * beräkningen i samma stund ett tillägg registrerades.
 */
export function nyaAvtalsvarden(
  gallande: Avtalsvarden,
  andringar: Tillaggsandringar,
): Avtalsvarden {
  return {
    startDate: andringar.startDate ?? gallande.startDate,
    startValueOre: andringar.startValueOre ?? gallande.startValueOre,
    initialLoanOre: andringar.initialLoanOre ?? gallande.initialLoanOre,
    totalUnits: andringar.totalUnits ?? gallande.totalUnits,
    startUnits: andringar.startUnits ?? gallande.startUnits,
    formalOwnership:
      andringar.formalOwnership === undefined
        ? gallande.formalOwnership
        : andringar.formalOwnership,
  };
}

/**
 * Vilka fält som faktiskt skiljer sig.
 *
 * Jämförelsen sker på värde, inte på om ett fält skickats med: ett tillägg som
 * "ändrar" startvärdet till samma belopp ändrar ingenting, och ska inte kunna
 * påstå något annat.
 */
export function andradeFalt(gallande: Avtalsvarden, nya: Avtalsvarden): Avtalsfalt[] {
  return AVTALSFALT.filter((falt) => !likaVarden(gallande[falt], nya[falt]));
}

function likaVarden(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === "object" && typeof b === "object") {
    // Nycklarna sorteras, så att samma innehåll i olika ordning räknas lika.
    const na = Object.keys(a as object).sort();
    const nb = Object.keys(b as object).sort();
    if (na.join(" ") !== nb.join(" ")) return false;
    return na.every((n) =>
      likaVarden((a as Record<string, unknown>)[n], (b as Record<string, unknown>)[n]),
    );
  }
  // Belopp kommer som strängar ur databasen och som tal ur formuläret.
  return String(a) === String(b);
}

export type Granskning = { ok: true; andrade: Avtalsfalt[] } | { ok: false; skal: string };

/**
 * Kontrollerar att tillägget ändrar precis det det säger sig ändra.
 *
 * Utan den här kontrollen kunde sammanfattningen påstå att ett belopp ändras
 * medan det strukturerade värdet låg kvar - och parterna godkänna en text som
 * inte motsvarade vad tjänsten sedan räknade på.
 */
export function granskaTillagg(
  gallande: Avtalsvarden,
  andringar: Tillaggsandringar,
  uppgivnaFalt: Avtalsfalt[] | undefined,
): Granskning {
  const nya = nyaAvtalsvarden(gallande, andringar);
  const andrade = andradeFalt(gallande, nya);

  if (uppgivnaFalt === undefined) return { ok: true, andrade };

  const uppgivna = [...new Set(uppgivnaFalt)].sort();
  const faktiska = [...andrade].sort();

  const saknas = uppgivna.filter((f) => !faktiska.includes(f));
  if (saknas.length > 0) {
    return {
      ok: false,
      skal: `Tillägget säger sig ändra ${saknas
        .map((f) => FALTNAMN[f].toLowerCase())
        .join(", ")}, men värdet är detsamma som i gällande avtal.`,
    };
  }

  const oanmalda = faktiska.filter((f) => !uppgivna.includes(f));
  if (oanmalda.length > 0) {
    return {
      ok: false,
      skal: `Tillägget ändrar ${oanmalda
        .map((f) => FALTNAMN[f].toLowerCase())
        .join(", ")} utan att säga det. Varje ändrad uppgift måste anges.`,
    };
  }

  return { ok: true, andrade };
}
