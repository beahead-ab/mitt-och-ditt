import { addDays, kr, type AgreementParams, type Transaction } from "@/lib/engine";
import type { RecordVersion } from "@/lib/revisions";
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

/**
 * Versionshistorik för demoposterna. Motsvarar det databasen kommer att
 * innehålla: varje ändring är en ny version av hela posten, godkänd av båda
 * innan den börjar gälla. Cellernas historik härleds ur skillnaderna.
 */
function revision(
  n: number,
  values: Transaction,
  authorId: string,
  createdAt: string,
  effectiveAt: string | null,
  reason?: string,
): RecordVersion<Transaction> {
  return {
    version: n,
    values,
    authorId,
    createdAt,
    approvedBy: { [CAESAR]: createdAt, [FELICIA]: effectiveAt },
    effectiveAt,
    reason,
  };
}

const byId = new Map(DEMO_TRANSACTIONS.map((tx) => [tx.id, tx]));

export const DEMO_REVISIONS = new Map<string, RecordVersion<Transaction>[]>([
  [
    "T-0001",
    [
      revision(
        1,
        { ...byId.get("T-0001")!, payments: { [FELICIA]: { gross: kr(11_900) } } },
        FELICIA,
        "2025-06-23T14:20:00Z",
        "2025-06-24T08:05:00Z",
      ),
      revision(
        2,
        byId.get("T-0001")!,
        FELICIA,
        "2025-07-04T09:10:00Z",
        "2025-07-05T17:40:00Z",
        "Kvittot visade 12 400 kr inklusive frakt",
      ),
    ],
  ],
  [
    "T-0002",
    [revision(1, byId.get("T-0002")!, CAESAR, "2025-07-17T18:00:00Z", "2025-07-18T07:15:00Z")],
  ],
  [
    "T-0003",
    [revision(1, byId.get("T-0003")!, CAESAR, "2025-07-17T18:05:00Z", "2025-07-18T07:16:00Z")],
  ],
  [
    "T-0004",
    [
      revision(
        1,
        {
          ...byId.get("T-0004")!,
          description: "Fuktskada i badrum",
          payments: { [FELICIA]: { gross: kr(48_000) } },
        },
        FELICIA,
        "2025-09-02T16:30:00Z",
        "2025-09-03T12:00:00Z",
      ),
      revision(
        2,
        byId.get("T-0004")!,
        FELICIA,
        "2025-10-14T10:00:00Z",
        "2025-10-15T09:20:00Z",
        "Försäkringsersättningen på 20 000 kr betalades ut",
      ),
    ],
  ],
  [
    "T-0005",
    [revision(1, byId.get("T-0005")!, CAESAR, "2025-09-30T08:00:00Z", "2025-10-01T06:45:00Z")],
  ],
  ["T-0006", [revision(1, byId.get("T-0006")!, CAESAR, "2025-10-30T19:00:00Z", null)]],
]);

/**
 * En pågående exitprocess, för demoläget.
 *
 * Sidorna för försäljning och slutavräkning läser ur databasen och stod
 * därför tomma i demoläget - tre återvändsgränder mitt i den yta någon
 * utvärderar tjänsten i. Exempeldata här är inte mindre sant än de
 * exempeltransaktioner som redan driver resten av demot; det är samma
 * fixturhushåll, och ytan märker det som exempel.
 */
export const DEMO_EXIT = {
  id: "demo-exit",
  processDate: "2026-06-01",
  kind: "utkop" as const,
  status: "pagaende" as const,
  takeoverPartyId: "caesar",
  takeoverNotifiedAt: "2026-06-14T09:00:00.000Z",
  // Samma nycklar som checklistan i tjänsten använder; en fixtur med egna
  // nycklar hade visat en checklista som inte finns.
  checklist: {
    overlatelsehandling: true,
    ersattning: true,
    foreningshandlingar: false,
    ansvarsbefrielse: false,
    slutavrakning: false,
  } as Record<string, boolean>,
  note: null,
  completedAt: null,
  deadlines: { takeoverNoticeBy: "2026-07-01", saleOrBuyoutBy: "2026-09-01" },
  dodsfall: {
    estateInventoryOn: null,
    takeoverDeclaredOn: null,
    valueEstablishedOn: null,
    financingArrangedOn: null,
  },
};

/** Två värderingar, som avtalet kräver innan ett utköpsvärde fastställs. */
export const DEMO_VALUATIONS = [
  {
    id: "demo-v1",
    orderedByPartyId: "caesar",
    broker: "Mäklare Nord",
    valuedOn: "2026-06-20",
    amount: 495_000_000,
    note: null,
  },
  {
    id: "demo-v2",
    orderedByPartyId: "felicia",
    broker: "Mäklare Syd",
    valuedOn: "2026-06-22",
    amount: 505_000_000,
    note: null,
  },
];
