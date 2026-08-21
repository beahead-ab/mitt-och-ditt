/**
 * Sätter lösenord för ett konto. Används för att komma igång med det första
 * administratörskontot, som inte skapas genom en inbjudan.
 *
 * Kör med:  npm run admin:losenord -- admin@example.se
 *
 * Lösenordet läses från terminalen, inte från argumenten, så att det inte
 * hamnar i skalets historik eller i processlistan.
 */
import { stdin, stdout } from "node:process";

import { hashPassword, MIN_PASSWORD_LENGTH } from "../src/lib/auth/password";
import { closeConnections, owner } from "../src/lib/db/client.server";

/**
 * Läser en rad utan att visa den. Inläsningen sker råt i stället för via
 * readline: readline har inget offentligt sätt att dölja inmatning, och att
 * gå via dess interna delar slutar med att strömmen avbryts i en riktig
 * terminal.
 */
/**
 * Tecken som redan lästs men hör till nästa svar. En terminal kan leverera
 * flera rader i samma chunk, och utan buffert skulle överskottet försvinna.
 */
let pending = "";

function readSecret(prompt: string): Promise<string> {
  stdout.write(prompt);

  return new Promise((resolve) => {
    let value = "";

    // Konsumera det som redan lästs innan mer väntas in.
    const fromPending = takeLine(pending);
    if (fromPending) {
      pending = fromPending.rest;
      stdout.write("\n");
      resolve(fromPending.line);
      return;
    }
    value = pending;
    pending = "";

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const done = (result: string) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      resolve(result);
    };

    const onData = (chunk: string) => {
      for (let i = 0; i < chunk.length; i += 1) {
        const character = chunk[i];
        if (character === "\n" || character === "\r" || character === "\u0004") {
          // Resten av chunken hör till nästa svar.
          pending = chunk.slice(i + 1).replace(/^\n/, "");
          done(value);
          return;
        }
        if (character === "\u0003") {
          // Ctrl+C ska avbryta, inte tolkas som tecken i lösenordet.
          stdin.setRawMode(false);
          stdout.write("\n");
          process.exit(130);
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };

    stdin.on("data", onData);
  });
}

/** Delar av en rad ur bufferten, om den innehåller ett radslut. */
function takeLine(buffer: string): { line: string; rest: string } | null {
  const index = buffer.search(/[\r\n]/);
  if (index === -1) return null;
  return {
    line: buffer.slice(0, index),
    rest: buffer.slice(index + 1).replace(/^\n/, ""),
  };
}

/** Hela strömmen på en gång, för körning från skript eller pipe. */
async function readPipedLines(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Ange e-postadressen: npm run admin:losenord -- admin@example.se");
  process.exit(1);
}

const sql = owner();
const users = await sql<{ id: string; name: string; is_admin: boolean }[]>`
  select id, name, is_admin from users where lower(email) = ${email}`;
const user = users[0];

if (!user) {
  console.error(`Hittar inget konto för ${email}.`);
  await closeConnections();
  process.exit(1);
}

let password: string;
let repeat: string;

if (stdin.isTTY) {
  password = await readSecret(`Nytt lösenord för ${user.name} <${email}>: `);
  repeat = await readSecret("Upprepa: ");
} else {
  const lines = await readPipedLines();
  password = lines[0] ?? "";
  repeat = lines[1] ?? "";
}

if (password !== repeat) {
  console.error("Lösenorden är inte lika.");
  await closeConnections();
  process.exit(1);
}
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`);
  await closeConnections();
  process.exit(1);
}

await sql`update users set password_hash = ${await hashPassword(password)} where id = ${user.id}`;
// Ett lösenordsbyte utanför tjänsten ska också avsluta öppna sessioner.
await sql`delete from sessions where user_id = ${user.id}`;

console.log(
  `Lösenordet är satt för ${user.name}${user.is_admin ? " (administratör)" : ""}. ` +
    "Eventuella öppna sessioner är avslutade.",
);
await closeConnections();
