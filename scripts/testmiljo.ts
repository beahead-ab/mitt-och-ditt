/**
 * En isolerad testmiljö för en sammanhängande provkörning.
 *
 * Startar en riktig SMTP-mottagare och skriver de mail som kommer in till en
 * fil, så att en provkörning kan kontrollera vad som faktiskt skickades - inte
 * bara vad som lades i kön.
 *
 * Miljön är helt skild från drift: egen databas, egen bilagekatalog, och
 * adresser på example.se som inte går någonstans. Skriptet vägrar starta om
 * DATABASE_URL pekar på något som ser ut som produktion.
 *
 *   npx tsx scripts/testmiljo.ts --smtp-port 2525 --utfil /tmp/mail.jsonl
 */
import { appendFile, writeFile } from "node:fs/promises";

import { startSmtpSink } from "../src/lib/mail/__tests__/smtp-sink";

function flagga(namn: string, standard: string): string {
  const i = process.argv.indexOf(`--${namn}`);
  return i === -1 ? standard : (process.argv[i + 1] ?? standard);
}

const utfil = flagga("utfil", "/tmp/mittochditt-e2e-mail.jsonl");

// En spärr mot att råka köra mot drift. Testmiljöns databas ska heta något
// som säger vad den är.
const url = process.env.DATABASE_URL ?? "";
if (url && !/e2e|test|prov/.test(url)) {
  console.error(
    `DATABASE_URL pekar på "${url}" som inte ser ut som en testdatabas. ` +
      "Testmiljön vägrar starta mot något annat.",
  );
  process.exit(1);
}

await writeFile(utfil, "");

const sink = await startSmtpSink();
console.log(`SMTP-mottagare lyssnar på port ${sink.port}. Mail skrivs till ${utfil}.`);
console.log(JSON.stringify({ smtpPort: sink.port, utfil }));

// Skriv varje mail till filen så snart det kommit in.
let sett = 0;
const intervall = setInterval(async () => {
  while (sett < sink.mail.length) {
    const mail = sink.mail[sett];
    sett += 1;
    // Ämnesraden plockas ur den råa datan, så filen går att läsa utan att
    // tolka hela mailet.
    const amne = /^Subject:\s*(.*)$/m.exec(mail.data)?.[1] ?? "";
    await appendFile(utfil, JSON.stringify({ till: mail.to, amne, data: mail.data }) + "\n");
    console.log(`mail till ${mail.to.join(", ")}: ${amne}`);
  }
}, 200);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    clearInterval(intervall);
    await sink.stop();
    process.exit(0);
  });
}
