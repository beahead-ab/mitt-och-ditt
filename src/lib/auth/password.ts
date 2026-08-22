import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// promisify:s inbyggda typ tappar options-argumentet, så överlagringen anges här.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Lösenordshashning med scrypt ur Nodes standardbibliotek. Valet är medvetet:
 * scrypt är minneshårt och behöver ingen kompilerad tredjepartsmodul, vilket
 * håller containern liten och byggbar överallt.
 *
 * Parametrarna följer OWASP: N=2^17, r=8, p=1.
 */
const COST = 2 ** 17;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEMORY = 256 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password: string): Promise<string> {
  if (password.normalize("NFKC").length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`);
  }
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: MAX_MEMORY,
  });
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Jämförelsen sker i konstant tid. Ett okänt hashformat ger false i stället
 * för ett kastat fel, så att en trasig rad inte kan användas för att skilja
 * konton åt.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, cost, blockSize, parallelization, salt, expected] = parts;

  try {
    const expectedBuffer = Buffer.from(expected, "base64");
    if (expectedBuffer.length === 0) return false;
    const key = await scryptAsync(
      password.normalize("NFKC"),
      Buffer.from(salt, "base64"),
      expectedBuffer.length,
      {
        N: Number(cost),
        r: Number(blockSize),
        p: Number(parallelization),
        maxmem: MAX_MEMORY,
      },
    );
    if (key.length !== expectedBuffer.length) return false;
    return timingSafeEqual(key, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * En riktig hash av ett slumpat lösenord, att jämföra mot när kontot inte finns.
 *
 * Utan den skulle ett okänt konto svara direkt medan ett känt konto först
 * körde scrypt, och skillnaden i svarstid räckte för att lista ut vilka
 * adresser som har konto. Hashen räknas fram en gång och återanvänds.
 */
let dummy: Promise<string> | undefined;

export function dummyHash(): Promise<string> {
  if (!dummy) dummy = hashPassword(randomBytes(32).toString("base64"));
  return dummy;
}
