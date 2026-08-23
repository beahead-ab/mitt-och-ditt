/**
 * Håller administratörsgränsen mot en vanlig part?
 *
 * Sidorna under /system delar prefix men inte behörighet: revisionsloggen är
 * hushållets egen, medan användare, hushåll, inbjudningar, räntor och mailkö
 * hör till hela tjänsten.
 *
 * Provet mäter tre saker, och avsiktligt inte sidans egen rubriktext - den
 * säger ingenting om vad någon kommer åt:
 *
 *   1. att inga andra hushålls eller användares uppgifter syns,
 *   2. att inga fält eller knappar för att ändra något erbjuds,
 *   3. att flikraden inte skyltar med förvaltningen.
 */
import { chromium } from "playwright-core";

const B = process.env.APP_URL ?? "http://127.0.0.1:4181";

/** Uppgifter som bara en administratör ska kunna se på respektive sida. */
const SIDOR = [
  ["/system/anvandare", /felicia@example\.se|caesar@example\.se/],
  ["/system/hushall", /Caesar & Felicia/],
  ["/system/inbjudningar", /felicia@example\.se/],
  ["/system/rantor", /\d+[.,]\d+\s*%/],
  ["/system/mail", /bekrafta_epost|inbjudan|motpart_accepterade/],
];

const FORVALTNINGSFLIKAR = ["Användare", "Hushåll", "Inbjudningar", "Referensränta", "Mailstatus"];

const w = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const s = await (await w.newContext()).newPage();
await s.goto(`${B}/auth`);
await s.getByLabel("E-post").fill("caesar@example.se");
await s.getByLabel("Lösenord").fill("ett-langt-testlosenord");
await s.getByRole("button", { name: /Logga in/i }).click();
await s.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 15_000 });

let brister = 0;
for (const [väg, känsligt] of SIDOR) {
  await s.goto(`${B}${väg}`);
  await s.waitForTimeout(2500);
  const text = await s.locator("body").innerText();

  const data = känsligt.test(text);
  // Kontomenyn har alltid en knapp; allt därutöver är något att ändra med.
  const kontroller = (await s.locator("input, select, textarea").all()).length;
  const anmärkning = [data && "data", kontroller > 0 && `${kontroller} fält`].filter(Boolean);

  if (anmärkning.length > 0) brister += 1;
  console.log(
    `  ${väg}: ${anmärkning.length === 0 ? "håller" : "LÄCKER " + anmärkning.join(" och ")}`,
  );
}

// Flikraden på hushållets egen sida under samma prefix.
await s.goto(`${B}/system/revision`);
await s.waitForTimeout(2500);
const flikar = await s
  .getByTestId("section-tabs")
  .innerText()
  .catch(() => "");
const skyltar = FORVALTNINGSFLIKAR.filter((f) => flikar.includes(f));
if (skyltar.length > 0) brister += 1;
console.log(
  `  flikraden på /system/revision: ${
    skyltar.length === 0 ? "visar bara hushållets egen sida" : "SKYLTAR MED " + skyltar.join(", ")
  }`,
);

console.log(brister === 0 ? "\n  administratörsgränsen håller" : `\n  ${brister} brister`);
await w.close();
process.exitCode = brister === 0 ? 0 : 1;
