import { owner } from "@/lib/db/client.server";

import { enqueue } from "./queue.server";

/**
 * Besked om att något hänt i hushållet.
 *
 * En egen modul, så att varje utskick går samma väg: rätt mottagare, en
 * bestämd idempotensnyckel, och aldrig ett namn eller en adress i koden.
 *
 * Idempotensen är hela poängen. Kön avvisar en nyckel som redan finns, så
 * nyckeln måste vara härledd ur händelsen - inte ur tidpunkten. Ett omladdat
 * formulär, ett nytt försök efter ett avbrott eller två samtidiga anrop ska
 * ge ett mail, inte tre.
 *
 * Mailen bär aldrig belopp eller uppgifter om ekonomin. De säger vad som hänt
 * och länkar till tjänsten, precis som integritetssidan lovar.
 */

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

type Mottagare = { userId: string; email: string; name: string; partyId: string };

/** Hushållets parter, med adress. Frågan går genom ägarrollen: mottagaren är
 * inte den inloggade, och den inloggade får inte se motpartens adress. */
async function parter(householdId: string): Promise<Mottagare[]> {
  const rader = await owner()<{ user_id: string; email: string; name: string; party_id: string }[]>`
    select m.user_id, u.email, m.display_name as name, m.party_id
      from household_members m
      join users u on u.id = m.user_id
     where m.household_id = ${householdId}
       and u.disabled_at is null
  `;
  return rader.map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.name,
    partyId: r.party_id,
  }));
}

/** Hushållets namn, för mailets ämnesrad. */
async function hushallsnamn(householdId: string): Promise<string> {
  const [rad] = await owner()<{ name: string }[]>`
    select name from households where id = ${householdId}`;
  return rad?.name ?? "ert hushåll";
}

/**
 * En post väntar på motpartens ställningstagande.
 *
 * Nyckeln bär postens id och versionsnummer: en korrigerad post är en ny
 * händelse och ska ge ett nytt besked, men samma version aldrig två gånger.
 */
export async function notifieraPostVantar(args: {
  householdId: string;
  reference: string;
  version: number;
  kostnadsslag: string;
  registeradAvPartyId: string;
}): Promise<void> {
  const [alla, hushall] = await Promise.all([
    parter(args.householdId),
    hushallsnamn(args.householdId),
  ]);
  const mottagare = alla.filter((p) => p.partyId !== args.registeradAvPartyId);
  const avsandare = alla.find((p) => p.partyId === args.registeradAvPartyId);

  for (const till of mottagare) {
    await enqueue({
      idempotencyKey: `post-vantar:${args.reference}:${args.version}:${till.userId}`,
      template: "post_vantar",
      to: till.email,
      householdId: args.householdId,
      recipientUserId: till.userId,
      params: {
        motpart: avsandare?.name ?? "Motparten",
        slag: args.kostnadsslag,
        url: `${appUrl()}/transaktioner/vantar`,
      },
    });
  }
}

/**
 * En post är avgjord: godkänd, invänd mot, korrigerad eller makulerad.
 *
 * Går till den som registrerade posten - det är den som väntar på svar.
 */
export async function notifieraPostBeslutad(args: {
  householdId: string;
  reference: string;
  version: number;
  beslut: "godkand" | "invand" | "korrigerad" | "makulerad";
  beslutadAvPartyId: string;
}): Promise<void> {
  const [alla, hushall] = await Promise.all([
    parter(args.householdId),
    hushallsnamn(args.householdId),
  ]);
  const beslutare = alla.find((p) => p.partyId === args.beslutadAvPartyId);
  const mottagare = alla.filter((p) => p.partyId !== args.beslutadAvPartyId);

  const ord: Record<typeof args.beslut, string> = {
    godkand: "godkänt",
    invand: "invänt mot",
    korrigerad: "korrigerat",
    makulerad: "begärt makulering av",
  };

  for (const till of mottagare) {
    await enqueue({
      idempotencyKey: `post-beslutad:${args.reference}:${args.version}:${args.beslut}:${till.userId}`,
      template: "post_beslutad",
      to: till.email,
      householdId: args.householdId,
      recipientUserId: till.userId,
      params: {
        motpart: beslutare?.name ?? "Motparten",
        beslut: ord[args.beslut],
        url: `${appUrl()}/transaktioner/historik`,
      },
    });
  }
}

