/**
 * Sammanhängande provkörning mot den isolerade testmiljön.
 *
 * Körs mot ett riktigt produktionsbygge, en egen databas, en egen
 * bilagekatalog och en riktig SMTP-mottagare. Inga produktionsuppgifter och
 * inga riktiga adresser.
 */
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

import { chromium } from "playwright-core";

const BAS = "http://127.0.0.1:4180";
const MAILFIL = "/tmp/e2e-mail.jsonl";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const steg = [];
function ok(nr, text, extra = "") {
  steg.push({ nr, text, extra });
  console.log(`  ${nr}. ${text}${extra ? " — " + extra : ""}`);
}

/**
 * Tömmer utkorgen mot SMTP-mottagaren.
 *
 * Kör det **byggda** skriptet, inte källan via tsx. Det är skillnaden mellan
 * att pröva koden och att pröva det drift startar: bygget buntar nodemailer,
 * och en buntning som går sönder syns inte i källan. Just det felet fanns -
 * `.output/scripts/mail.mjs` kraschade på "Dynamic require of events" medan
 * `tsx scripts/mail.ts` fungerade.
 */
function skickaMail() {
  execFileSync("node", [".output/scripts/mail.mjs"], {
    stdio: "pipe",
    env: process.env,
  });
}

/** Avkodar en MIME-kodad ämnesrad, =?UTF-8?Q?...?= eller ?B?. */
function amne(ratt) {
  return ratt.replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, slag, kropp) => {
    if (slag.toUpperCase() === "B") return Buffer.from(kropp, "base64").toString("utf8");
    const bytes = kropp
      .replace(/_/g, " ")
      .replace(/=([0-9A-F]{2})/gi, (__, hex) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, "latin1").toString("utf8");
  });
}

async function mail() {
  const rader = (await readFile(MAILFIL, "utf8")).trim().split("\n").filter(Boolean);
  return rader.map((r) => {
    const m = JSON.parse(r);
    return { ...m, amne: amne(m.amne) };
  });
}

/** Plockar första länken till appen ur ett mail. */
function lank(m) {
  // Quoted-printable bryter långa rader med "=\r\n". Slå ihop dem först.
  const text = m.data.replace(/=\r?\n/g, "");
  const träff = text.match(/http:\/\/127\.0\.0\.1:4180[^\s"'<>)]+/);
  return träff ? träff[0].replace(/=$/, "") : null;
}

const webblasare = await chromium.launch({ executablePath: CHROME });
const ctx = await webblasare.newContext({ viewport: { width: 1280, height: 900 } });
const sida = await ctx.newPage();
const konsolfel = [];
sida.on("pageerror", (e) => konsolfel.push(String(e)));

try {
  // ---------------------------------------------------- 2-4. Registrering
  await sida.goto(`${BAS}/registrera`);
  await sida.getByLabel("Ditt namn").fill("Caesar Testsson");
  await sida.getByLabel("E-post").fill("caesar@example.se");
  await sida.getByLabel("Lösenord").fill("ett-langt-testlosenord");
  await sida.getByRole("button", { name: "Skapa konto" }).click();
  await sida
    .getByText(/Kolla din e-post/i)
    .first()
    .waitFor({ timeout: 10_000 });
  ok(2, "Registreringen är öppen och formuläret tog emot");
  ok(3, "Caesar registrerad som vanlig användare");

  skickaMail();
  await new Promise((r) => setTimeout(r, 1500));
  const efterReg = await mail();
  const bekraftelse = efterReg.find((m) => /Bekräfta/i.test(m.amne));
  if (!bekraftelse) throw new Error("Inget bekräftelsemail kom fram.");
  ok(4, "Bekräftelsemail mottaget", bekraftelse.amne);

  const bekraftelselank = lank(bekraftelse);
  if (!bekraftelselank) throw new Error("Hittade ingen länk i bekräftelsemailet.");
  await sida.goto(bekraftelselank);
  await sida.waitForURL((u) => !u.pathname.startsWith("/bekrafta"), { timeout: 15_000 });
  ok(4, "E-postadressen bekräftad och Caesar inloggad", sida.url());

  // ---------------------------------------------------------- 5. Hushåll
  await sida.getByLabel("Namn på hushållet").fill("Caesar & Felicia");
  await sida.getByRole("button", { name: "Skapa hushållet" }).click();
  await sida
    .getByText(/Uppstart/i)
    .first()
    .waitFor({ timeout: 15_000 });
  ok(5, "Hushållet skapat, uppstartslistan visas");

  // ------------------------------------------------------- 6-7. Inbjudan
  await sida.goto(`${BAS}/overenskommelse/parter`);
  await sida.getByLabel("E-post").fill("felicia@example.se");
  await sida.getByLabel("Namn").fill("Felicia Testsson");
  await sida.getByRole("button", { name: /Skapa inbjudningslänk/i }).click();
  await sida.waitForTimeout(2000);
  ok(6, "Felicia inbjuden");

  skickaMail();
  await new Promise((r) => setTimeout(r, 1500));
  const efterInbjudan = await mail();
  const inbjudan = efterInbjudan.find((m) => /inbjudan/i.test(m.amne));
  if (!inbjudan) throw new Error("Inget inbjudningsmail kom fram.");
  ok(7, "Inbjudningsmail mottaget", `${inbjudan.till.join(", ")} · ${inbjudan.amne}`);

  // ------------------------------------------------- 8-9. Felicia ansluter
  const inbjudningslank = lank(inbjudan);
  if (!inbjudningslank) throw new Error("Hittade ingen länk i inbjudningsmailet.");

  const feliciaCtx = await webblasare.newContext({ viewport: { width: 1280, height: 900 } });
  const felicia = await feliciaCtx.newPage();
  await felicia.goto(inbjudningslank);
  await felicia.getByLabel("Ditt namn").fill("Felicia Testsson");
  await felicia.getByLabel("Välj lösenord").fill("ett-annat-testlosenord");
  await felicia.getByLabel("Upprepa lösenordet").fill("ett-annat-testlosenord");
  await felicia.getByRole("button", { name: /Skapa kontot/i }).click();
  await felicia.waitForURL((u) => !u.pathname.startsWith("/inbjudan"), { timeout: 15_000 });
  ok(8, "Inbjudan accepterad, Felicia inloggad", felicia.url());

  skickaMail();
  await new Promise((r) => setTimeout(r, 1500));
  const efterAccept = await mail();
  const besked = efterAccept.find((m) => /anslutit|accepterade/i.test(m.amne));
  ok(
    9,
    besked ? "Caesar fick besked om att motparten anslutit" : "INGET besked till Caesar",
    besked ? besked.amne : "",
  );

  console.log("\nKonsolfel under körningen:", konsolfel.length === 0 ? "inga" : konsolfel);
  console.log("\nMail hittills:");
  for (const m of await mail()) console.log(`  - ${m.till.join(", ")}: ${m.amne}`);
} catch (fel) {
  console.error("\nAVBRÖT:", fel.message);
  await sida.screenshot({ path: "/tmp/e2e-fel.png", fullPage: true });
  console.error("skärmbild: /tmp/e2e-fel.png");
  console.error("url:", sida.url());
  process.exitCode = 1;
} finally {
  await webblasare.close();
}
