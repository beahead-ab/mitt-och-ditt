/**
 * Mailmallarna.
 *
 * Två regler styr innehållet. För det första: inga belopp, kvitton eller
 * uppgifter om parternas ekonomi. Mailet säger vad som hänt och länkar till
 * tjänsten, där mottagaren är inloggad och radnivåsäkerheten gäller. Ett mail
 * passerar servrar vi inte råder över och kan bli kvar i en inkorg i åratal.
 *
 * För det andra: varje mall finns som både text och HTML ur samma källa, så att
 * de aldrig kan säga olika saker.
 */

/** Paletten ur src/styles.css, omräknad till hex eftersom oklch inte går i mail. */
const FARG = {
  bone: "#FBFAF8",
  card: "#FFFFFF",
  ink: "#15110D",
  inkSoft: "#2D2824",
  copper: "#CA4B20",
  hairline: "#D5D0CA",
} as const;

const AVSANDARNAMN = "Mitt & Ditt";

export type MailBlock =
  | { slag: "stycke"; text: string }
  | { slag: "knapp"; text: string; url: string }
  | { slag: "punkter"; punkter: string[] }
  | { slag: "not"; text: string };

export type RenderedMail = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Bygger båda versionerna ur samma block. Tabellbaserad HTML med infogade
 * stilar, eftersom mailklienter varken följer moderna layouter eller externa
 * stilmallar. Bredden är flytande så att den håller på telefon.
 */
export function bygg(rubrik: string, block: MailBlock[], amne: string): RenderedMail {
  const textrader = [rubrik, ""];
  const htmlrader: string[] = [];

  for (const b of block) {
    switch (b.slag) {
      case "stycke":
        textrader.push(b.text, "");
        htmlrader.push(
          `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${FARG.inkSoft}">${escapeHtml(b.text)}</p>`,
        );
        break;
      case "punkter":
        for (const p of b.punkter) textrader.push(`  • ${p}`);
        textrader.push("");
        htmlrader.push(
          `<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.6;color:${FARG.inkSoft}">` +
            b.punkter.map((p) => `<li style="margin:0 0 6px">${escapeHtml(p)}</li>`).join("") +
            `</ul>`,
        );
        break;
      case "knapp":
        textrader.push(`${b.text}: ${b.url}`, "");
        htmlrader.push(
          `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="border-radius:8px;background:${FARG.copper}">` +
            `<a href="${escapeHtml(b.url)}" style="display:inline-block;padding:12px 22px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none">${escapeHtml(b.text)}</a>` +
            `</td></tr></table>` +
            `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${FARG.inkSoft}">Fungerar inte knappen? Klistra in adressen i webbläsaren:<br><span style="word-break:break-all">${escapeHtml(b.url)}</span></p>`,
        );
        break;
      case "not":
        textrader.push(b.text, "");
        htmlrader.push(
          `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:${FARG.inkSoft}">${escapeHtml(b.text)}</p>`,
        );
        break;
    }
  }

  textrader.push("--", `${AVSANDARNAMN}`, "Det här mailet går inte att svara på i tjänsten.");

  const html = [
    `<!doctype html><html lang="sv"><body style="margin:0;padding:0;background:${FARG.bone}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FARG.bone};padding:24px 12px">`,
    `<tr><td align="center">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:${FARG.card};border:1px solid ${FARG.hairline};border-radius:12px">`,
    `<tr><td style="padding:28px 28px 8px">`,
    `<p style="margin:0 0 4px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${FARG.copper}">${AVSANDARNAMN}</p>`,
    `<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:${FARG.ink};font-weight:600">${escapeHtml(rubrik)}</h1>`,
    htmlrader.join(""),
    `</td></tr>`,
    `<tr><td style="padding:4px 28px 26px;border-top:1px solid ${FARG.hairline}">`,
    `<p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:${FARG.inkSoft}">Det här mailet går inte att svara på i tjänsten. Uppgifter om ekonomin finns bara inne i Mitt &amp; Ditt, aldrig i mailet.</p>`,
    `</td></tr></table></td></tr></table></body></html>`,
  ].join("");

  return { subject: amne, text: textrader.join("\n").trimEnd() + "\n", html };
}

