import { describe, expect, it } from "vitest";

import {
  FORFALLEN_PUNKT,
  PAMINNELSEPUNKTER,
  dagarTill,
  isoVecka,
  punktIdag,
  punkttext,
  stockholmsdatum,
  veckopunkter,
} from "@/lib/mail/bevakning";

/**
 * Påminnelsepunkter, tidszon och kalendervecka.
 *
 * Två saker är lätta att få fel och svåra att upptäcka i drift: att jobbet kör
 * i UTC medan fristerna är svenska datum, och att en påminnelse ska gå ut en
 * gång per punkt även om svepet kör många gånger om dygnet.
 */
describe("Dagen räknas i svensk tid, inte i UTC", () => {
  it("sen kväll i UTC är redan nästa dag i Stockholm på sommaren", () => {
    // 23:30 UTC den 14 juli är 01:30 den 15 juli i Stockholm (UTC+2).
    expect(stockholmsdatum(new Date("2026-07-14T23:30:00Z"))).toBe("2026-07-15");
  });

  it("och på vintern", () => {
    // 23:30 UTC den 14 januari är 00:30 den 15 januari i Stockholm (UTC+1).
    expect(stockholmsdatum(new Date("2026-01-14T23:30:00Z"))).toBe("2026-01-15");
  });

  it("tidig morgon i UTC är samma dag", () => {
    expect(stockholmsdatum(new Date("2026-07-15T00:30:00Z"))).toBe("2026-07-15");
  });

  it("klarar omställningen till sommartid", () => {
    // Sista mars 2026 ställs klockan om natten mot söndag den 29:e.
    expect(stockholmsdatum(new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-29");
    expect(stockholmsdatum(new Date("2026-03-29T23:30:00Z"))).toBe("2026-03-30");
  });
});

describe("Dagar mellan två datum", () => {
  it("räknar hela dygn", () => {
    expect(dagarTill("2026-07-01", "2026-07-15")).toBe(14);
    expect(dagarTill("2026-07-15", "2026-07-15")).toBe(0);
    expect(dagarTill("2026-07-16", "2026-07-15")).toBe(-1);
  });

  it("påverkas inte av sommartidsomställningen", () => {
    // Ett dygn "försvinner" när klockan ställs fram. Datumräkningen ska ändå
    // ge kalenderdagar, inte 23-timmarsdygn.
    expect(dagarTill("2026-03-28", "2026-03-30")).toBe(2);
    expect(dagarTill("2026-10-24", "2026-10-26")).toBe(2);
  });
});

describe("Vilken påminnelsepunkt som gäller", () => {
  it("träffar varje punkt exakt", () => {
    for (const punkt of PAMINNELSEPUNKTER) {
      const forfaller = "2026-08-01";
      const idag = new Date(Date.UTC(2026, 7, 1 - punkt)).toISOString().slice(0, 10);
      expect(punktIdag(forfaller, idag), `${punkt} dagar kvar`).toBe(punkt);
    }
  });

  it("ger ingenting mellan punkterna", () => {
    // Nio dagar kvar: nästa svep om två dagar träffar sjudagarspunkten.
    expect(punktIdag("2026-08-01", "2026-07-23")).toBeNull();
    expect(punktIdag("2026-08-01", "2026-07-29")).toBeNull();
  });

  it("ger ingenting på förfallodagen själv", () => {
    // Att påminna samma dag är för sent att agera på.
    expect(punktIdag("2026-08-01", "2026-08-01")).toBeNull();
  });

  it("ger ett besked dagen efter förfall", () => {
    expect(punktIdag("2026-08-01", "2026-08-02")).toBe(FORFALLEN_PUNKT);
  });

  it("ger ingenting när fristen passerats för länge sedan", () => {
    // Annars hade varje gammal frist skickat ett nytt besked varje dygn.
    expect(punktIdag("2026-08-01", "2026-08-10")).toBeNull();
  });

  it("beskriver punkten begripligt", () => {
    expect(punkttext(14)).toMatch(/14 dagar/);
    expect(punkttext(1)).toMatch(/imorgon/);
    expect(punkttext(FORFALLEN_PUNKT)).toMatch(/igår/);
  });
});

describe("Kalenderveckan", () => {
  it("ger ISO-vecka", () => {
    expect(isoVecka("2026-08-23")).toBe("2026-W34");
    expect(isoVecka("2026-01-05")).toBe("2026-W02");
  });

  it("lägger nyårsdagar i rätt år", () => {
    // Den 1 januari 2027 är en fredag och tillhör vecka 53 av 2026. En nyckel
    // byggd på "år + veckonummer" utan den regeln hade krockat med 2027-W53.
    expect(isoVecka("2027-01-01")).toBe("2026-W53");
    expect(isoVecka("2026-01-01")).toBe("2026-W01");
  });

  it("hela veckan ger samma nyckel", () => {
    const veckan = ["2026-08-17", "2026-08-19", "2026-08-23"].map(isoVecka);
    expect(new Set(veckan).size).toBe(1);
  });

  it("men nästa vecka ger en annan", () => {
    expect(isoVecka("2026-08-23")).not.toBe(isoVecka("2026-08-24"));
  });
});

describe("Vad som är värt att nämna i veckosammanfattningen", () => {
  const tomt = {
    vantandeBeslut: 0,
    forsenadAvstamning: false,
    dokumentVantar: 0,
    kommandeFrister: [],
  };

  it("säger ingenting när det inte finns något", () => {
    // Ett veckomail som säger att allt är lugnt lär mottagaren att inte öppna
    // nästa - och då missas det som betyder något.
    expect(veckopunkter(tomt)).toEqual([]);
  });

  it("nämner väntande beslut", () => {
    expect(veckopunkter({ ...tomt, vantandeBeslut: 1 })[0].text).toMatch(/En post väntar/);
    expect(veckopunkter({ ...tomt, vantandeBeslut: 3 })[0].text).toMatch(/3 poster/);
  });

  it("nämner försenad avstämning och väntande dokument", () => {
    const punkter = veckopunkter({
      ...tomt,
      forsenadAvstamning: true,
      dokumentVantar: 2,
    });
    expect(punkter.map((p) => p.text).join(" ")).toMatch(/2 dokument/);
    expect(punkter.map((p) => p.text).join(" ")).toMatch(/försenad/);
  });

  it("nämner kommande frister", () => {
    const punkter = veckopunkter({
      ...tomt,
      kommandeFrister: [{ namn: "Meddela övertagande", forfaller: "2026-10-01" }],
    });
    expect(punkter[0].text).toContain("Meddela övertagande");
    expect(punkter[0].url).toBe("/forsaljning");
  });

  it("innehåller aldrig ett belopp", () => {
    // Integritetssidan lovar att mailen inte bär uppgifter om ekonomin.
    const punkter = veckopunkter({
      vantandeBeslut: 4,
      forsenadAvstamning: true,
      dokumentVantar: 1,
      kommandeFrister: [{ namn: "Tremånadersfristen", forfaller: "2026-11-01" }],
    });
    for (const p of punkter) {
      expect(p.text).not.toMatch(/kr\b|kronor|%/);
    }
  });
});
