import { describe, expect, it } from "vitest";

import { kontrolleraSignatur } from "../filsignatur";

/**
 * Filens innehåll ska avgöra, inte vad webbläsaren påstår. Den uppgiften
 * härleds oftast ur filändelsen och går att sätta till vad som helst.
 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ", "latin1");
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "latin1"),
]);
const HEIC = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypheic", "latin1"),
]);

describe("Filsignaturer", () => {
  it.each([
    ["image/jpeg", JPEG],
    ["image/png", PNG],
    ["application/pdf", PDF],
    ["image/webp", WEBP],
    ["image/heic", HEIC],
  ])("godtar %s med rätt innehåll", (typ, bytes) => {
    expect(kontrolleraSignatur(typ, bytes)).toEqual({ ok: true, contentType: typ });
  });

  it("avvisar innehåll som inte är någon tillåten filtyp", () => {
    const skript = Buffer.from("#!/bin/sh\nrm -rf /\n", "latin1");
    const svar = kontrolleraSignatur("image/jpeg", skript);
    expect(svar.ok).toBe(false);
  });

  it("avvisar en HTML-sida som utger sig för att vara en PDF", () => {
    const html = Buffer.from("<!doctype html><script>alert(1)</script>", "latin1");
    expect(kontrolleraSignatur("application/pdf", html).ok).toBe(false);
  });

  it("rättar typen när innehållet är ett annat tillåtet format", () => {
    // En telefon som märker en HEIC som JPEG ska inte stoppa någon som gjort
    // rätt; typen rättas i stället för att uppladdningen avvisas.
    expect(kontrolleraSignatur("image/jpeg", HEIC)).toEqual({
      ok: true,
      contentType: "image/heic",
    });
  });

  it("avvisar en typ som inte stöds alls", () => {
    expect(kontrolleraSignatur("application/zip", PDF).ok).toBe(false);
  });

  it("avvisar en tom eller stympad fil", () => {
    expect(kontrolleraSignatur("image/png", Buffer.alloc(0)).ok).toBe(false);
    expect(kontrolleraSignatur("image/png", PNG.subarray(0, 3)).ok).toBe(false);
  });
});
