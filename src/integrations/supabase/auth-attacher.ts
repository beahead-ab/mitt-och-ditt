import { createMiddleware } from "@tanstack/react-start";

import { isDemo } from "@/lib/demo";
import { supabase } from "./client";

// Registreras som globalt functionMiddleware i src/start.ts; annars skickas
// aldrig bearer-token med serverFn-anrop från webbläsaren.
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    if (isDemo) return next({ headers: {} });
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
