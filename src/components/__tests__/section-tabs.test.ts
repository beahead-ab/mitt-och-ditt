import { describe, expect, it } from "vitest";

import { SECTIONS, sectionFor, synligaFlikar } from "@/components/section-tabs";

/**
 * Flikraden under /system.
 *
 * Provet kom till av en provkörning: en vanlig part som öppnade sitt eget
 * revisionsunderlag fick en flikrad med länkar till användarregistret,
 * inbjudningarna och mailkön. Sidorna visade ingenting, men menyn skyltade
 * med en förvaltning paret inte har med att göra.
 */
const system = SECTIONS.find((s) => s.match === "/system")!;

describe("Administratörsgränsen i flikraden", () => {
  it("visar bara hushållets egen sida för en vanlig part", () => {
    expect(synligaFlikar(system, false).map((t) => t.to)).toEqual(["/system/revision"]);
  });

  it("visar hela förvaltningen för en administratör", () => {
    expect(synligaFlikar(system, true).map((t) => t.to)).toEqual([
      "/system/anvandare",
      "/system/hushall",
      "/system/inbjudningar",
      "/system/rantor",
      "/system/mail",
      "/system/revision",
    ]);
  });

  it("nämner varken användare, inbjudningar eller mailkö för en vanlig part", () => {
    const text = synligaFlikar(system, false)
      .map((t) => `${t.label} ${t.to}`)
      .join(" ");
    for (const ord of ["anvandare", "inbjudningar", "mail", "hushall", "rantor"]) {
      expect(text).not.toContain(ord);
    }
  });
});

describe("Sektionerna för hushållet gattar inte på behörighet", () => {
  // Ingen av parets egna sektioner får tappa flikar för att någon inte är
  // administratör - då hade rättningen ovan gjort tjänsten obrukbar.
  it.each(["/transaktioner", "/overenskommelse", "/forsaljning"])("%s ser likadan ut", (match) => {
    const sektion = SECTIONS.find((s) => s.match === match)!;
    expect(synligaFlikar(sektion, false)).toEqual(sektion.tabs);
    expect(synligaFlikar(sektion, true)).toEqual(sektion.tabs);
  });
});

describe("sectionFor", () => {
  it("hittar sektionen både på roten och på undersidor", () => {
    expect(sectionFor("/system/revision")?.match).toBe("/system");
    expect(sectionFor("/transaktioner")?.match).toBe("/transaktioner");
    expect(sectionFor("/")).toBeNull();
  });
});
