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
import { tolkaIntervall } from "../src/lib/mail/intervall";
import { safeMessage, transportFromEnv } from "../src/lib/mail/transport";

const loop = process.argv.includes("--loop");
const antal = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 25);
const lage = tolkaIntervall(process.env.MAIL_DISPATCH_INTERVAL_SECONDS);

if (lage.slag === "fel") {
  console.error(lage.skal);
  process.exit(1);
}

// Transportvalet kan vägra - console och memory är avstängda i drift. Ett
// begripligt besked är bättre än en stackdump för den som ska rätta miljöfilen.
let transport;
try {
  transport = transportFromEnv();
} catch (error) {
  // safeMessage döljer detaljer ur SMTP-fel, vilket är rätt för dem. Det här
  // felet är vårt eget och beskriver miljöfilen; att dölja det hade lämnat
  // den som ska rätta inställningen utan ledtråd.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

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
} else if (lage.slag === "avstangd") {
  // 0 betyder avstängd, precis som .env.example säger. Tidigare tolkades det
  // som noll sekunders väntan, vilket gav en loop utan paus mot databasen.
  console.log(
    "MAIL_DISPATCH_INTERVAL_SECONDS=0: den löpande avsändaren är avstängd. " +
      "Enstaka svep går fortfarande att köra utan --loop.",
  );
  await closeConnections();
} else {
  if (lage.varning) console.warn(lage.varning);
  console.log(`Avsändaren kör var ${lage.sekunder}:e sekund (transport: ${transport.name}).`);

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
    // Vänta, men vakna direkt vid avslut. Intervallet är garanterat minst en
    // sekund här, så snurran kan aldrig bli en loop utan paus.
    for (let i = 0; i < lage.sekunder && !stanna; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  await closeConnections();
}