/** En avtalsversion eller ett tillägg väntar på godkännande. */
export async function notifieraDokumentVantar(args: {
  householdId: string;
  slag: "avtalsversion" | "tillagg";
  entityId: string;
  skapadAvPartyId: string;
}): Promise<void> {
  const [alla, hushall] = await Promise.all([
    parter(args.householdId),
    hushallsnamn(args.householdId),
  ]);
  const mottagare = alla.filter((p) => p.partyId !== args.skapadAvPartyId);
  const skapare = alla.find((p) => p.partyId === args.skapadAvPartyId);

  for (const till of mottagare) {
    await enqueue({
      idempotencyKey: `dokument-vantar:${args.slag}:${args.entityId}:${till.userId}`,
      template: "dokument_vantar",
      to: till.email,
      householdId: args.householdId,
      recipientUserId: till.userId,
      params: {
        motpart: skapare?.name ?? "Motparten",
        dokument: args.slag === "tillagg" ? "Ett tilläggsavtal" : "En ny avtalsversion",
        url: `${appUrl()}/overenskommelse${args.slag === "tillagg" ? "/tillagg" : ""}`,
      },
    });
  }
}

/** Processdagen är registrerad. Går till båda: det rör dem lika mycket. */
export async function notifieraProcessdag(args: {
  householdId: string;
  processId: string;
  processDate: string;
  slag: string;
}): Promise<void> {
  const [alla, hushall] = await Promise.all([
    parter(args.householdId),
    hushallsnamn(args.householdId),
  ]);

  for (const till of alla) {
    await enqueue({
      idempotencyKey: `processdag:${args.processId}:${till.userId}`,
      template: "processdag",
      to: till.email,
      householdId: args.householdId,
      recipientUserId: till.userId,
      params: {
        rubrik: "Processdagen är registrerad",
        beskrivning: `${hushall}: processen är registrerad med ${args.processDate} som processdag (${args.slag}). Fristerna räknas från den dagen.`,
        url: `${appUrl()}/forsaljning`,
      },
    });
  }
}

/**
 * En frist närmar sig.
 *
 * Nyckeln bär fristens namn och förfallodag, inte dagens datum: samma frist
 * ska påminna en gång, inte varje dygn den ligger inom fönstret.
 */
export async function notifieraFrist(args: {
  householdId: string;
  processId: string;
  frist: string;
  forfaller: string;
}): Promise<void> {
  const [alla, hushall] = await Promise.all([
    parter(args.householdId),
    hushallsnamn(args.householdId),
  ]);

  for (const till of alla) {
    await enqueue({
      idempotencyKey: `frist:${args.processId}:${args.frist}:${args.forfaller}:${till.userId}`,
      template: "processdag",
      to: till.email,
      householdId: args.householdId,
      recipientUserId: till.userId,
      params: {
        rubrik: "En frist närmar sig",
        beskrivning: `${hushall}: ${args.frist} ska vara gjort senast ${args.forfaller}.`,
        url: `${appUrl()}/forsaljning`,
      },
    });
  }
}

/** Den som bjöd in får besked när motparten anslutit. */
export async function notifieraMotpartAccepterade(args: {
  householdId: string;
  inbjudarensUserId: string;
  motpartensNamn: string;
}): Promise<void> {
  const [rad] = await owner()<{ email: string; name: string }[]>`
    select u.email, u.name from users u
     where u.id = ${args.inbjudarensUserId} and u.disabled_at is null`;
  if (!rad) return;

  await enqueue({
    idempotencyKey: `motpart-accepterade:${args.householdId}:${args.inbjudarensUserId}`,
    template: "motpart_accepterade",
    to: rad.email,
    householdId: args.householdId,
    recipientUserId: args.inbjudarensUserId,
    params: {
      motpart: args.motpartensNamn,
      hushall: await hushallsnamn(args.householdId),
      url: `${appUrl()}/overenskommelse`,
    },
  });
}

/** Kontot stängs av eller öppnas igen. */
export async function notifieraKontostatus(args: {
  userId: string;
  avstangt: boolean;
}): Promise<void> {
  const [rad] = await owner()<{ email: string; name: string }[]>`
    select email, name from users where id = ${args.userId}`;
  if (!rad) return;

  // Nyckeln bär läget, så en avstängning och en senare återaktivering är två
  // händelser - men samma åtgärd två gånger bara en.
  await enqueue({
    idempotencyKey: `konto-status:${args.userId}:${args.avstangt ? "av" : "pa"}`,
    template: "konto_status",
    to: rad.email,
    recipientUserId: args.userId,
    params: {
      avstangt: args.avstangt ? "ja" : "nej",
      url: `${appUrl()}/auth`,
    },
  });
}
