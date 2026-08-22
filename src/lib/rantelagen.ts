import { addDays, compareDates, daysBetween } from "@/lib/engine/dates";
import { roundHalfAwayFromZero, type Ore } from "@/lib/engine/money";
import type { IsoDate } from "@/lib/engine";

/**
 * Dröjsmålsränta på en regressfordran (avtal 12.3).
 *
 * Ligger medvetet utanför beräkningsmotorn. Räntan påverkar inte
 * andelsenheterna och ska inte kunna göra det: den är en skuld mellan
 * personerna, inte en insats i bostaden. Att blanda in den i `calculate()`
 * hade gjort en försenad betalning till en andelsförskjutning, vilket avtalet
 * inte säger.
 *
 * Avtalets 12.3: fordran förfaller trettio dagar efter skriftligt krav, och
 * därefter löper ränta enligt 6 § räntelagen - referensräntan med ett tillägg
 * av åtta procentenheter.
 */

/** Tillägget i 6 § räntelagen, i procentenheter. */
export const RANTELAGEN_TILLAGG = 8;

/** Fordran förfaller trettio dagar efter det skriftliga kravet (avtal 12.3). */
export const FORFALLODAGAR = 30;

/**
 * Dagräkning.
 *
 * Räntelagen anger en årlig räntefot men säger ingenting om hur ett år delas.
 * Här används faktiska dagar delat med 365, vilket är det vanliga i svenska
 * konsumentförhållanden. Valet är alltså en konvention och inte något som
 * följer av lagtexten - det är en av de punkter som hör hemma i den juridiska
 * granskningen. Konstanten står här så att den går att ändra på ett ställe om
 * granskningen säger 360.
 */
export const DAGAR_PER_AR = 365;

/** Riksbankens referensränta gäller från en viss dag tills nästa avlöser den. */
export type Referensranta = {
  fromDate: IsoDate;
  /** Räntesats i procent, till exempel 2 för 2 %. */
  percent: number;
};

export type Rantedelperiod = {
  from: IsoDate;
  /** Till, exklusive. Räntan löper på dagar, inte på dagsslut. */
  to: IsoDate;
  dagar: number;
  /** Referensränta plus tillägget, i procent. */
  rantesats: number;
};

export type Rantebesked =
  | { ok: false; skal: string }
  | {
      ok: true;
      forfallodag: IsoDate;
      /** Antal dagar i dröjsmål. Noll innan förfallodagen. */
      dagar: number;
      ranta: Ore;
      perioder: Rantedelperiod[];
      /** Konventionen beskedet vilar på, så den syns i gränssnittet. */
      dagrakning: string;
    };

/** Vilken referensränta som gällde en viss dag. */
export function rantaFor(dag: IsoDate, rantor: Referensranta[]): Referensranta | null {
  const gallande = rantor
    .filter((r) => compareDates(r.fromDate, dag) <= 0)
    .sort((x, y) => compareDates(x.fromDate, y.fromDate));
  return gallande[gallande.length - 1] ?? null;
}

/**
 * Räknar dröjsmålsräntan.
 *
 * Referensräntan ändras normalt två gånger om året, så perioden delas vid
 * varje ändring och varje del räknas med sin egen sats. Att räkna hela
 * perioden med dagens sats hade gett fel belopp så fort en fordran är äldre
 * än ett halvår - vilket är precis när räntan börjar spela roll.
 */
export function drojsmalsranta(args: {
  belopp: Ore;
  /** Dagen det skriftliga kravet framställdes. */
  kravdag: IsoDate;
  /** Betalningsdag, eller den dag beskedet avser. */
  tillDag: IsoDate;
  referensrantor: Referensranta[];
}): Rantebesked {
  const { belopp, kravdag, tillDag, referensrantor } = args;

  if (belopp <= 0) return { ok: false, skal: "Fordran är inte större än noll." };
  if (compareDates(tillDag, kravdag) < 0) {
    return { ok: false, skal: "Dagen ligger före det skriftliga kravet." };
  }

  const forfallodag = addDays(kravdag, FORFALLODAGAR);
  const dagrakning = `Faktiska dagar delat med ${DAGAR_PER_AR}. Referensränta plus ${RANTELAGEN_TILLAGG} procentenheter enligt 6 § räntelagen.`;

  if (compareDates(tillDag, forfallodag) <= 0) {
    return { ok: true, forfallodag, dagar: 0, ranta: 0, perioder: [], dagrakning };
  }

  // Brytpunkterna: förfallodagen, varje ändring av referensräntan som infaller
  // under dröjsmålet, och slutdagen.
  const brytpunkter = [forfallodag, tillDag];
  for (const r of referensrantor) {
    if (compareDates(r.fromDate, forfallodag) > 0 && compareDates(r.fromDate, tillDag) < 0) {
      brytpunkter.push(r.fromDate);
    }
  }
  const ordnade = [...new Set(brytpunkter)].sort(compareDates);

  const perioder: Rantedelperiod[] = [];
  let exakt = 0;

  for (let i = 0; i < ordnade.length - 1; i += 1) {
    const from = ordnade[i];
    const to = ordnade[i + 1];
    const dagar = daysBetween(from, to);
    if (dagar <= 0) continue;

    const referens = rantaFor(from, referensrantor);
    if (!referens) {
      return {
        ok: false,
        skal: `Referensräntan för ${from} saknas. Fyll i den innan räntan räknas.`,
      };
    }

    const rantesats = referens.percent + RANTELAGEN_TILLAGG;
    perioder.push({ from, to, dagar, rantesats });
    exakt += (belopp * (rantesats / 100) * dagar) / DAGAR_PER_AR;
  }

  return {
    ok: true,
    forfallodag,
    dagar: daysBetween(forfallodag, tillDag),
    // Avrundas en gång, på summan. Avrundning per delperiod hade gjort
    // beloppet beroende av hur många gånger referensräntan råkat ändras.
    ranta: roundHalfAwayFromZero(exakt),
    perioder,
    dagrakning,
  };
}
