/**
 * Skickar det som ligger i utkorgen.
 *
 * Avsändaren är en egen process, inte en tråd inne i webbservern. Två skäl:
 * webbservern bundlas även för webbläsaren och får därför inte importera
 * serverkod, och på en liten maskin ska en bakgrundsloop inte konkurrera om
 * minnet med det som svarar användarna. En egen process går dessutom att
 * starta om och övervaka för sig.
 *
 * Ett svep och avsluta – för hand eller från cron:
 *   npm run mail:skicka
 *   docker compose exec app node .output/scripts/mail.mjs
 *
 * Löpande, som egen tjänst i compose:
 *   node .output/scripts/mail.mjs --loop
 */
import { closeConnections } from "../src/lib/db/client.server";
import { dispatchOnce } from "../src/lib/mail/dispatch.server";
import { purgeExpiredPayloads } from "../src/lib/mail/queue.server";
import { safeMessage, transportFromEnv } from "../src/lib/mail/transport";

const loop = process.argv.includes("--loop");
const antal = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 25);
const intervall = Number(process.env.MAIL_DISPATCH_INTERVAL_SECONDS ?? 30);

const transport = transportFromEnv();

async function svep(): Promise<void> {
  const resultat = await dispatchOnce(transport, antal);
  const stadade = await purgeExpiredPayloads();
  if (resultat.skickade > 0 || resultat.misslyckade > 0 || stadade > 0) {
    console.log(
      `${new Date().toISOString()} skickade ${resultat.skickade}, ` +
        `misslyckade ${resultat.misslyckade}` +
        (stadade > 0 ? `, städade ${stadade}` : "") +
        ` (transport: ${transport.name})`,
    );
  }
}

if (!loop) {
  await svep();
  await closeConnections();
} else {
  console.log(`Avsändaren kör var ${intervall}:e sekund (transport: ${transport.name}).`);

  let stanna = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`\n${signal} – avslutar efter pågående svep.`);
      stanna = true;
    });
  }

  while (!stanna) {
    try {
      await svep();
    } catch (error) {
      // Ett trasigt svep får inte fälla avsändaren; nästa varv försöker igen.
      console.error(`svepet misslyckades: ${safeMessage(error)}`);
    }
    // Vänta, men vakna direkt vid avslut.
    for (let i = 0; i < intervall && !stanna; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  await closeConnections();
}
