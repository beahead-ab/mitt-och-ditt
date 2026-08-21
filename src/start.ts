import { createStart, createCsrfMiddleware } from "@tanstack/react-start";

import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// Start installerar csrf-skyddet automatiskt när src/start.ts saknas; när filen
// finns måste det läggas till uttryckligen så att serverfunktioner förblir
// skyddade mot cross-site-anrop.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [csrfMiddleware],
}));
