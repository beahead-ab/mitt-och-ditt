/**
 * Skapar det tomma hushållet för Caesar och Felicia och den första partens inbjudan. Om
 * SEED_FELICIA_EMAIL anges kan även Felicias länk skapas direkt; annars
 * bjuder Caesar in henne från sidan Överenskommelse > Parter. Bostadens och
 * avtalets uppgifter fyller parterna själva i efter att båda har anslutit.
 *
 * Kör med:  npm run db:seed
 *
 * Skriptet är idempotent: körs det igen skapas inget dubbelt, men nya
 * inbjudningslänkar skrivs ut för den som ännu inte har konto.
 */
import { migrate } from "../src/lib/db/migrate.server";
import { owner } from "../src/lib/db/client.server";
import { INVITE_DAYS, expiresIn, hashToken, newToken } from "../src/lib/auth/tokens";

const feliciaEmail = process.env.SEED_FELICIA_EMAIL?.trim();
const PARTIES_TO_INVITE = [
  {
    partyId: "caesar",
    name: "Caesar",
    email: process.env.SEED_CAESAR_EMAIL ?? "caesar@example.se",
  },
  ...(feliciaEmail
    ? [
        {
          partyId: "felicia",
          name: "Felicia",
          email: feliciaEmail,
        },
      ]
    : []),
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
          insert into households (name, party_a, party_b)
          values ('Caesar & Felicia', 'caesar', 'felicia') returning id`
      )[0].id;

    // Administratören hanterar bara åtkomst. Bostads- och avtalsuppgifter
    // fyller parterna själva i och godkänner var för sig.
    const [admin] = await tx<{ id: string }[]>`
      insert into users (email, name, is_admin)
      values (${process.env.SEED_ADMIN_EMAIL ?? "admin@example.se"}, 'Administratör', true)
      on conflict (email) do update set is_admin = true
      returning id
    `;

    const agreementRows = await tx<{ id: string }[]>`
      select id from agreements where household_id = ${householdId}`;
    if (agreementRows.length === 0) {
      // Själva behållaren har inga ekonomiska uppgifter. Första versionen
      // skapas av Caesar eller Felicia i tjänstens gemensamma uppstartsflöde.
      await tx`insert into agreements (household_id) values (${householdId})`;
    }

    const created: { name: string; email: string; url: string }[] = [];
    for (const party of PARTIES_TO_INVITE) {
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
    console.log("Hushållet finns redan och alla valda parter har konto eller en öppen inbjudan.");
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
