/**
 * När en påminnelse ska gå ut, och vilken kalendervecka ett besked hör till.
 *
 * Ren logik med egna prov, eftersom två saker här är lätta att få fel och
 * svåra att upptäcka i drift.
 *
 * Det första är tidszonen. Jobbet kör i UTC, men fristerna är svenska datum.
 * Körs svepet 23:30 UTC en kväll i juli är klockan 01:30 nästa dag i
 * Stockholm - och "idag" är alltså ett annat datum än UTC säger. Räknas dagar
 * kvar mot fel dag hoppar en påminnelse över sin punkt eller kommer ett dygn
 * fel.
 *
 * Det andra är dubbletterna. En påminnelse ska gå ut en gång per punkt, inte
 * varje gång svepet råkar köra. Nyckeln måste därför bära vilken punkt det
 * gäller, inte när svepet kördes.
 */

/**
 * Påminnelsepunkter, i dagar kvar till förfallodagen.
 *
 * Fjorton dagar ger tid att ordna något som kräver en motpart - en mäklare,
 * en bank, en bouppteckning. Sju dagar fångar den som lade undan det första
 * mailet. En dag är sista chansen att hinna.
 *
 * Noll finns inte med. Att påminna på förfallodagen själv är för sent att
 * agera på och känns som en tillrättavisning; i stället kommer ett besked
 * dagen efter, när fristen faktiskt passerats och läget ändrats.
 */
export const PAMINNELSEPUNKTER = [14, 7, 1] as const;

/** Dagar efter förfallodagen då det går ut ett besked om att fristen passerats. */
export const FORFALLEN_PUNKT = -1;

export type Paminnelsepunkt = (typeof PAMINNELSEPUNKTER)[number] | typeof FORFALLEN_PUNKT;

/**
 * Dagens datum i svensk tid, som ÅÅÅÅ-MM-DD.
 *
 * Intl gör omställningen mellan sommar- och vintertid åt oss. Att räkna
 * timmar för hand hade brustit två gånger om året, och just då hade ingen
 * letat efter det.
 */
export function stockholmsdatum(nu: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(nu);
}

/** Hela dagar mellan två ÅÅÅÅ-MM-DD, positivt när `till` ligger senare. */
export function dagarTill(fran: string, till: string): number {
  const a = Date.UTC(
    Number(fran.slice(0, 4)),
    Number(fran.slice(5, 7)) - 1,
    Number(fran.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(till.slice(0, 4)),
    Number(till.slice(5, 7)) - 1,
    Number(till.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

/**
 * Vilken påminnelsepunkt som gäller idag, om någon.
 *
 * Exakt träff krävs. En frist som förfaller om nio dagar ger ingenting: nästa
 * svep om två dagar träffar sjudagarspunkten. Att i stället skicka "närmaste
 * punkt som passerats" hade gjort att en frist som lagts in sent skickade
 * fjorton-, sju- och endagsbeskedet på samma gång.
 */
export function punktIdag(forfaller: string, idag: string): Paminnelsepunkt | null {
  const kvar = dagarTill(idag, forfaller);
  if (kvar === FORFALLEN_PUNKT) return FORFALLEN_PUNKT;
  const traff = PAMINNELSEPUNKTER.find((p) => p === kvar);
  return traff ?? null;
}

/** Hur punkten beskrivs för en människa. */
export function punkttext(punkt: Paminnelsepunkt): string {
  if (punkt === FORFALLEN_PUNKT) return "gick ut igår";
  if (punkt === 1) return "går ut imorgon";
  return `går ut om ${punkt} dagar`;
}

/**
 * ISO-veckan ett datum tillhör, som "2026-W35".
 *
 * Veckosammanfattningen är idempotent per mottagare, hushåll och kalendervecka.
 * ISO-veckan används därför att den är entydig över årsskiften - den 1 januari
 * kan tillhöra vecka 53 föregående år, och en nyckel byggd på "år + veckonummer"
 * utan den regeln hade krockat.
 */
export function isoVecka(datum: string): string {
  const d = new Date(
    Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10))),
  );
  // Torsdagen i samma vecka avgör vilket år veckan hör till.
  const dag = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dag + 3);
  const torsdag = d.getTime();
  const forstaTorsdagen = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fdag = (forstaTorsdagen.getUTCDay() + 6) % 7;
  forstaTorsdagen.setUTCDate(forstaTorsdagen.getUTCDate() - fdag + 3);
  const vecka = 1 + Math.round((torsdag - forstaTorsdagen.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(vecka).padStart(2, "0")}`;
}

/** En punkt i veckosammanfattningen. Aldrig ett belopp - bara vad som väntar. */
export type Veckopunkt = { text: string; url: string };

/**
 * Vad som är värt att nämna den här veckan.
 *
 * Ren funktion, så att regeln "bara skicka när det finns något" går att pröva
 * utan databas. Ett veckomail som säger att allt är lugnt lär mottagaren att
 * inte öppna nästa - och då missas det som betyder något.
 */
export function veckopunkter(lage: {
  vantandeBeslut: number;
  forsenadAvstamning: boolean;
  dokumentVantar: number;
  kommandeFrister: { namn: string; forfaller: string }[];
}): Veckopunkt[] {
  const punkter: Veckopunkt[] = [];

  if (lage.vantandeBeslut > 0) {
    punkter.push({
      text:
        lage.vantandeBeslut === 1
          ? "En post väntar på ditt ställningstagande."
          : `${lage.vantandeBeslut} poster väntar på ditt ställningstagande.`,
      url: "/transaktioner/vantar",
    });
  }

  if (lage.dokumentVantar > 0) {
    punkter.push({
      text:
        lage.dokumentVantar === 1
          ? "Ett dokument väntar på godkännande."
          : `${lage.dokumentVantar} dokument väntar på godkännande.`,
      url: "/overenskommelse",
    });
  }

  if (lage.forsenadAvstamning) {
    punkter.push({
      text: "Kvartalsavstämningen är försenad.",
      url: "/transaktioner/avstamning",
    });
  }

  for (const frist of lage.kommandeFrister) {
    punkter.push({
      text: `${frist.namn}: senast ${frist.forfaller}.`,
      url: "/forsaljning",
    });
  }

  return punkter;
}
