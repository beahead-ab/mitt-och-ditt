import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../password";
import { expiresIn, hashToken, isExpired, newToken, tokenMatches } from "../tokens";

describe("Lösenord", () => {
  it("hashas och kan verifieras", async () => {
    const stored = await hashPassword("ett tillräckligt långt lösenord");
    expect(await verifyPassword("ett tillräckligt långt lösenord", stored)).toBe(true);
    expect(await verifyPassword("fel lösenord helt enkelt", stored)).toBe(false);
  });

  it("ger olika hash varje gång tack vare saltet", async () => {
    const first = await hashPassword("samma lösenord som nyss");
    const second = await hashPassword("samma lösenord som nyss");
    expect(first).not.toBe(second);
    expect(await verifyPassword("samma lösenord som nyss", second)).toBe(true);
  });

  it("lagrar aldrig lösenordet i klartext", async () => {
    const stored = await hashPassword("hemligt lösenord här");
    expect(stored).not.toContain("hemligt");
    expect(stored.startsWith("scrypt$")).toBe(true);
  });

  it("kräver minst åtta tecken", async () => {
    await expect(hashPassword("Abc123!")).rejects.toThrow(/8/i);
    await expect(hashPassword("Abc123!!")).resolves.toMatch(/^scrypt\$/);
  });

  it("behandlar likvärdig unicode som samma lösenord", async () => {
    // Samma text, olika normalform: å som ett tecken respektive a + ring.
    const stored = await hashPassword("lösenord med åäö");
    expect(await verifyPassword("lösenord med åäö", stored)).toBe(true);
  });

  it("avvisar trasiga eller okända hashformat utan att kasta", async () => {
    expect(await verifyPassword("vad som helst här", "")).toBe(false);
    expect(await verifyPassword("vad som helst här", "bcrypt$2$abc")).toBe(false);
    expect(await verifyPassword("vad som helst här", "scrypt$a$b$c$d$e")).toBe(false);
  });
});

describe("Token", () => {
  it("är unika och tillräckligt långa", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newToken()));
    expect(tokens.size).toBe(200);
    expect(newToken().length).toBeGreaterThanOrEqual(43);
  });

  it("lagras bara som hash", () => {
    const token = newToken();
    const stored = hashToken(token);
    expect(stored).not.toContain(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matchar rätt token och bara den", () => {
    const token = newToken();
    const stored = hashToken(token);
    expect(tokenMatches(token, stored)).toBe(true);
    expect(tokenMatches(newToken(), stored)).toBe(false);
    expect(tokenMatches(token, "kort")).toBe(false);
  });
});

describe("Giltighetstid", () => {
  const now = new Date("2026-08-21T10:00:00Z");

  it("räknar fram utgångstiden", () => {
    expect(expiresIn(7, now).toISOString()).toBe("2026-08-28T10:00:00.000Z");
  });

  it("ser när tiden gått ut", () => {
    expect(isExpired("2026-08-20T10:00:00Z", now)).toBe(true);
    expect(isExpired("2026-08-22T10:00:00Z", now)).toBe(false);
    // Exakt på sekunden räknas som utgången.
    expect(isExpired("2026-08-21T10:00:00Z", now)).toBe(true);
  });
});
