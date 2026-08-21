import { createStart, createCsrfMiddleware } from "@tanstack/react-start";

// Start installerar csrf-skyddet automatiskt när src/start.ts saknas; när filen
// finns måste det läggas till uttryckligen så att serverfunktioner förblir
// skyddade mot cross-site-anrop.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}));
