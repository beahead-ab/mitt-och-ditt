import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Mailstatus för driften.
 *
 * Administratören ser att ett mail gått fram eller fastnat, och kan be kön
 * försöka igen. Hen ser aldrig innehållet: det ligger i en egen tabell som
 * radnivåsäkerheten stänger helt för applikationsrollen, så gränsen hålls av
 * databasen och inte av den här filen.
 */

async function admin() {
  const { readSession } = await import("@/lib/auth/session.server");
  const user = await readSession();
  // En vägran är inte ett serverfel. Ett kastat Error blir 500 oavsett vad
  // setResponseStatus säger - ramverket behandlar det som en krasch. Ett kastat
  // Response går däremot rakt igenom, så klienten kan skilja "du får inte" från
  // "något gick sönder", och driftloggen fylls inte av falska serverfel.
  if (!user) {
    throw new Response("Ej inloggad.", { status: 401 });
  }
  if (!user.isAdmin) {
    throw new Response("Kräver administratörsbehörighet.", { status: 403 });
  }
  return user;
}

export type MailRad = {
  id: string;
  template: string;
  recipient: string;
  status: "pending" | "sending" | "sent" | "failed" | "cancelled";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
  nextAttemptAt: string | null;
};

export const listMail = createServerFn({ method: "GET" }).handler(async (): Promise<MailRad[]> => {
  const user = await admin();
  const { asUser } = await import("@/lib/db/client.server");

  return asUser(user.id, async (sql) => {
    const rows = await sql<
      {
        id: string;
        template: string;
        recipient_email: string;
        status: MailRad["status"];
        attempts: number;
        max_attempts: number;
        last_error: string | null;
        created_at: Date;
        sent_at: Date | null;
        next_attempt_at: Date | null;
      }[]
    >`
      select id, template, recipient_email, status, attempts, max_attempts,
             last_error, created_at, sent_at, next_attempt_at
        from mail_messages
       order by created_at desc
       limit 200
    `;

    return rows.map((r) => ({
      id: r.id,
      template: r.template,
      recipient: r.recipient_email,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      lastError: r.last_error,
      createdAt: r.created_at.toISOString(),
      sentAt: r.sent_at?.toISOString() ?? null,
      nextAttemptAt: r.next_attempt_at?.toISOString() ?? null,
    }));
  });
});

/**
 * Ber kön försöka igen. Går bara på ett mail som gett upp och som fortfarande
 * har sitt innehåll kvar; utan innehållet finns inget att bygga mailet av, och
 * då måste handlingen göras om i stället – till exempel genom en ny inbjudan.
 */
export const retryMail = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    await admin();
    const { retry } = await import("@/lib/mail/queue.server");

    switch (await retry(data.id)) {
      case "koat":
        return { ok: true, message: "Mailet är köat igen." };
      case "saknar_innehall":
        return {
          ok: false,
          message:
            "Innehållet är borttaget och går inte att bygga upp igen. Gör om handlingen, till exempel genom att skicka en ny inbjudan.",
        };
      default:
        return { ok: false, message: "Bara mail som gett upp kan köas igen." };
    }
  });
