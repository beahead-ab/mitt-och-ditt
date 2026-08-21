import { addDays, kr, type AgreementParams, type Transaction } from "@/lib/engine";
import { CAESAR, FELICIA, SEED_AGREEMENT } from "@/lib/seed";

/**
 * Demoläge: hela gränssnittet kan köras utan databas, med ett litet påhittat
 * underlag. Används för utveckling och granskning innan etapp 2 (Postgres och
 * inloggning) är på plats. Aktiveras med VITE_DEMO=1.
 */
export const isDemo = import.meta.env.VITE_DEMO === "1";

export const DEMO_USER = {
  id: "demo-caesar",
  email: "caesar@example.se",
  partyId: CAESAR,
};

export const DEMO_HOUSEHOLD = {
  id: "demo-hushall",
  name: "Caesar & Felicia",
  propertyAddress: "Exempelgatan 12, Stockholm",
};

/**
 * Demohushållet har samma belopp som den riktiga överenskommelsen men en
 * tidigare startdag, så att gränssnittet kan visa ett år av historik.
 */
export const DEMO_AGREEMENT: AgreementParams = {
  ...SEED_AGREEMENT,
  startDate: "2025-06-02",
};

const start = DEMO_AGREEMENT.startDate;

/** Påhittade poster som visar modellens olika lägen. Ingen verklig data. */
export const DEMO_TRANSACTIONS: Transaction[] = [
  {
    id: "T-0001",
    paymentDate: addDays(start, 21),
    category: "Vitvara/fast utrustning",
    description: "Tvättmaskin som lämnas kvar i bostaden",
    payments: { [FELICIA]: { gross: kr(12_400) } },
    status: "approved",
  },
  {
    id: "T-0002",
    paymentDate: addDays(start, 45),
    category: "Ränta",
    description: "Kvartalsränta, skattereduktion till respektive part",
    payments: {
      [CAESAR]: { gross: kr(11_200), taxEffect: kr(3_360), taxPreliminary: true },
      [FELICIA]: { gross: kr(4_800), taxEffect: kr(1_440), taxPreliminary: true },
    },
    status: "approved",
  },
  {
    id: "T-0003",
    paymentDate: addDays(start, 45),
    category: "Amortering",
    description: "Amortering enligt bankens plan",
    payments: { [CAESAR]: { gross: kr(9_000) } },
    status: "approved",
  },
  {
    id: "T-0004",
    paymentDate: addDays(start, 92),
    category: "Reparation",
    description: "Fuktskada i badrum, efter försäkringsersättning",
    payments: { [FELICIA]: { gross: kr(48_000), insurance: kr(20_000) } },
    status: "approved",
  },
  {
    id: "T-0005",
    paymentDate: addDays(start, 120),
    category: "BRF-avgift",
    description: "Månadsavgift – utanför enhetsmodellen, delas 50/50",
    payments: { [CAESAR]: { gross: kr(4_850) } },
    status: "approved",
  },
  {
    id: "T-0006",
    paymentDate: addDays(start, 150),
    category: "Förbättring",
    description: "Ny köksbänk – väntar på Felicias godkännande",
    payments: { [CAESAR]: { gross: kr(31_500) } },
    status: "pending",
  },
];
