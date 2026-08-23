import { owner } from "@/lib/db/client.server";
import { dodsfallsfrister } from "@/lib/dodsfall";
import { exitDeadlines } from "@/lib/engine/exit";

import {
  isoVecka,
  punktIdag,
  punkttext,
  stockholmsdatum,
  veckopunkter,
  type Paminnelsepunkt,
} from "./bevakning";
import { enqueue } from "./queue.server";

/**
 * Regelbundna svep: frister som närmar sig, och veckans sammanfattning.
 *
 * Svepen kör genom ägarrollen. De har ingen inloggad användare att filtrera
 * på - de arbetar för alla hushåll - men de får bara läsa vad de behöver och
 * skriver bara till utkorgen.
 *
 * Dubbelutskick hindras på två nivåer. Idempotensnyckeln är det egentliga
 * skyddet: den bär händelsen och påminnelsepunkten, aldrig tidpunkten, och
 * databasens unika index avvisar en nyckel som redan finns. Det håller även
 * när två instanser kör samtidigt. Rådgivningslåset nedanför är bara till för
 * att slippa göra arbetet två gånger i onödan.
 */

/** Ett tal som identifierar just det här svepet för rådgivningslåset. */
const LAS_FRISTER = 811_001;
const LAS_VECKA = 811_002;

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Kör arbetet bara om ingen annan instans redan gör det.
 *
 * Låset släpps när sessionen tar slut. Får vi inte låset gör en annan instans
 * samma sak just nu, och då är rätt svar att inte göra något - inte att vänta.
 */
async function medLas<T>(nyckel: number, arbete: () => Promise<T>): Promise<T | null> {
  // Transaktionslås, inte sessionslås. Anslutningarna kommer ur en pool, så
  // `pg_advisory_lock` och `pg_advisory_unlock` kan hamna på olika
  // anslutningar - då misslyckas upplåsningen tyst och låset ligger kvar tills
  // anslutningen stängs. Nästa svep får då inte låset och gör ingenting alls.
  //
  // Ett xact-lås släpps när transaktionen tar slut, på samma anslutning som
  // tog det. Arbetet självt kör mot poolen utanför transaktionen; låset håller
  // ändå så länge transaktionen är öppen.
  const sql = owner();
  return sql.begin(async (tx) => {
    const [rad] = await tx<{ fick: boolean }[]>`
      select pg_try_advisory_xact_lock(${nyckel}) as fick`;
    if (!rad?.fick) return null;
    return arbete();
  }) as Promise<T | null>;
}

type Frist = { nyckel: string; namn: string; forfaller: string };

/**
 * Alla frister ett hushåll har just nu.
 *
 * Fristerna räknas fram ur källdagarna, aldrig ur en lagrad förfallodag: en
 * lagrad dag kan sluta stämma med det den räknats från.
 */
async function fristerForHushall(householdId: string): Promise<Frist[]> {
  const sql = owner();
  const frister: Frist[] = [];

  const [process] = await sql<
    {
      id: string;
      process_date: string;
      kind: string;
      status: string;
      takeover_notified_at: Date | null;
      estate_inventory_on: string | null;
      takeover_declared_on: string | null;
      value_established_on: string | null;
      financing_arranged_on: string | null;
    }[]
  >`
    select id, process_date::text, kind, status, takeover_notified_at,
           estate_inventory_on::text, takeover_declared_on::text,
           value_established_on::text, financing_arranged_on::text
      from exit_processes
     where household_id = ${householdId} and status = 'pagaende'
     order by process_date desc limit 1
  `;

  if (process) {
    const { takeoverNoticeBy, saleOrBuyoutBy } = exitDeadlines(process.process_date);

    // Beskedet om övertagande (avtal 17.1). Är det redan lämnat finns ingen
    // frist kvar att påminna om.
    if (!process.takeover_notified_at) {
      frister.push({
        nyckel: `${process.id}:overtagande`,
        namn: "Besked om övertagande",
        forfaller: takeoverNoticeBy,
      });
    }

    // Tremånadersfristen för genomförd försäljning eller utköp.
    frister.push({
      nyckel: `${process.id}:tremanader`,
      namn: "Försäljning eller utköp genomfört",
      forfaller: saleOrBuyoutBy,
    });

    if (process.kind === "dodsfall") {
      const lage = dodsfallsfrister({
        bouppteckningPa: process.estate_inventory_on,
        meddelatPa: process.takeover_declared_on,
        vardeFastställtPa: process.value_established_on,
        finansieringOrdnadPa: process.financing_arranged_on,
        idag: stockholmsdatum(),
      });
      for (const f of lage.frister) {
        // En frist som inte börjat löpa, eller som redan är uppfylld, har
        // ingen förfallodag att påminna om.
        if (!f.forfaller || f.lage === "uppfylld" || f.lage === "vantar_pa_underlag") continue;
        frister.push({
          nyckel: `${process.id}:${f.nyckel}`,
          namn: f.rubrik,
          forfaller: f.forfaller,
        });
      }
    }
  }

  // Kvartalsavstämningen. Den öppna periodens förfallodag är fristen.
  const [avstamning] = await sql<{ id: string; due_on: string }[]>`
    select id, due_on::text from reconciliations
     where household_id = ${householdId} and completed_at is null
     order by due_on limit 1`;
  if (avstamning) {
    frister.push({
      nyckel: `avstamning:${avstamning.id}`,
      namn: "Kvartalsavstämning",
      forfaller: avstamning.due_on,
    });
  }

  return frister;
}

