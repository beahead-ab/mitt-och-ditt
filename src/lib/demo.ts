/**
 * Demoläge: kör hela UI:t utan Supabase, med fixturdata för Caesar och Felicia.
 * Aktiveras uttryckligen med VITE_DEMO=1 och används bara för lokal utveckling
 * och granskning — aldrig i produktion.
 */
export const isDemo = import.meta.env.VITE_DEMO === "1";

export const DEMO_USER = {
  id: "00000000-0000-0000-0000-00000000c3sa",
  email: "caesar@example.se",
  name: "Caesar",
};

export const DEMO_HOUSEHOLD = {
  id: "00000000-0000-0000-0000-0000000000ab",
  name: "Caesar & Felicia",
  propertyAddress: "Exempelgatan 12, Stockholm",
};
