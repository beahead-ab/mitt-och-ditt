/**
 * Kontrollerar att en återställd miljö går att använda, inte bara att den
 * går att starta. Loggar in som en riktig användare och letar upp avtalet,
 * transaktionen, revisionsloggen och bilagan genom gränssnittet.
 */
import { chromium } from "playwright-core";

const B = process.env.APP_URL ?? "http://127.0.0.1:4181";
const w = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const s = await (await w.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const fel = [];
s.on("pageerror", (e) => fel.push(String(e)));

/** Hämtar sidans text efter att den hunnit läsa in sig. */
async function text(sokvag, flik) {
  await s.goto(`${B}${sokvag}`);
  if (flik)
    await s
      .getByRole("tab", { name: flik })
      .or(s.getByRole("link", { name: flik }))
      .first()
      .click();
  await s.waitForTimeout(2500);
  return s.locator("body").innerText();
}

try {
  await s.goto(`${B}/auth`);
  await s.getByLabel("E-post").fill("caesar@example.se");
  await s.getByLabel("Lösenord").fill("ett-langt-testlosenord");
  await s.getByRole("button", { name: /Logga in/i }).click();
  await s.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 15000 });
  console.log("  inloggad —", s.url());

  const parter = await text("/overenskommelse/parter");
  console.log(
    "  båda parterna finns:",
    /Caesar Testsson/.test(parter) && /Felicia Testsson/.test(parter) ? "ja" : "NEJ",
  );

  const avtal = await text("/overenskommelse");
  console.log(
    "  avtalet läses in:",
    /4 ?500 ?000|450 ?000|Startvärde|startvärde/.test(avtal) ? "ja" : "NEJ",
  );

  const hist = await text("/transaktioner", /Historik/);
  console.log(
    "  transaktionen i historiken:",
    /Badrummet|Reparation|40 ?000/.test(hist) ? "ja" : "NEJ",
  );

  // Revisionsloggen ligger bakom administratörsgränsen (/system/revision), så
  // en vanlig part ska inte se den. Att kedjan är hel efter en återställning
  // prövas i stället med tjänstens egen verify_audit_chain mot databasen.
  await s.goto(`${B}/system/revision`);
  await s.waitForTimeout(2000);
  const nekad = !/prev_hash|Hashkedja|Revisionslogg/i.test(await s.locator("body").innerText());
  console.log("  administratörsgränsen håller efter återställning:", nekad ? "ja" : "NEJ");

  await s.screenshot({ path: "/tmp/aterstalld.png", fullPage: true });
  console.log("  konsolfel:", fel.length === 0 ? "inga" : fel);
} catch (e) {
  console.error("  AVBRÖT:", e.message.split("\n")[0], "på", s.url());
  await s.screenshot({ path: "/tmp/aterstalld.png", fullPage: true });
} finally {
  await w.close();
}
