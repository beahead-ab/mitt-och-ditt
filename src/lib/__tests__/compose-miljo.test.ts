import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Skripten i scripts/ körs inne i appcontainern och läser sina värden ur
 * miljön. Compose använder .env för substitution i compose.yaml, men skickar
 * inte in variablerna i containern av sig själva - de måste namnges under
 * tjänstens environment.
 *
 * Glappet syns inte förrän någon kör skriptet skarpt, och då tyst: seed föll
 * tillbaka på exempeladresser trots att .env innehöll riktiga. Testet knyter
 * därför ihop de två filerna, så att en variabel som läggs till i ett skript
 * utan att namnges i compose fälls här i stället för på servern.
 */

/** Variabler som med avsikt inte kommer från compose. */
const UNDANTAG = new Set<string>([
  // Sätts av Node självt respektive av testmiljön.
  "NODE_ENV",
  "CI",
]);

/** Namnen ett skript läser ur miljön. */
function readsEnv(source: string): string[] {
  return [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
}

/** En rad ur environment-blocket: namnet och hur det skrevs. */
type EnvRow = { name: string; form: "namn" | "namn=värde" | "mappning" };

/**
 * Raderna som app-tjänsten faktiskt ger containern.
 *
 * Läser blocket rad för rad i stället för att tolka hela YAML-filen, eftersom
 * projektet inte har någon yaml-läsare. Båda skrivsätten godtas - listform och
 * mappning - så att testet pekar ut vilken variabel som saknas i stället för
 * att bara krascha om någon skriver om blocket. Hittas inte blocket kastas ett
 * fel: ett test som tyst hittar noll variabler skulle godkänna allt.
 */
function composeEnvRows(yaml: string): EnvRow[] {
  const lines = yaml.split("\n");

  const service = lines.findIndex((line) => /^ {2}app:\s*$/.test(line));
  if (service === -1) throw new Error("Hittar ingen app-tjänst i compose.yaml.");

  let start = -1;
  for (let i = service + 1; i < lines.length; i += 1) {
    // Nästa tjänst börjar på två stegs indrag; då är app-blocket slut.
    if (/^ {2}\S/.test(lines[i])) break;
    if (/^ {4}environment:\s*$/.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) throw new Error("Hittar inget environment-block för app.");

  const rows: EnvRow[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    // Blocket slutar när indraget går tillbaka till tjänstens egna nycklar.
    if (!/^ {6}\S/.test(line)) break;

    const list = /^ {6}- ([A-Za-z_][A-Za-z0-9_]*)(=.*)?$/.exec(line);
    if (list) {
      rows.push({ name: list[1], form: list[2] ? "namn=värde" : "namn" });
      continue;
    }
    const mapping = /^ {6}([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (mapping) rows.push({ name: mapping[1], form: "mappning" });
  }
  if (rows.length === 0) throw new Error("Tomt environment-block för app.");
  return rows;
}

const root = process.cwd();
const compose = await readFile(path.join(root, "compose.yaml"), "utf8");
const composeRows = composeEnvRows(compose);
const givenByCompose = new Set(composeRows.map((row) => row.name));

const scriptFiles = (await readdir(path.join(root, "scripts"))).filter((f) => f.endsWith(".ts"));

describe("Skriptens miljövariabler når containern", () => {
  it("hittar app-tjänstens variabler i compose.yaml", () => {
    // Grundplåten: går parsningen fel blir resten av testet meningslöst.
    expect(givenByCompose.has("DATABASE_URL")).toBe(true);
    expect(givenByCompose.has("APP_URL")).toBe(true);
  });

  it.each(scriptFiles)("%s läser inga variabler som compose saknar", async (file) => {
    const source = await readFile(path.join(root, "scripts", file), "utf8");
    const missing = readsEnv(source)
      .filter((name) => !UNDANTAG.has(name))
      .filter((name) => !givenByCompose.has(name));

    expect(
      missing,
      `${file} läser ${missing.join(", ")} ur miljön, men compose.yaml ger inte ` +
        "variabeln till appcontainern. Lägg till namnet under app-tjänstens " +
        "environment, annars faller skriptet tillbaka på sin standard i drift.",
    ).toEqual([]);
  });

  it("skickar registreringens strömbrytare till containern, som enbart namn", () => {
    // Den här variabeln avgör om vem som helst kan skapa ett konto. Saknas den
    // i compose når den aldrig containern, och tjänsten står stängd hur mycket
    // .env än säger true - eller, värre, någon lägger till den med ett
    // standardvärde och öppnar den utan att mena det.
    //
    // Skrivs den som enbart namn blir den osatt i containern när .env saknar
    // den, och koden håller stängt. Med ${REGISTRATION_OPEN:-} hade den blivit
    // tom sträng, vilket också är stängt - men skillnaden är inte värd att
    // förlita sig på när den ena riktningen släpper in främlingar.
    const rad = composeRows.find((row) => row.name === "REGISTRATION_OPEN");

    expect(
      rad,
      "compose.yaml ger inte REGISTRATION_OPEN till appcontainern. Utan den " +
        "går registreringen inte att öppna i drift.",
    ).toBeDefined();
    expect(rad?.form).toBe("namn");
  });

  it("skickar seed-värdena som enbart namn, aldrig med standardvärde", () => {
    // Skillnaden är inte kosmetisk. Enbart namn lämnar variabeln osatt i
    // containern när den saknas i .env, och skriptets egen standard gäller.
    // Skrivs den som SEED_X: ${SEED_X:-} blir den tom sträng i stället, vilket
    // skripten uppfattar som ett satt värde - och en tom adress seedas.
    const seedRows = composeRows.filter((row) => row.name.startsWith("SEED_"));

    expect(seedRows.length).toBeGreaterThan(0);
    for (const row of seedRows) {
      expect(
        row.form,
        `${row.name} är skriven som ${row.form}. Skriv den som enbart namn, ` +
          "annars blir den tom sträng i containern när .env saknar den, och " +
          "skriptets standard slutar gälla.",
      ).toBe("namn");
    }
  });
});