/** Hushållets parter som kan ta emot post. Avstängda konton hoppas över. */
async function mottagare(householdId: string) {
  return owner()<{ user_id: string; email: string; name: string; party_id: string }[]>`
    select m.user_id, u.email, m.display_name as name, m.party_id
      from household_members m
      join users u on u.id = m.user_id
     where m.household_id = ${householdId} and u.disabled_at is null`;
}

async function hushallMedAktivitet(): Promise<{ id: string; name: string }[]> {
  return owner()<{ id: string; name: string }[]>`
    select id, name from households order by created_at`;
}

/**
 * Svep efter frister som nått en påminnelsepunkt.
 *
 * Returnerar antalet köade mail, så driften kan se att svepet gjort något.
 */
export async function svepFrister(nu: Date = new Date()): Promise<number> {
  const resultat = await medLas(LAS_FRISTER, async () => {
    const idag = stockholmsdatum(nu);
    let koade = 0;

    for (const hushall of await hushallMedAktivitet()) {
      const frister = await fristerForHushall(hushall.id);
      if (frister.length === 0) continue;

      const parter = await mottagare(hushall.id);
      if (parter.length === 0) continue;

      for (const frist of frister) {
        const punkt = punktIdag(frist.forfaller, idag);
        if (punkt === null) continue;

        for (const till of parter) {
          const id = await enqueue({
            // Nyckeln bär fristen och punkten, aldrig dagens datum. Samma
            // punkt kan därför bara skickas en gång, hur många gånger svepet
            // än kör - också från två instanser samtidigt.
            idempotencyKey: `frist:${frist.nyckel}:${frist.forfaller}:${punkt}:${till.user_id}`,
            template: "processdag",
            to: till.email,
            householdId: hushall.id,
            recipientUserId: till.user_id,
            params: {
              rubrik: `${frist.namn} ${punkttext(punkt as Paminnelsepunkt)}`,
              beskrivning: `${hushall.name}: ${frist.namn} har ${frist.forfaller} som sista dag.`,
              url: `${appUrl()}/forsaljning`,
            },
          });
          if (id) koade += 1;
        }
      }
    }

    return koade;
  });

  return resultat ?? 0;
}

/**
 * Veckans sammanfattning, per mottagare och hushåll.
 *
 * Skickas bara när det finns något att uppmärksamma. Ett veckomail som säger
 * att allt är lugnt lär mottagaren att inte öppna nästa - och då missas det
 * som betyder något.
 */
export async function svepVeckosammanfattning(nu: Date = new Date()): Promise<number> {
  const resultat = await medLas(LAS_VECKA, async () => {
    const sql = owner();
    const idag = stockholmsdatum(nu);
    const vecka = isoVecka(idag);
    let koade = 0;

    for (const hushall of await hushallMedAktivitet()) {
      const parter = await mottagare(hushall.id);
      if (parter.length === 0) continue;

      // Dokument som väntar på godkännande: avtalsversioner och tillägg som
      // ännu inte trätt i kraft.
      const [dokument] = await sql<{ antal: number }[]>`
        select (
          (select count(*) from agreement_versions v
             where v.agreement_id = current_agreement_id(${hushall.id})
               and v.effective_at is null)
          +
          (select count(*) from agreement_addenda t
             where t.household_id = ${hushall.id} and t.effective_at is null)
        )::int as antal`;

      const [forsenad] = await sql<{ forsenad: boolean }[]>`
        select exists (
          select 1 from reconciliations
           where household_id = ${hushall.id} and completed_at is null and due_on < ${idag}::date
        ) as forsenad`;

      const frister = await fristerForHushall(hushall.id);
      const kommande = frister.filter((f) => f.forfaller >= idag);

      for (const till of parter) {
        // Väntande beslut räknas per mottagare: en post som den andra
        // registrerat och som jag inte tagit ställning till.
        const [vantar] = await sql<{ antal: number }[]>`
          select count(*)::int as antal
            from transactions t
            join lateral (
              select * from transaction_versions v
               where v.transaction_id = t.id order by v.version desc limit 1
            ) v on true
           where t.household_id = ${hushall.id}
             and v.status = 'pending'
             and v.created_by <> ${till.user_id}
             and not exists (
               select 1 from transaction_approvals a
                where a.transaction_version_id = v.id and a.user_id = ${till.user_id}
             )`;

        const punkter = veckopunkter({
          vantandeBeslut: Number(vantar?.antal ?? 0),
          forsenadAvstamning: Boolean(forsenad?.forsenad),
          dokumentVantar: Number(dokument?.antal ?? 0),
          kommandeFrister: kommande.map((f) => ({ namn: f.namn, forfaller: f.forfaller })),
        });

        if (punkter.length === 0) continue;

        const id = await enqueue({
          // En sammanfattning per mottagare, hushåll och kalendervecka.
          idempotencyKey: `vecka:${hushall.id}:${vecka}:${till.user_id}`,
          template: "veckosammanfattning",
          to: till.email,
          householdId: hushall.id,
          recipientUserId: till.user_id,
          params: {
            punkter: punkter.map((p) => p.text),
            // Länken går till hushållets översikt. Den som har flera hushåll
            // väljer där; sammanfattningen namnger vilket den gäller.
            url: `${appUrl()}/`,
          },
        });
        if (id) koade += 1;
      }
    }

    return koade;
  });

  return resultat ?? 0;
}
