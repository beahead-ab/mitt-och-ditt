/**
 * Prövar administratörsgränsen på de adresser som verkligen används.
 *
 * Serverfunktionernas adresser är /_serverFn/<genererat id>, inte
 * /_serverFn/<exportnamn>. Ett prov som gissar exportnamnet träffar ingen
 * funktion alls och får ett ramverksfel som ser ut som en vägran - det såg
 * först ut som att gränsen höll, fast ingenting hade prövats.
 *
 * Provet gör därför två saker:
 *
 *   1. Administratören öppnar sidorna på riktigt och ska se sina uppgifter.
 *      Utan det säger en vägran ingenting - en sida som är trasig för alla
 *      "håller" också.
 *
 *   2. De adresser administratörens sida anropar spelas upp med en vanlig
 *      parts kakor, och jämförs anrop för anrop. Uppspelningen är inte trogen
 *      originalet - ramverket kräver mer än metod och kropp - men det spelar
 *      ingen roll för frågan: samma anrop, två identiteter. Nekas parten med
 *      401/403 där administratören kommer förbi vakten, går gränsen på
 *      behörighet och inte på något annat.
 */
import { chromium } from "playwright-core";

const B = process.env.APP_URL ?? "http://127.0.0.1:4181";
const SIDOR = ["/system/anvandare", "/system/hushall", "/system/inbjudningar", "/system/mail"];

/** Vad administratören ska se på respektive sida. */
const FORVANTAT = {
  "/system/anvandare": /caesar@example\.se/,
  "/system/hushall": /Caesar & Felicia/,
  "/system/inbjudningar": /felicia@example\.se|Inga inbjudningar/i,
  "/system/mail": /bekrafta|inbjudan|Inga mail|tom/i,
};

const w = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

async function loggaIn(epost, losenord) {
  const s = await (await w.newContext()).newPage();
  await s.goto(`${B}/auth`);
  await s.getByLabel("E-post").fill(epost);
  await s.getByLabel("Lösenord").fill(losenord);
  await s.getByRole("button", { name: /Logga in/i }).click();
  await s.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 15_000 });
  return s;
}

let brister = 0;

// --- 1. Administratören ser sina sidor -------------------------------------
const admin = await loggaIn("admin@example.se", "ett-tredje-testlosenord");
const anrop = new Map();
admin.on("request", (r) => {
  const u = r.url();
  if (u.includes("/_serverFn/")) {
    anrop.set(u, { url: u, metod: r.method(), kropp: r.postData() ?? null });
  }
});

for (const väg of SIDOR) {
  await admin.goto(`${B}${väg}`);
  await admin.waitForTimeout(2500);
  const text = await admin.locator("body").innerText();
  const nekad = /Kräver administratörsbehörighet/.test(text);
  const ser = FORVANTAT[väg].test(text);
  if (nekad || !ser) brister += 1;
  console.log(
    `  admin ${väg}: ${nekad ? "NEKAS FEL" : ser ? "ser sina uppgifter" : "SER INGENTING"}`,
  );
}

const adresser = [...anrop.values()];
console.log(`\n  fångade ${adresser.length} riktiga serverfunktionsadresser`);

/** Spelar upp ett fångat anrop med den inloggades egna kakor. */
const spelaUpp = (sida, list) =>
  sida.evaluate(async (l) => {
    const ut = [];
    for (const a of l) {
      const r = await fetch(a.url, {
        method: a.metod,
        headers: a.kropp ? { "content-type": "application/json" } : undefined,
        body: a.kropp,
        credentials: "include",
      });
      ut.push({ url: a.url, status: r.status });
    }
    return ut;
  }, list);

// --- 2. Samma anrop, två identiteter ---------------------------------------
const part = await loggaIn("caesar@example.se", "ett-langt-testlosenord");
const somAdmin = await spelaUpp(admin, adresser);
const somPart = await spelaUpp(part, adresser);

let nekadePart = 0;
let genomsläppta = 0;
for (let i = 0; i < adresser.length; i += 1) {
  const kort = adresser[i].url.replace(`${B}/_serverFn/`, "").split("?")[0].slice(0, 12);
  const a = somAdmin[i].status;
  const p = somPart[i].status;
  const vaktenNekar = p === 401 || p === 403;
  if (vaktenNekar) nekadePart += 1;
  if (p < 400) genomsläppta += 1;
  console.log(`  ${kort}…  admin ${a}  ·  part ${p}${vaktenNekar ? "  ← vakten nekar" : ""}`);
}

brister += genomsläppta;
if (nekadePart === 0) {
  brister += 1;
  console.log("\n  Ingen vägran syntes - provet visar inte att vakten nås.");
}

console.log(
  brister === 0
    ? `\n  administratören ser sina sidor; vakten nekar parten på ${nekadePart} av ${adresser.length} anrop`
    : `\n  ${brister} brister`,
);
await w.close();
process.exitCode = brister === 0 ? 0 : 1;
