import { cancelByKeyPrefix, enqueue } from "./queue.server";

/**
 * Mailen kring inbjudningar och nya konton.
 *
 * Ligger samlat här så att alla vägar som skapar en inbjudan - administratören,
 * Caesar eller Felicia - köar samma mail på samma sätt, och så att nyckeln till
 * kön sätts på ett enda ställe.
 */

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function datum(d: Date): string {
  return d.toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Stockholm",
  });
}

/** Prefixet gör att alla mail för en viss inbjudan går att avbryta på en gång. */
function nyckelprefix(inviteId: string): string {
  return `invite:${inviteId}:`;
}

export type Inbjudningsmail = {
  inviteId: string;
  email: string;
  namn: string;
  hushall: string;
  token: string;
  giltigTill: Date;
  householdId: string;
  /** Sant när den ersätter en återkallad eller utgången inbjudan. */
  ersatter?: boolean;
};

export async function köaInbjudan(args: Inbjudningsmail): Promise<void> {
  await enqueue({
    // Ett mail per inbjudan. Att skapa inbjudan två gånger ger två rader med
    // olika id, alltså två mail; att köa samma inbjudan igen gör det inte.
    idempotencyKey: `${nyckelprefix(args.inviteId)}1`,
    template: args.ersatter ? "inbjudan_ny" : "inbjudan",
    to: args.email,
    householdId: args.householdId,
    params: {
      namn: args.namn,
      hushall: args.hushall,
      url: `${appUrl()}/inbjudan/${args.token}`,
      giltigTill: datum(args.giltigTill),
    },
  });
}

/**
 * Stoppar mailet när en inbjudan återkallas.
 *
 * Har det redan gått fram går det inte att ta tillbaka - men själva länken
 * slutar gälla i samma stund, så mailet blir verkningslöst.
 */
export async function avbrytInbjudningsmail(inviteId: string): Promise<number> {
  return cancelByKeyPrefix(nyckelprefix(inviteId));
}

/** Besked till den som bjöd in att motparten nu har anslutit sig. */
export async function köaMotpartAnslöt(args: {
  inviteId: string;
  till: string;
  motpart: string;
  hushall: string;
  householdId: string;
  recipientUserId?: string | null;
}): Promise<void> {
  await enqueue({
    idempotencyKey: `${nyckelprefix(args.inviteId)}accepterad`,
    template: "motpart_accepterade",
    to: args.till,
    householdId: args.householdId,
    recipientUserId: args.recipientUserId ?? null,
    params: { motpart: args.motpart, hushall: args.hushall, url: appUrl() },
  });
}

/**
 * Aktivering av ett konto som administratören skapat.
 *
 * Kontot skapas utan lösenord och personen väljer det själv genom länken.
 * Administratören ska aldrig kunna välja någon annans lösenord - varken för att
 * hen kunde logga in som den personen, eller för att ett lösenord som någon
 * annan känner till inte längre är ett bevis på vem som gjort vad.
 */
export async function köaAktivering(args: {
  resetId: string;
  email: string;
  token: string;
  recipientUserId: string;
}): Promise<void> {
  await enqueue({
    idempotencyKey: `aktivering:${args.resetId}`,
    template: "losenord_aterstall",
    to: args.email,
    recipientUserId: args.recipientUserId,
    params: { url: `${appUrl()}/aterstall/${args.token}` },
  });
}
