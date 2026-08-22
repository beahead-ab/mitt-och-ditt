import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Kryptering av köns innehåll.
 *
 * Ett köat mail kan bära en inbjudningslänk eller en återställningstoken. De
 * ligger i databasen tills mailet gått fram, och en databasdump ska inte räcka
 * för att komma åt dem. Nyckeln finns bara i serverns miljö.
 *
 * AES-256-GCM, alltså kryptering med inbyggd äkthetskontroll: en ändrad rad går
 * inte att dekryptera, den ger ett fel. Formatet är iv.tagg.chiffer i base64,
 * med versionsprefix så att en framtida nyckelrotation går att känna igen.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Nyckeln läses vid varje anrop i stället för att cachas vid import, så att
 * tester kan sätta och byta den. Kostnaden är en base64-avkodning.
 */
function key(): Buffer {
  const raw = process.env.MAIL_QUEUE_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "MAIL_QUEUE_ENCRYPTION_KEY saknas. Utan den kan köade mail inte krypteras. Se .env.example.",
    );
  }
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== KEY_BYTES) {
    // Meddelandet nämner längden men aldrig värdet.
    throw new Error(
      `MAIL_QUEUE_ENCRYPTION_KEY ska vara ${KEY_BYTES} byte i base64, men är ${bytes.length}.`,
    );
  }
  return bytes;
}

export function encryptParams(params: Record<string, unknown>): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(params), "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(".");
}

export function decryptParams(payload: string): Record<string, unknown> {
  const [version, iv, tag, body] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !body) {
    throw new Error("Krypterat mailinnehåll har okänt format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(body, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plain) as Record<string, unknown>;
}

/** Skapar en nyckel. Används av driftdokumentationen, aldrig automatiskt. */
export function newEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}
