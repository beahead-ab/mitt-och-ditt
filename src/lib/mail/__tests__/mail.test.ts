import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decryptParams, encryptParams, newEncryptionKey } from "../crypto";
import { render, MALLAR, type MallNamn } from "../templates";
import {
  MemoryTransport,
  PermanentMailError,
  safeMessage,
  SmtpTransport,
  smtpSettingsFromEnv,
  transportFromEnv,
} from "../transport";
import { startSmtpSink, type Sink } from "./smtp-sink";

const NYCKEL = newEncryptionKey();

beforeAll(() => {
  process.env.MAIL_QUEUE_ENCRYPTION_KEY = NYCKEL;
});

describe("Kryptering av köns innehåll", () => {
  it("går att låsa upp igen", () => {
    const params = { url: "https://exempel.se/inbjudan/hemlig", namn: "Caesar" };
    const laddat = encryptParams(params);
    expect(decryptParams(laddat)).toEqual(params);
  });

  it("visar aldrig klartexten i det lagrade värdet", () => {
    const laddat = encryptParams({ url: "https://exempel.se/inbjudan/topphemlig" });
    expect(laddat).not.toContain("topphemlig");
    expect(laddat).not.toContain("exempel.se");
  });

  it("ger olika resultat varje gång, så två lika mail inte syns som lika", () => {
    const a = encryptParams({ url: "x" });
    const b = encryptParams({ url: "x" });
    expect(a).not.toEqual(b);
  });

  it("vägrar låsa upp en ändrad rad", () => {
    const laddat = encryptParams({ url: "https://exempel.se/a" });
    const delar = laddat.split(".");
    const bruten = [delar[0], delar[1], delar[2], Buffer.from("annat").toString("base64")].join(
      ".",
    );
    expect(() => decryptParams(bruten)).toThrow();
  });

  it("vägrar arbeta utan nyckel, i stället för att spara i klartext", () => {
    const original = process.env.MAIL_QUEUE_ENCRYPTION_KEY;
    delete process.env.MAIL_QUEUE_ENCRYPTION_KEY;
    expect(() => encryptParams({ a: "b" })).toThrow(/MAIL_QUEUE_ENCRYPTION_KEY saknas/);
    process.env.MAIL_QUEUE_ENCRYPTION_KEY = original;
  });

  it("klagar på fel nyckellängd utan att röja värdet", () => {
    const original = process.env.MAIL_QUEUE_ENCRYPTION_KEY;
    process.env.MAIL_QUEUE_ENCRYPTION_KEY = Buffer.from("för kort").toString("base64");
    expect(() => encryptParams({ a: "b" })).toThrow(/32 byte/);
    try {
      encryptParams({ a: "b" });
    } catch (error) {
      expect((error as Error).message).not.toContain("för kort");
    }
    process.env.MAIL_QUEUE_ENCRYPTION_KEY = original;
  });
});

/** Parametrar som räcker för att bygga varje mall. */
const PARAMS: Record<MallNamn, Record<string, unknown>> = {
  inbjudan: {
    namn: "Felicia",
    hushall: "Caesar & Felicia",
    url: "https://x.se/i/abc",
    giltigTill: "1 september",
  },
  inbjudan_ny: { namn: "Felicia", url: "https://x.se/i/def", giltigTill: "1 september" },
  losenord_aterstall: { url: "https://x.se/aterstall/ghi" },
  losenord_bytt: { epost: "a@b.se", tidpunkt: "22 augusti 09:14", url: "https://x.se" },
  motpart_accepterade: { motpart: "Felicia", hushall: "Caesar & Felicia", url: "https://x.se" },
  post_vantar: { motpart: "Caesar", slag: "reparation", url: "https://x.se/t" },
  post_beslutad: { motpart: "Felicia", beslut: "godkänt", url: "https://x.se/t" },
  dokument_vantar: { motpart: "Caesar", dokument: "Ny avtalsversion", url: "https://x.se/a" },
  processdag: {
    rubrik: "Processdagen är registrerad",
    beskrivning: "Processen har startat.",
    url: "https://x.se/f",
    frist: "Besked inom 14 dagar.",
  },
  avstamning: { beskrivning: "Kvartalet ska stämmas av.", url: "https://x.se/av" },
  veckosammanfattning: { punkter: ["Två poster väntar"], url: "https://x.se" },
  konto_status: { avstangt: "ja", url: "https://x.se" },
};

