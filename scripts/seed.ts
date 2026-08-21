/**
 * Skapar hushållet för Caesar och Felicia med startvärdena ur avtalets punkt 2,
 * grundklassificeringen ur punkt 7 och en inbjudan per part.
 *
 * Kör med:  npm run db:seed
 *
 * Skriptet är idempotent: körs det igen skapas inget dubbelt, men nya
 * inbjudningslänkar skrivs ut för den som ännu inte har konto.
 */
import { migrate } from "../src/lib/db/migrate.server";
import { owner } from "../src/lib/db/client.server";
import { INVITE_DAYS, expiresIn, hashToken, newToken } from "../src/lib/auth/tokens";
import { defaultCategoryRules, kr } from "../src/lib/engine";

const START_DATE = process.env.SEED_START_DATE ?? "2026-08-17";
const PARTIES = [
  {
    partyId: "caesar",
    name: "Caesar",
    email: process.env.SEED_CAESAR_EMAIL ?? "caesar@example.se",
    units: 1_200_000,
  },
  {
    partyId: "felicia",
    name: "Felicia",
    email: process.env.SEED_FELICIA_EMAIL ?? "felicia@example.se",
    units: 180_000,
  },
];

async function main() {
  const applied = await migrate();
  if (applied.length > 0) console.log(`Migreringar körda: ${applied.join(", ")}`);

  const sql = owner();

  const links = await sql.begin(async (tx) => {
    const existing = await tx<{ id: string }[]>`
      select id from households where name = 'Caesar & Felicia'`;
    const householdId =
      existing[0]?.id ??
      (
        await tx<{ id: string }[]>`
          insert into households (name) values ('Caesar & Felicia') returning id`
      )[0].id;

    await tx`
      insert into properties (household_id, address)
      select ${householdId}, ${process.env.SEED_ADDRESS ?? "Adress fylls i"}
      where not exists (select 1 from properties where household_id = ${householdId})
    `;

    // Systemadministratören behövs för att kunna skapa avtalsversionen.
    const [admin] = await tx<{ id: string }[]>`
      insert into users (email, name, is_admin)
      values (${process.env.SEED_ADMIN_EMAIL ?? "admin@example.se"}, 'Administratör', true)
      on conflict (email) do update set is_admin = true
      returning id
    `;

    const agreementRows = await tx<{ id: string }[]>`
      select id from agreements where household_id = ${householdId}`;
    const agreementId =
      agreementRows[0]?.id ??
      (
        await tx<{ id: string }[]>`
          insert into agreements (household_id) values (${householdId}) returning id`
      )[0].id;

    const versions = await tx<{ id: string }[]>`
      select id from agreement_versions where agreement_id = ${agreementId}`;
    if (versions.length === 0) {
      // Utkast: startvärdena ur avtalet, som paret får granska och godkänna.
      // Formella ägarandelar lämnas tomma och sätts aldrig automatiskt lika
      // med de interna andelarna.
      await tx`
        insert into agreement_versions (
          agreement_id, version, start_date, start_value_ore, initial_loan_ore,
          total_units, start_units, formal_ownership, created_by, reason
        ) values (
          ${agreementId}, 1, ${START_DATE}, ${kr(4_495_000)}, ${kr(3_115_000)},
          ${1_380_000}, ${sql.json(Object.fromEntries(PARTIES.map((p) => [p.partyId, p.units])))},
          ${sql.json({ caesar: null, felicia: null })}, ${admin.id},
          'Startvärden ur avtalets punkt 2'
        )
      `;
    }

    const rules = await tx<{ id: string }[]>`
      select id from cost_category_rules where household_id = ${householdId} limit 1`;
    if (rules.length === 0) {
      for (const rule of defaultCategoryRules(START_DATE)) {
        await tx`
          insert into cost_category_rules (
            household_id, category, effective_from, included, reduces_loan, created_by, reason
          ) values (
            ${householdId}, ${rule.category}, ${rule.effectiveFrom}, ${rule.included},
            ${rule.reducesLoan ?? false}, ${admin.id}, 'Grundklassificering ur avtalets punkt 7'
          )
        `;
      }
    }

    const created: { name: string; email: string; url: string }[] = [];
    for (const party of PARTIES) {
      const member = await tx<{ id: string }[]>`
        select m.id from household_members m join users u on u.id = m.user_id
        where m.household_id = ${householdId} and lower(u.email) = ${party.email.toLowerCase()}
      `;
      if (member.length > 0) continue;

      const open = await tx<{ id: string }[]>`
        select id from invites
        where household_id = ${householdId} and lower(email) = ${party.email.toLowerCase()}
          and accepted_at is null and revoked_at is null and expires_at > now()
      `;
      if (open.length > 0) continue;

      const token = newToken();
      await tx`
        insert into invites (email, token_hash, household_id, party_id, display_name, invited_by, expires_at)
        values (${party.email}, ${hashToken(token)}, ${householdId}, ${party.partyId},
                ${party.name}, ${admin.id}, ${expiresIn(INVITE_DAYS)})
      `;
      created.push({
        name: party.name,
        email: party.email,
        url: `${process.env.APP_URL ?? "http://localhost:3000"}/inbjudan/${token}`,
      });
    }
    return created;
  });

  if (links.length === 0) {
    console.log("Hushållet finns redan och båda parter har konto eller en öppen inbjudan.");
  } else {
    console.log("\nInbjudningslänkar – giltiga i sju dagar, visas bara denna gång:\n");
    for (const link of links) {
      console.log(`  ${link.name} <${link.email}>`);
      console.log(`  ${link.url}\n`);
    }
  }

  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
