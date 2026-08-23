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

/**
 * Kontrollerar att värdena hänger ihop.
 *
 * Utan den här kunde ett tillägg sätta startenheter som inte summerar till
 * totalen - och då blir de interna andelarna till exempel 90 % och 60 %,
 * tillsammans 150 %. Motorns summakontroll hade fällt det efteråt, men då är
 * tillägget redan undertecknat och infört.
 */
export function valideraVarden(nya: Avtalsvarden): { ok: true } | { ok: false; skal: string } {
  const totalt = Number(nya.totalUnits);
  if (!Number.isFinite(totalt) || totalt <= 0) {
    return { ok: false, skal: "Totalt antal andelsenheter måste vara större än noll." };
  }

  const enheter = Object.values(nya.startUnits);
  if (enheter.some((v) => !Number.isFinite(v) || v < 0)) {
    return { ok: false, skal: "Startenheter kan inte vara negativa eller saknas." };
  }

  // Öre och enheter är heltal i modellen; en tiondels enhet är avrundningsbrus
  // och inte ett verkligt fel.
  const summa = enheter.reduce((a, b) => a + b, 0);
  if (Math.abs(summa - totalt) > 0.5) {
    return {
      ok: false,
      skal:
        `Startenheterna summerar till ${summa} men det totala antalet är ${totalt}. ` +
        "De måste vara lika, annars blir de interna andelarna tillsammans något annat än 100 %.",
    };
  }

  if (nya.formalOwnership) {
    const andelar = Object.values(nya.formalOwnership);
    if (andelar.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) {
      return { ok: false, skal: "Varje formell ägarandel måste ligga mellan 0 och 100 procent." };
    }
    if (andelar.length > 0 && Math.abs(andelar.reduce((a, b) => a + b, 0) - 1) > 0.000001) {
      return { ok: false, skal: "De formella ägarandelarna måste tillsammans bli 100 procent." };
    }
  }

  return { ok: true };
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

  // Värdena måste hänga ihop innan något annat prövas. Ett tillägg som gör
  // avtalet motsägelsefullt ska avvisas oavsett vad det säger sig ändra.
  const giltiga = valideraVarden(nya);
  if (!giltiga.ok) return { ok: false, skal: giltiga.skal };

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