describe("Mailmallarna", () => {
  const namn = Object.keys(MALLAR) as MallNamn[];

  it.each(namn)("%s ger både text och HTML", (mall) => {
    const { subject, text, html } = render(mall, PARAMS[mall]);
    expect(subject.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
    expect(html).toContain("<html");
    expect(html).toContain("Mitt &amp; Ditt");
  });

  it.each(namn)("%s nämner inga belopp", (mall) => {
    const { text, html } = render(mall, PARAMS[mall]);
    // Ett mail får aldrig bära ekonomiskt innehåll; det finns bara inne i
    // tjänsten. Siffror som ser ut som kronor eller ören ska alltså inte
    // förekomma alls.
    for (const innehall of [text, html]) {
      expect(innehall).not.toMatch(/\d[\d\s\u00a0\u202f]*(kr|kronor|SEK)\b/i);
    }
  });

  it("skyddar mot inklistrad HTML i ett namn", () => {
    const { html } = render("inbjudan", {
      ...PARAMS.inbjudan,
      namn: '<img src=x onerror="alert(1)">',
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("säger ifrån när en parameter saknas i stället för att skicka halvfärdigt", () => {
    expect(() => render("inbjudan", { namn: "Felicia" })).toThrow(/saknar parametern/);
  });

  it("vägrar bygga en okänd mall", () => {
    expect(() => render("hittepå", {})).toThrow(/Okänd mailmall/);
  });
});

describe("Transporten mot en riktig SMTP-server", () => {
  let sink: Sink;

  beforeAll(async () => {
    sink = await startSmtpSink();
    process.env.MAIL_ALLOW_INSECURE = "true";
  });

  afterAll(async () => {
    await sink.stop();
    delete process.env.MAIL_ALLOW_INSECURE;
  });

  function transport(): SmtpTransport {
    return new SmtpTransport({
      host: "127.0.0.1",
      port: sink.port,
      secure: false,
      user: "mittochditt",
      password: "hemligt-i-testet",
      from: "Mitt & Ditt <ingen@example.test>",
      replyTo: "svar@example.test",
    });
  }

  it("levererar mailet med kuvert, ämne och båda kroppar", async () => {
    const { subject, text, html } = render("inbjudan", PARAMS.inbjudan);
    await transport().send({ to: "felicia@example.test", subject, text, html });

    const mottaget = sink.mail.at(-1);
    expect(mottaget?.to).toEqual(["felicia@example.test"]);
    expect(mottaget?.from).toBe("ingen@example.test");
    expect(mottaget?.authenticated).toBe(true);
    expect(mottaget?.data).toContain("Reply-To:");
    // Ämnet kodas eftersom det innehåller svenska tecken.
    expect(mottaget?.data).toMatch(/Subject:.+/);
    expect(mottaget?.data).toContain("multipart/alternative");
  });

  it("kodar svenska tecken så att de går att läsa fram igen", async () => {
    await transport().send({
      to: "a@example.test",
      subject: "Kvartalsavstämning",
      text: "Överenskommelsen gäller från förvärvet.",
      html: "<p>Överenskommelsen gäller från förvärvet.</p>",
    });
    const rad = sink.mail.at(-1)!.data;
    // Antingen quoted-printable eller base64 – båda ska gå att avkoda tillbaka.
    const avkodat = rad
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const base64Block = /Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/.exec(
      rad,
    );
    const text = base64Block
      ? Buffer.from(base64Block[1].replace(/\s/g, ""), "base64").toString("utf8")
      : Buffer.from(avkodat, "latin1").toString("utf8");
    expect(text).toContain("Överenskommelsen");
  });

  it("behandlar 5xx som permanent, så kön inte försöker i timmar", async () => {
    sink.svaraMed = { kod: 550, text: "5.1.1 No such user" };
    await expect(
      transport().send({
        to: "finns-inte@example.test",
        subject: "x",
        text: "x",
        html: "<p>x</p>",
      }),
    ).rejects.toBeInstanceOf(PermanentMailError);
    sink.svaraMed = undefined;
  });

  it("behandlar 4xx som tillfälligt", async () => {
    sink.svaraMed = { kod: 451, text: "4.3.0 Try again later" };
    const fel = await transport()
      .send({ to: "a@example.test", subject: "x", text: "x", html: "<p>x</p>" })
      .catch((e) => e);
    expect(fel).toBeInstanceOf(Error);
    expect(fel).not.toBeInstanceOf(PermanentMailError);
    sink.svaraMed = undefined;
  });
});

describe("Felmeddelanden och val av transport", () => {
  it("kortar ned serverns svar och tar aldrig med innehållet", () => {
    const fel = Object.assign(new Error("550 rejected for user hemlig@example.se token=abc123"), {
      responseCode: 550,
      code: "EMESSAGE",
    });
    const text = safeMessage(fel);
    expect(text).toContain("SMTP 550");
    expect(text).not.toContain("hemlig@example.se");
    expect(text).not.toContain("abc123");
  });

  it("väljer SMTP när inget anges, i stället för att tyst svälja mailen", () => {
    const original = { ...process.env };
    delete process.env.MAIL_TRANSPORT;
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.MAIL_FROM = "Mitt & Ditt <ingen@example.test>";
    expect(transportFromEnv().name).toBe("smtp");
    process.env.MAIL_TRANSPORT = "memory";
    expect(transportFromEnv()).toBeInstanceOf(MemoryTransport);
    process.env = original;
  });

  it("säger vilken inställning som saknas, utan att skriva ut något värde", () => {
    const original = { ...process.env };
    delete process.env.SMTP_HOST;
    process.env.MAIL_FROM = "";
    expect(() => smtpSettingsFromEnv()).toThrow(/SMTP_HOST, MAIL_FROM/);
    process.env = original;
  });

  it("följer porten när SMTP_SECURE inte är satt", () => {
    const original = { ...process.env };
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.MAIL_FROM = "a@example.test";
    delete process.env.SMTP_SECURE;
    process.env.SMTP_PORT = "465";
    expect(smtpSettingsFromEnv().secure).toBe(true);
    process.env.SMTP_PORT = "587";
    expect(smtpSettingsFromEnv().secure).toBe(false);
    process.env = original;
  });
});
