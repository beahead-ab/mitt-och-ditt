import { owner } from "../db/client.server";
import { decryptParams, encryptParams } from "./crypto";

/**
 * Utkorgen.
 *
 * Allt går genom ägarrollen. Att köa sker aldrig i en inloggad användares namn:
 * annars hade en part kunnat lägga ett mail med valfri mall till valfri adress.
 * Raden skapas efter att användarens handling gått igenom, så ett mail bara går
 * ut för något som faktiskt blev av.
 */

export type MailStatus = "pending" | "sending" | "sent" | "failed" | "cancelled";

export type KoatMail = {
  id: string;
  template: string;
  recipientEmail: string;
  params: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

/** Väntetid före nästa försök. Växer, och slutar växa efter ett halvt dygn. */
const VANTETID_MINUTER = [1, 5, 15, 60, 240, 720];

export function vantetidMinuter(forsok: number): number {
  return VANTETID_MINUTER[Math.min(forsok, VANTETID_MINUTER.length - 1)];
}

/** Hur länge ett påbörjat skick får hänga innan någon annan får ta över. */
const HANGANDE_MINUTER = 10;

/** Hur länge innehållet ligger kvar om mailet varken går fram eller ger upp. */
const INNEHALL_DAGAR = 7;

export type EnqueueArgs = {
  /**
   * Unik per händelse och mottagare. Två samtidiga anrop, eller en omstart mitt
   * i ett flöde, ska inte kunna lägga samma mail två gånger.
   */
  idempotencyKey: string;
  template: string;
  to: string;
  params: Record<string, unknown>;
  householdId?: string | null;
  recipientUserId?: string | null;
};

/**
 * Lägger mailet i kön. Returnerar id, eller null om nyckeln redan fanns –
 * alltså att mailet redan är köat eller skickat.
 */
export async function enqueue(args: EnqueueArgs): Promise<string | null> {
  const sql = owner();
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      insert into mail_messages
        (idempotency_key, template, recipient_email, household_id, recipient_user_id)
      values (${args.idempotencyKey}, ${args.template}, ${args.to},
              ${args.householdId ?? null}, ${args.recipientUserId ?? null})
      on conflict (idempotency_key) do nothing
      returning id
    `;
    const id = rows[0]?.id;
    if (!id) return null;

    await tx`
      insert into mail_payloads (message_id, params_encrypted, purge_after)
      values (${id}, ${encryptParams(args.params)},
              now() + ${`${INNEHALL_DAGAR} days`}::interval)
    `;
    return id;
  }) as Promise<string | null>;
}

/**
 * Tar upp till `antal` mogna mail och markerar dem som pågående.
 *
 * `for update skip locked` gör att två avsändare som råkar köra samtidigt tar
 * olika rader i stället för att krocka om samma. Ett skick som avbrutits mitt i
 * - servern startade om - blir moget igen efter en stund och tas då av nästa.
 */
export async function claimDue(antal = 10): Promise<KoatMail[]> {
  const sql = owner();
  const rader = await sql<
    {
      id: string;
      template: string;
      recipient_email: string;
      attempts: number;
      max_attempts: number;
      params_encrypted: string;
    }[]
  >`
    with mogna as (
      select id from mail_messages
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'sending' and next_attempt_at <= now())
      order by next_attempt_at
      limit ${antal}
      for update skip locked
    )
    update mail_messages m
       set status = 'sending',
           next_attempt_at = now() + ${`${HANGANDE_MINUTER} minutes`}::interval
      from mogna
     where m.id = mogna.id
     returning m.id, m.template, m.recipient_email, m.attempts, m.max_attempts,
               (select params_encrypted from mail_payloads p where p.message_id = m.id)
  `;

  return rader
    .filter((r) => r.params_encrypted)
    .map((r) => ({
      id: r.id,
      template: r.template,
      recipientEmail: r.recipient_email,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      params: decryptParams(r.params_encrypted),
    }));
}

/** Levererat. Innehållet tas bort direkt – token ska inte ligga kvar. */
export async function markSent(id: string): Promise<void> {
  const sql = owner();
  await sql.begin(async (tx) => {
    await tx`update mail_messages set status = 'sent', sent_at = now(), last_error = null where id = ${id}`;
    await tx`delete from mail_payloads where message_id = ${id}`;
  });
}

/**
 * Misslyckat. Räknar upp försöket och lägger raden framåt i tiden, eller ger
 * upp när taket är nått eller felet ändå inte blir bättre av att upprepas.
 */
export async function markFailed(id: string, felkod: string, permanent = false): Promise<void> {
  const sql = owner();
  await sql.begin(async (tx) => {
    const rader = await tx<{ attempts: number; max_attempts: number }[]>`
      update mail_messages set attempts = attempts + 1 where id = ${id}
      returning attempts, max_attempts
    `;
    const rad = rader[0];
    if (!rad) return;

    const slut = permanent || rad.attempts >= rad.max_attempts;
    if (slut) {
      await tx`
        update mail_messages
           set status = 'failed', failed_at = now(), last_error = ${felkod}
         where id = ${id}
      `;
      await tx`delete from mail_payloads where message_id = ${id}`;
      return;
    }

    await tx`
      update mail_messages
         set status = 'pending',
             last_error = ${felkod},
             next_attempt_at = now() + ${`${vantetidMinuter(rad.attempts)} minutes`}::interval
       where id = ${id}
    `;
  });
}

/**
 * Administratörens försök igen. Bara ett mail som gett upp får startas om, och
 * bara om innehållet finns kvar – utan det går mailet inte att bygga.
 */
export async function retry(id: string): Promise<"koat" | "saknar_innehall" | "fel_status"> {
  const sql = owner();
  return sql.begin(async (tx) => {
    const rader = await tx<{ status: MailStatus }[]>`
      select status from mail_messages where id = ${id} for update
    `;
    const status = rader[0]?.status;
    if (status !== "failed") return "fel_status" as const;

    const innehall = await tx<{ message_id: string }[]>`
      select message_id from mail_payloads where message_id = ${id}
    `;
    if (innehall.length === 0) return "saknar_innehall" as const;

    await tx`
      update mail_messages
         set status = 'pending', attempts = 0, next_attempt_at = now(),
             failed_at = null, last_error = null
       where id = ${id}
    `;
    return "koat" as const;
  }) as Promise<"koat" | "saknar_innehall" | "fel_status">;
}

/** Avbryter ett mail som ännu inte gått. Används när en inbjudan återkallas. */
export async function cancelByKeyPrefix(prefix: string): Promise<number> {
  const sql = owner();
  const rader = await sql<{ id: string }[]>`
    update mail_messages
       set status = 'cancelled', cancelled_at = now()
     where status in ('pending', 'sending') and idempotency_key like ${prefix + "%"}
     returning id
  `;
  if (rader.length > 0) {
    await sql`delete from mail_payloads where message_id in ${sql(rader.map((r) => r.id))}`;
  }
  return rader.length;
}

/** Städar innehåll som blivit kvar för länge, oavsett hur det gick. */
export async function purgeExpiredPayloads(): Promise<number> {
  const sql = owner();
  const rader = await sql<{ message_id: string }[]>`
    delete from mail_payloads where purge_after <= now() returning message_id
  `;
  return rader.length;
}
