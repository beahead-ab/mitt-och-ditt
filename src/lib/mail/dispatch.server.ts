import { claimDue, markFailed, markSent } from "./queue.server";
import { render } from "./templates";
import { PermanentMailError, safeMessage, type MailTransport } from "./transport";

/**
 * Avsändaren. Tömmer utkorgen, ett svep i taget.
 *
 * Den skiljer på fel som kan bli bättre och fel som inte kan det. En mailserver
 * som är nere ska försökas igen; en adress som inte finns ska ge upp direkt i
 * stället för att köa i timmar.
 */
export type Svep = { skickade: number; misslyckade: number; kvar: number };

export async function dispatchOnce(transport: MailTransport, antal = 10): Promise<Svep> {
  const koade = await claimDue(antal);
  let skickade = 0;
  let misslyckade = 0;

  for (const mail of koade) {
    try {
      const { subject, text, html } = render(mail.template, mail.params);
      await transport.send({ to: mail.recipientEmail, subject, text, html });
      await markSent(mail.id);
      skickade += 1;
    } catch (error) {
      // En mall som inte går att bygga blir inte bättre av att försökas igen.
      const permanent =
        error instanceof PermanentMailError ||
        (error instanceof Error && error.message.startsWith("Mailmallen saknar"));
      await markFailed(mail.id, safeMessage(error), permanent);
      misslyckade += 1;
    }
  }

  return { skickade, misslyckade, kvar: koade.length - skickade - misslyckade };
}