/** Läser en textparameter och kastar tydligt om den saknas. */
function s(params: Record<string, unknown>, namn: string): string {
  const v = params[namn];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Mailmallen saknar parametern ${namn}.`);
  }
  return v;
}

function valfri(params: Record<string, unknown>, namn: string): string | undefined {
  const v = params[namn];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export type MallNamn =
  | "inbjudan"
  | "inbjudan_ny"
  | "losenord_aterstall"
  | "losenord_bytt"
  | "motpart_accepterade"
  | "post_vantar"
  | "post_beslutad"
  | "dokument_vantar"
  | "processdag"
  | "avstamning"
  | "veckosammanfattning"
  | "konto_status";

type Mall = (params: Record<string, unknown>) => RenderedMail;

export const MALLAR: Record<MallNamn, Mall> = {
  inbjudan: (p) =>
    bygg(
      `${s(p, "hushall")} väntar på dig`,
      [
        {
          slag: "stycke",
          text: `Hej ${s(p, "namn")}. Du har blivit inbjuden till Mitt & Ditt, tjänsten där ni dokumenterar vad ni kommit överens om och håller reda på hur era interna andelar utvecklas.`,
        },
        { slag: "knapp", text: "Skapa ditt konto", url: s(p, "url") },
        {
          slag: "not",
          text: `Länken gäller till ${s(p, "giltigTill")} och kan bara användas en gång. Tjänsten är bara för inbjudna – ingen kan registrera sig själv.`,
        },
      ],
      "Din inbjudan till Mitt & Ditt",
    ),

  inbjudan_ny: (p) =>
    bygg(
      "Här är en ny inbjudan",
      [
        {
          slag: "stycke",
          text: `Hej ${s(p, "namn")}. Den tidigare inbjudan gäller inte längre, så här kommer en ny.`,
        },
        { slag: "knapp", text: "Skapa ditt konto", url: s(p, "url") },
        {
          slag: "not",
          text: `Länken gäller till ${s(p, "giltigTill")}. Den gamla länken slutade gälla i samma stund som den här skapades.`,
        },
      ],
      "Ny inbjudan till Mitt & Ditt",
    ),

  losenord_aterstall: (p) =>
    bygg(
      "Återställ ditt lösenord",
      [
        {
          slag: "stycke",
          text: "Någon har begärt att lösenordet för det här kontot ska återställas.",
        },
        { slag: "knapp", text: "Välj nytt lösenord", url: s(p, "url") },
        {
          slag: "not",
          text: "Länken gäller i 30 minuter och kan bara användas en gång. Var det inte du behöver du inte göra något – lösenordet ändras inte förrän någon följt länken och valt ett nytt.",
        },
      ],
      "Återställ ditt lösenord i Mitt & Ditt",
    ),

  losenord_bytt: (p) =>
    bygg(
      "Ditt lösenord har ändrats",
      [
        {
          slag: "stycke",
          text: `Lösenordet för ${s(p, "epost")} ändrades ${s(p, "tidpunkt")}. Alla andra inloggningar avslutades samtidigt.`,
        },
        {
          slag: "stycke",
          text: "Var det inte du som gjorde det: återställ lösenordet direkt och hör av dig till den som administrerar tjänsten.",
        },
        { slag: "knapp", text: "Öppna Mitt & Ditt", url: s(p, "url") },
      ],
      "Ditt lösenord i Mitt & Ditt har ändrats",
    ),

  motpart_accepterade: (p) =>
    bygg(
      `${s(p, "motpart")} har skapat sitt konto`,
      [
        {
          slag: "stycke",
          text: `${s(p, "motpart")} har tackat ja till inbjudan och är nu med i ${s(p, "hushall")}. Ni kan börja registrera poster och godkänna varandras.`,
        },
        { slag: "knapp", text: "Öppna Mitt & Ditt", url: s(p, "url") },
      ],
      "Motparten har anslutit sig",
    ),

  post_vantar: (p) =>
    bygg(
      "En post väntar på ditt beslut",
      [
        {
          slag: "stycke",
          text: `${s(p, "motpart")} har registrerat en ${s(p, "slag")} som behöver ditt ställningstagande. Du kan godkänna eller invända.`,
        },
        {
          slag: "stycke",
          text: "Beloppet och underlaget ser du när du loggat in. Inget räknas in i era andelar förrän båda godkänt.",
        },
        { slag: "knapp", text: "Ta ställning", url: s(p, "url") },
      ],
      "En post väntar på ditt beslut",
    ),

  post_beslutad: (p) =>
    bygg(
      `${s(p, "motpart")} har ${s(p, "beslut")} en post`,
      [
        {
          slag: "stycke",
          text: `Posten du registrerade har fått ett beslut av ${s(p, "motpart")}.`,
        },
        { slag: "knapp", text: "Se posten", url: s(p, "url") },
      ],
      "Beslut om en av dina poster",
    ),

  dokument_vantar: (p) =>
    bygg(
      `${s(p, "dokument")} väntar på ditt godkännande`,
      [
        {
          slag: "stycke",
          text: `${s(p, "motpart")} har lagt fram ${s(p, "dokument").toLowerCase()} som börjar gälla först när ni båda godkänt exakt samma innehåll.`,
        },
        {
          slag: "stycke",
          text: "Läs igenom innan du godkänner. Ett godkännande går inte att ta tillbaka.",
        },
        { slag: "knapp", text: "Läs och ta ställning", url: s(p, "url") },
      ],
      `${s(p, "dokument")} väntar på ditt godkännande`,
    ),

  processdag: (p) => {
    const block: MailBlock[] = [
      { slag: "stycke", text: s(p, "beskrivning") },
      { slag: "knapp", text: "Öppna processen", url: s(p, "url") },
    ];
    const frist = valfri(p, "frist");
    if (frist) block.splice(1, 0, { slag: "not", text: frist });
    return bygg(s(p, "rubrik"), block, s(p, "rubrik"));
  },

  avstamning: (p) =>
    bygg(
      "Dags för kvartalsavstämning",
      [
        { slag: "stycke", text: s(p, "beskrivning") },
        {
          slag: "punkter",
          punkter: ["Transaktioner", "Lånesaldo", "Faktisk och preliminär skatt", "Bilagor"],
        },
        {
          slag: "stycke",
          text: "Avstämningen är klar när ni båda bekräftat. Då startar nästa tremånadersperiod.",
        },
        { slag: "knapp", text: "Gör avstämningen", url: s(p, "url") },
      ],
      "Kvartalsavstämning i Mitt & Ditt",
    ),

  veckosammanfattning: (p) =>
    bygg(
      "Veckans läge",
      [
        {
          slag: "stycke",
          text: "En kort sammanfattning av vad som väntar. Siffrorna ser du inne i tjänsten.",
        },
        {
          slag: "punkter",
          punkter: (p.punkter as string[] | undefined) ?? ["Inget väntar just nu."],
        },
        { slag: "knapp", text: "Öppna Mitt & Ditt", url: s(p, "url") },
        {
          slag: "not",
          text: "Vill du inte ha den här sammanfattningen kan du stänga av den under Konto.",
        },
      ],
      "Veckans läge i Mitt & Ditt",
    ),

  konto_status: (p) =>
    bygg(
      s(p, "avstangt") === "ja" ? "Ditt konto är avstängt" : "Ditt konto är öppnat igen",
      [
        {
          slag: "stycke",
          text:
            s(p, "avstangt") === "ja"
              ? "Administratören har stängt av ditt konto. Dina poster ligger kvar oförändrade, men du kan inte logga in förrän kontot öppnas igen."
              : "Administratören har öppnat ditt konto igen. Du kan logga in som vanligt.",
        },
        { slag: "knapp", text: "Öppna Mitt & Ditt", url: s(p, "url") },
      ],
      s(p, "avstangt") === "ja" ? "Ditt konto är avstängt" : "Ditt konto är öppnat igen",
    ),
};

export function render(mall: string, params: Record<string, unknown>): RenderedMail {
  const fn = MALLAR[mall as MallNamn];
  if (!fn) throw new Error(`Okänd mailmall: ${mall}`);
  return fn(params);
}
