import { createHash } from "node:crypto";

import { asUser } from "@/lib/db/client.server";
import { granskaTillagg, nyaAvtalsvarden, type Avtalsfalt } from "@/lib/tillaggsavtal";

/**
 * Registrering av ett undertecknat tilläggsavtal.
 *
 * Ligger skilt från serverfunktionen och tar userId direkt, så att hela vägen
 * går att pröva mot en riktig databas - inte bara den rena sammanslagningen.
 * Det var här felet satt: avtalets startdag sattes till tilläggets
 * giltighetsdag, och eftersom motorn utesluter poster som betalats före
 * startdagen försvann historiken utan att något sa till.
 */
export type Tillaggsindata = {
  householdId: string;
  title: string;
  signedOn: string;
  appliesFrom: string;
  summary: string;
  affected: string[];
  attachmentId: string;
  startDate?: string;
  andrarFalt?: Avtalsfalt[];
  startValueOre?: string;
  initialLoanOre?: string;
  totalUnits?: string;
  startUnits?: Record<string, number>;
  formalOwnership?: Record<string, number>;
  reason?: string;
};

/**
 * Ett datum ur databasen som ÅÅÅÅ-MM-DD.
 *
 * postgres.js ger date-kolumner som Date-objekt. `String(d).slice(0, 10)` ger
 * då "Thu Jan 15", som Postgres i sin tur tolkar som år 2001 - ett fel som
 * inte kastar utan bara skriver fel datum. Konverteringen måste vara
 * uttrycklig.
 */
function somIsoDatum(varde: unknown): string {
  if (varde instanceof Date) return varde.toISOString().slice(0, 10);
  const text = String(varde);
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) {
    throw new Error(`Kunde inte tolka datumet ur databasen: ${text}`);
  }
  return text.slice(0, 10);
}

