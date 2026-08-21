import { createStart, createCsrfMiddleware } from "@tanstack/react-start";

/**
 * Bakom en omvänd proxy ser appen sin egen interna adress, till exempel
 * http://app:3000, medan webbläsaren skickar den publika. Utan att den publika
 * adressen anges skulle csrf-kontrollen jämföra Origin mot fel värde.
 *
 * Moderna webbläsare skickar Sec-Fetch-Site, som kontrolleras först och skulle
 * rädda oss, men att förlita sig på det vore skört. APP_URL anges därför
 * uttryckligen i drift.
 */
function allowedOrigin(): string | undefined {
  const url = process.env.APP_URL;
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    console.warn(`[start] APP_URL är ingen giltig adress: ${url}`);
    return undefined;
  }
}

// Start installerar csrf-skyddet automatiskt när src/start.ts saknas; när filen
// finns måste det läggas till uttryckligen så att serverfunktioner förblir
// skyddade mot cross-site-anrop.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  origin: allowedOrigin(),
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}));
