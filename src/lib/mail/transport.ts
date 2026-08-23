import nodemailer from "nodemailer";

/**
 * Transportlagret. Motorn känner bara det här gränssnittet, så SMTP kan bytas
 * mot något annat utan att kön, mallarna eller flödena rörs.
 */
export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface MailTransport {
  readonly name: string;
  send(mail: OutgoingMail): Promise<void>;
}

/**
 * Fel som inte blir bättre av att försökas igen - fel adress, avvisat av
 * servern av innehållsskäl. Skiljs från tillfälliga fel så att kön kan ge upp
 * direkt i stället för att försöka sex gånger i onödan.
 */
export class PermanentMailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentMailError";
  }
}

/** Samlar mailen i minnet i stället för att skicka dem. Används av tester. */
export class MemoryTransport implements MailTransport {
  readonly name = "memory";
  readonly sent: OutgoingMail[] = [];
  /** Sätts av testet för att härma en trasig mailserver. */
  failWith?: Error;

  async send(mail: OutgoingMail): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(mail);
  }
}

/** Skriver mailet till loggen i stället för att skicka. För lokal utveckling. */
export class ConsoleTransport implements MailTransport {
  readonly name = "console";

  async send(mail: OutgoingMail): Promise<void> {
    console.log(`\n--- mail till ${mail.to} ---\n${mail.subject}\n\n${mail.text}\n---\n`);
  }
}

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  replyTo?: string;
};

/**
 * Läser inställningarna ur miljön. Kastar med namnet på det som saknas, aldrig
 * med värdet - ett felmeddelande hamnar i loggar.
 */
export function smtpSettingsFromEnv(): SmtpSettings {
  const host = process.env.SMTP_HOST;
  const from = process.env.MAIL_FROM;
  const missing = [!host && "SMTP_HOST", !from && "MAIL_FROM"].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Mailinställningar saknas: ${missing.join(", ")}. Se .env.example.`);
  }

  const port = Number(process.env.SMTP_PORT ?? 465);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`SMTP_PORT är inget giltigt portnummer: ${process.env.SMTP_PORT}`);
  }

  // Implicit TLS på 465, StartTLS på 587. Går att styra uttryckligen, men
  // standarden följer porten så att en felskrivning inte tyst ger klartext.
  const secureRaw = process.env.SMTP_SECURE;
  const secure = secureRaw === undefined ? port === 465 : secureRaw === "true";

  return {
    host: host as string,
    port,
    secure,
    user: process.env.SMTP_USER || undefined,
    password: process.env.SMTP_PASSWORD || undefined,
    from: from as string,
    replyTo: process.env.MAIL_REPLY_TO || undefined,
  };
}

export class SmtpTransport implements MailTransport {
  readonly name = "smtp";
  private readonly settings: SmtpSettings;
  private transporter: nodemailer.Transporter | undefined;

  constructor(settings: SmtpSettings) {
    this.settings = settings;
  }

  private get client(): nodemailer.Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.settings.host,
        port: this.settings.port,
        secure: this.settings.secure,
        auth: this.settings.user
          ? { user: this.settings.user, pass: this.settings.password }
          : undefined,
        // Utan implicit TLS ska StartTLS krävas, annars skulle ett felkonfigurerat
        // mellanled kunna ge klartext över nätet. Undantaget är uttryckligen
        // avstängt läge i test, som aldrig når ett riktigt nät.
        requireTLS: !this.settings.secure && process.env.MAIL_ALLOW_INSECURE !== "true",
        ignoreTLS: process.env.MAIL_ALLOW_INSECURE === "true",
      });
    }
    return this.transporter;
  }

  async send(mail: OutgoingMail): Promise<void> {
    try {
      await this.client.sendMail({
        from: this.settings.from,
        replyTo: this.settings.replyTo,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    } catch (error) {
      // 5xx betyder att servern avvisat mailet för gott; att försöka igen ger
      // samma svar. 4xx och nätverksfel är tillfälliga.
      const code = (error as { responseCode?: number }).responseCode;
      if (code !== undefined && code >= 500 && code < 600) {
        throw new PermanentMailError(safeMessage(error));
      }
      throw error;
    }
  }
}

/**
 * Kort felbeskrivning utan hemligheter. Serverns svar kan innehålla adresser
 * och ibland delar av inloggningen, så bara koden och en kort text sparas.
 */
export function safeMessage(error: unknown): string {
  const code = (error as { responseCode?: number; code?: string }).responseCode;
  const symbol = (error as { code?: string }).code;
  const parts = [
    code !== undefined ? `SMTP ${code}` : undefined,
    symbol,
    error instanceof Error ? error.name : undefined,
  ].filter(Boolean);
  return parts.join(" ").slice(0, 200) || "Okänt fel";
}

/**
 * Transporten som drift ska använda. Testtransporten väljs uttryckligen med
 * MAIL_TRANSPORT, aldrig av misstag: står inget alls används SMTP, så en
 * glömd variabel gör tjänsten tyst-trasig i stället för att skicka på riktigt.
 */
/**
 * Transporterna som aldrig får användas i drift.
 *
 * Båda skriver mailets innehåll där det går att läsa - console i loggen,
 * memory i processens minne. Mailen bär inbjudnings- och
 * återställningslänkar, och en länk i en produktionslogg är en väg in i
 * någon annans konto för var och en som kommer åt loggen.
 */
const BARA_FOR_UTVECKLING = ["console", "memory"];

export function transportFromEnv(): MailTransport {
  const val = process.env.MAIL_TRANSPORT?.trim() ?? "";

  if (BARA_FOR_UTVECKLING.includes(val) && process.env.NODE_ENV === "production") {
    throw new Error(
      `MAIL_TRANSPORT=${val} är bara till för utveckling och kan inte användas i drift: ` +
        "inbjudnings- och återställningslänkar skulle hamna i loggen. Lämna variabeln tom " +
        "för SMTP.",
    );
  }

  switch (val) {
    case "memory":
      return new MemoryTransport();
    case "console":
      return new ConsoleTransport();
    case "":
      return new SmtpTransport(smtpSettingsFromEnv());
    default:
      // Ett okänt värde är ett skrivfel. Att tyst falla tillbaka på SMTP hade
      // dolt det tills någon undrar varför inställningen inte gör något.
      throw new Error(
        `MAIL_TRANSPORT="${val}" känns inte igen. Lämna tom för SMTP, eller använd ` +
          `${BARA_FOR_UTVECKLING.join(" eller ")} under utveckling.`,
      );
  }
}