export async function registreraTillagg(
  userId: string,
  data: Tillaggsindata,
): Promise<{ addendumId: string; versionId: string; version: number }> {
  return asUser(userId, async (sql) => {
    const user = { id: userId };

    const [avtal] = await sql<{ id: string }[]>`
        select id from agreements where id = current_agreement_id(${data.householdId})`;
    if (!avtal) throw new Error("Hushållet har inget avtal.");

    // Bilagan måste tillhöra samma hushåll. Utan kontrollen hade en gissad
    // bilage-id kunnat knytas till ett tillägg i ett annat hushåll.
    //
    // Hashen läses ur den lagrade filen, aldrig från klienten. Annars hade den
    // som registrerar kunnat uppge en annan hash än handlingen faktiskt har,
    // och bekräftelsen bevisat fel sak.
    const [bilaga] = await sql<{ id: string; sha256: string }[]>`
        select id, sha256 from attachments
         where id = ${data.attachmentId} and household_id = ${data.householdId}`;
    if (!bilaga) throw new Error("Bilagan hör inte till hushållet.");

    const [senaste] = await sql<
      {
        version: number;
        start_date: string;
        start_value_ore: string;
        initial_loan_ore: string;
        total_units: string;
        start_units: Record<string, number>;
        formal_ownership: Record<string, number> | null;
      }[]
    >`
        select version, start_date, start_value_ore, initial_loan_ore, total_units,
               start_units, formal_ownership
          from agreement_versions
         where agreement_id = ${avtal.id} and effective_at is not null
         order by version desc limit 1
      `;
    if (!senaste) {
      throw new Error("Det finns ingen gällande avtalsversion att bygga vidare på.");
    }

    // Värdena hämtas ur den *gällande* versionen, men numret måste räknas från
    // den högsta som finns. Ett tillägg som väntar på bekräftelse har redan
    // tagit sitt nummer; räknades numret från den gällande fick nästa tillägg
    // samma, och det unika indexet slog till med ett rått databasfel i stället
    // för ett begripligt besked.
    const [hogsta] = await sql<{ version: number | null }[]>`
      select max(version) as version from agreement_versions
       where agreement_id = ${avtal.id}`;
    const nyttNummer = Number(hogsta?.version ?? senaste.version) + 1;

    const gallande = {
      startDate: somIsoDatum(senaste.start_date),
      startValueOre: String(senaste.start_value_ore),
      initialLoanOre: String(senaste.initial_loan_ore),
      totalUnits: String(senaste.total_units),
      startUnits: senaste.start_units,
      formalOwnership: senaste.formal_ownership,
    };

    const andringar = {
      startDate: data.startDate,
      startValueOre: data.startValueOre,
      initialLoanOre: data.initialLoanOre,
      totalUnits: data.totalUnits,
      startUnits: data.startUnits,
      formalOwnership: data.formalOwnership,
    };

    // Servern avgör vad tillägget faktiskt ändrar, och avvisar om det inte
    // stämmer med vad det säger sig ändra. Klienten kan alltså inte skriva en
    // sammanfattning som lovar en ändring som uteblir - eller smyga in en
    // ändring som ingen tagit ställning till.
    const granskning = granskaTillagg(gallande, andringar, data.andrarFalt);
    if (!granskning.ok) throw new Error(granskning.skal);
    if (granskning.andrade.length === 0 && data.andrarFalt !== undefined) {
      throw new Error("Tillägget ändrar ingen av avtalets beräkningsuppgifter.");
    }

    const nyaVarden = nyaAvtalsvarden(gallande, andringar);

    const [tillagg] = await sql<{ id: string }[]>`
        insert into agreement_addenda
          (agreement_id, household_id, title, signed_on, summary, applies_from,
           affected, changed_fields, document_sha256, attachment_id, created_by)
        values (${avtal.id}, ${data.householdId}, ${data.title}, ${data.signedOn},
                ${data.summary}, ${data.appliesFrom}, ${data.affected},
                ${granskning.andrade}, ${bilaga.sha256}, ${data.attachmentId}, ${user.id})
        returning id
      `;

    // Checksumman räknas över sorterade nycklar, så att två identiska avtal
    // alltid ger samma summa oavsett i vilken ordning fälten råkar ligga.
    const kanoniskt = JSON.stringify(nyaVarden, Object.keys(nyaVarden).sort());
    const checksum = createHash("sha256").update(kanoniskt).digest("hex");

    const [version] = await sql<{ id: string; version: number }[]>`
        insert into agreement_versions
          (agreement_id, version, start_date, start_value_ore, initial_loan_ore,
           total_units, start_units, formal_ownership, checksum, addendum_id,
           created_by, reason)
        values (${avtal.id}, ${nyttNummer}, ${nyaVarden.startDate},
                ${nyaVarden.startValueOre}, ${nyaVarden.initialLoanOre},
                ${nyaVarden.totalUnits}, ${sql.json(nyaVarden.startUnits)},
                ${sql.json(nyaVarden.formalOwnership)}, ${checksum}, ${tillagg.id},
                ${user.id}, ${data.reason ?? data.title})
        returning id, version
      `;

    await sql`
        insert into audit_events
          (household_id, event_type, entity_type, entity_id, actor_id, new_value)
        values (${data.householdId}, 'addendum.created', 'agreement', ${tillagg.id}, ${user.id},
                ${sql.json({
                  title: data.title,
                  appliesFrom: data.appliesFrom,
                  checksum,
                  // Före och efter för varje ändrat fält. En revisionshändelse
                  // som bara säger att något ändrats går inte att granska.
                  andrade: granskning.andrade,
                  fore: Object.fromEntries(granskning.andrade.map((f) => [f, gallande[f]])),
                  efter: Object.fromEntries(granskning.andrade.map((f) => [f, nyaVarden[f]])),
                } as never)})
      `;

    try {
      const { notifieraDokumentVantar } = await import("@/lib/mail/handelser.server");
      const [minRoll] = await sql<{ party_id: string }[]>`
        select party_id from household_members
         where household_id = ${data.householdId} and user_id = ${userId}`;
      if (minRoll) {
        await notifieraDokumentVantar({
          householdId: data.householdId,
          slag: "tillagg",
          entityId: tillagg.id,
          skapadAvPartyId: minRoll.party_id,
        });
      }
    } catch {
      // Utkorgen är inte en del av transaktionen; tillägget är redan skrivet.
    }

    return { addendumId: tillagg.id, versionId: version.id, version: version.version };
  });
}
