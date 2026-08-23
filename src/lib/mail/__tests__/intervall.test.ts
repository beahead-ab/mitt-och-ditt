import { afterEach, describe, expect, it } from "vitest";

import {
  MINSTA_SEKUNDER,
  STANDARD_SEKUNDER,
  VARNA_UNDER_SEKUNDER,
  tolkaIntervall,
} from "@/lib/mail/intervall";
import { ConsoleTransport, MemoryTransport, transportFromEnv } from "@/lib/mail/transport";

/**
 * Avsändarens intervall och transport.
 *
 * Provet som betyder mest är att inget värde - giltigt eller ogiltigt - kan ge
 * en loop utan paus. Tidigare räknade väntesnurran `i < intervall`, och "0",
 * tom sträng, negativa tal och bokstäver blev alla 0 eller NaN. Då kördes noll
 * varv väntan och avsändaren gick varm mot databasen, medan .env.example
 * samtidigt lovade att 0 stänger av den.
 */
describe("Noll betyder avstängd, inte noll sekunders väntan", () => {
  it("stänger av den löpande avsändaren", () => {
    expect(tolkaIntervall("0")).toEqual({ slag: "avstangd" });
  });

  it("blanksteg runt nollan ändrar ingenting", () => {
    expect(tolkaIntervall("  0  ")).toEqual({ slag: "avstangd" });
  });
});

describe("Inget värde kan ge en loop utan paus", () => {
  /**
   * Kärnan i rättningen: för varje tänkbar inmatning ska svaret vara antingen
   * avstängt, ett fel, eller ett intervall på minst en sekund. Aldrig noll.
   */
  const INMATNINGAR = [
    undefined,
    null,
    "",
    "   ",
    "0",
    "-1",
    "-30",
    "abc",
    "30s",
    "1.5",
    "1e3",
    "NaN",
    "Infinity",
    "1",
    "5",
    "30",
    "3600",
  ];

  it.each(INMATNINGAR)("ger aldrig noll sekunders väntan för %o", (varde) => {
    const lage = tolkaIntervall(varde as string | undefined | null);
    if (lage.slag === "loop") {
      expect(lage.sekunder).toBeGreaterThanOrEqual(MINSTA_SEKUNDER);
      expect(Number.isFinite(lage.sekunder)).toBe(true);
    } else {
      expect(["avstangd", "fel"]).toContain(lage.slag);
    }
  });
});

describe("Ogiltiga värden avvisas i stället för att gissas", () => {
  it("negativt tal är ett fel, med hänvisning till hur man stänger av", () => {
    const lage = tolkaIntervall("-30");
    expect(lage.slag).toBe("fel");
    if (lage.slag !== "fel") return;
    expect(lage.skal).toMatch(/negativt/);
    expect(lage.skal).toMatch(/0 för att stänga av/);
  });

  it("bokstäver är ett fel", () => {
    const lage = tolkaIntervall("abc");
    expect(lage.slag).toBe("fel");
    if (lage.slag !== "fel") return;
    expect(lage.skal).toMatch(/heltal/);
  });

  it("decimaltal är ett fel", () => {
    expect(tolkaIntervall("1.5").slag).toBe("fel");
  });

  it("NaN och Infinity som text är fel, inte tal", () => {
    expect(tolkaIntervall("NaN").slag).toBe("fel");
    expect(tolkaIntervall("Infinity").slag).toBe("fel");
  });
});

describe("Osatt och tomt betyder standard", () => {
  it("osatt ger standardintervallet", () => {
    expect(tolkaIntervall(undefined)).toEqual({ slag: "loop", sekunder: STANDARD_SEKUNDER });
  });

  it("tom sträng ger standardintervallet", () => {
    // Uppstår lätt när någon skriver MAIL_DISPATCH_INTERVAL_SECONDS= och menar
    // "som vanligt".
    expect(tolkaIntervall("")).toEqual({ slag: "loop", sekunder: STANDARD_SEKUNDER });
  });
});

describe("Ovanligt täta intervall varnar men tillåts", () => {
  it("varnar under gränsen", () => {
    const lage = tolkaIntervall("2");
    expect(lage.slag).toBe("loop");
    if (lage.slag !== "loop") return;
    expect(lage.sekunder).toBe(2);
    expect(lage.varning).toMatch(/belastar/);
    expect(lage.varning).toContain(String(VARNA_UNDER_SEKUNDER));
  });

  it("varnar inte vid ett rimligt intervall", () => {
    const lage = tolkaIntervall("30");
    expect(lage).toEqual({ slag: "loop", sekunder: 30 });
  });
});

describe("Transporten i drift", () => {
  const original = { transport: process.env.MAIL_TRANSPORT, env: process.env.NODE_ENV };

  afterEach(() => {
    if (original.transport === undefined) delete process.env.MAIL_TRANSPORT;
    else process.env.MAIL_TRANSPORT = original.transport;
    if (original.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.env;
  });

  it("vägrar console i drift", () => {
    // Ett mail som skrivs i loggen bär en inbjudnings- eller
    // återställningslänk. Den som kommer åt loggen kommer åt kontot.
    process.env.NODE_ENV = "production";
    process.env.MAIL_TRANSPORT = "console";
    expect(() => transportFromEnv()).toThrow(/bara till för utveckling/);
  });

  it("vägrar memory i drift", () => {
    process.env.NODE_ENV = "production";
    process.env.MAIL_TRANSPORT = "memory";
    expect(() => transportFromEnv()).toThrow(/bara till för utveckling/);
  });

  it("tillåter dem under utveckling", () => {
    process.env.NODE_ENV = "development";
    process.env.MAIL_TRANSPORT = "console";
    expect(transportFromEnv()).toBeInstanceOf(ConsoleTransport);
    process.env.MAIL_TRANSPORT = "memory";
    expect(transportFromEnv()).toBeInstanceOf(MemoryTransport);
  });

  it("avvisar ett okänt värde i stället för att tyst välja SMTP", () => {
    // Att falla tillbaka på SMTP hade dolt skrivfelet tills någon undrar
    // varför inställningen inte gör något.
    process.env.NODE_ENV = "development";
    process.env.MAIL_TRANSPORT = "smtp";
    expect(() => transportFromEnv()).toThrow(/känns inte igen/);
  });
});

describe("Okrypterad SMTP i drift", () => {
  const original = { osaker: process.env.MAIL_ALLOW_INSECURE, env: process.env.NODE_ENV };

  afterEach(() => {
    if (original.osaker === undefined) delete process.env.MAIL_ALLOW_INSECURE;
    else process.env.MAIL_ALLOW_INSECURE = original.osaker;
    if (original.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.env;
  });

  it("vägras i drift", () => {
    // Utan TLS går inbjudnings- och återställningslänkar i klartext över nätet.
    // Undantaget finns för att kunna pröva mot en enkel mottagare lokalt.
    process.env.NODE_ENV = "production";
    process.env.MAIL_ALLOW_INSECURE = "true";
    expect(() => transportFromEnv()).toThrow(/klartext/);
  });

  it("tillåts under utveckling", () => {
    process.env.NODE_ENV = "development";
    process.env.MAIL_ALLOW_INSECURE = "true";
    process.env.MAIL_TRANSPORT = "memory";
    expect(() => transportFromEnv()).not.toThrow();
  });
});
