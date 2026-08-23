/**
 * Kör fristbevakningen mot en bestämd dag och visar vad som köades.
 *
 * Den löpande processen sveper när det svenska dygnet byts, vilket inte går
 * att invänta i en provkörning. Här matas dagen in i stället, så att varje
 * påminnelsepunkt kan prövas på riktigt - mot en riktig process i en riktig
 * databas, hela vägen till rader i utkorgen.
 *
 *   npx tsx prov/fristsvep-prov.ts 2026-09-01 2026-09-08 2026-09-14 2026-09-16
 */
import { svepFrister } from "../src/lib/mail/svep.server";
import { closeConnections, owner } from "../src/lib/db/client.server";

const dagar = process.argv.slice(2);
if (dagar.length === 0) {
  console.error("Ange en eller flera dagar, till exempel 2026-09-01.");
  process.exit(1);
}

const sql = owner();
await sql`delete from mail_messages`;

for (const dag of dagar) {
  // Klockan nio svensk tid: mitt på dygnet, så att provet inte råkar mäta
  // gränsfallet vid midnatt när det egentligen ville mäta punkten.
  await svepFrister(new Date(`${dag}T09:00:00Z`));

  const rader = await sql<{ template: string; idempotency_key: string }[]>`
    select template, idempotency_key from mail_messages order by idempotency_key`;

  console.log(`\n  ${dag}: ${rader.length} mail i utkorgen`);
  for (const r of rader) console.log(`    ${r.idempotency_key}`);

  // Kör samma dag en gång till. Inget får tillkomma.
  const fore = rader.length;
  await svepFrister(new Date(`${dag}T09:00:00Z`));
  const [{ n }] = await sql<{ n: string }[]>`select count(*)::text as n from mail_messages`;
  console.log(
    Number(n) === fore
      ? `    → svepet kört igen: fortfarande ${n}, inget dubblerat`
      : `    → DUBBLERAT: ${fore} blev ${n}`,
  );
}

await closeConnections();
