import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { asUser } from "./client.server";

/**
 * Bilagor ligger utanför webbroten och nås aldrig direkt. Varje läsning går
 * genom en serverrutt som först kontrollerar att den inloggade är medlem i
 * hushållet, så en gissad URL ger ingenting.
 */
const ROOT = process.env.UPLOADS_DIR ?? "/data/uploads";

/** Vad som får laddas upp. Underlag är kvitton och fakturor, inget annat. */
export const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const MAX_BYTES = 20 * 1024 * 1024;

export type StoredAttachment = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  uploadedAt: string;
  uploadedBy: string;
  redactedAt: string | null;
};

/**
 * Filnamnet på disk härleds aldrig ur det uppladdade namnet. Ett filnamn från
 * en användare kan innehålla sökvägar och skulle kunna peka utanför katalogen.
 */
function storagePath(id: string): string {
  return path.join(ROOT, `${id}.bin`);
}

/** Tar bort katalogdelar och styrtecken ur det filnamn som visas. */
export function safeName(name: string): string {
  const base = path.basename(name);
  const cleaned = Array.from(base)
    .filter((character) => character.codePointAt(0)! >= 0x20)
    .join("")
    .trim();
  return cleaned.slice(0, 200) || "underlag";
}

export async function storeAttachment(
  userId: string,
  householdId: string,
  transactionReference: string | null,
  file: { name: string; type: string; bytes: Buffer },
): Promise<{ id: string }> {
  if (!ALLOWED_TYPES[file.type]) {
    throw new Error("Filtypen stöds inte. Ladda upp bild eller PDF.");
  }
  if (file.bytes.byteLength === 0) throw new Error("Filen är tom.");
  if (file.bytes.byteLength > MAX_BYTES) {
    throw new Error(`Filen är för stor. Högst ${MAX_BYTES / 1024 / 1024} MB.`);
  }

  const sha256 = createHash("sha256").update(file.bytes).digest("hex");

  return asUser(userId, async (sql) => {
    const transactionId = transactionReference
      ? ((
          await sql<{ id: string }[]>`
            select id from transactions
            where household_id = ${householdId} and reference = ${transactionReference}
          `
        )[0]?.id ?? null)
      : null;

    const id = randomUUID();
    // Raden skrivs först: går skrivningen igenom radnivåsäkerheten är
    // uppladdningen tillåten, och först då hamnar filen på disk.
    await sql`
      insert into attachments (
        id, household_id, transaction_id, storage_key, filename, content_type,
        byte_size, sha256, uploaded_by
      ) values (
        ${id}, ${householdId}, ${transactionId}, ${id}, ${safeName(file.name)}, ${file.type},
        ${file.bytes.byteLength}, ${sha256}, ${userId}
      )
    `;

    await mkdir(ROOT, { recursive: true });
    await writeFile(storagePath(id), file.bytes, { mode: 0o600 });

    await sql`
      insert into audit_events
        (household_id, event_type, entity_type, entity_id, actor_id, new_value)
      values (${householdId}, 'attachment.uploaded', 'attachment', ${id}, ${userId},
              ${sql.json({ sha256, byteSize: file.bytes.byteLength } as never)})
    `;

    return { id };
  });
}

export async function readAttachment(
  userId: string,
  attachmentId: string,
): Promise<{ meta: StoredAttachment; bytes: Buffer } | null> {
  const meta = await asUser(userId, async (sql) => {
    const rows = await sql<
      {
        id: string;
        filename: string;
        content_type: string;
        byte_size: string;
        sha256: string;
        uploaded_at: Date;
        uploaded_by: string;
        redacted_at: Date | null;
      }[]
    >`
      select id, filename, content_type, byte_size, sha256, uploaded_at, uploaded_by, redacted_at
      from attachments where id = ${attachmentId}
    `;
    return rows[0] ?? null;
  });

  // Radnivåsäkerheten har redan avgjort åtkomsten: syns inte raden finns den
  // inte för den här användaren.
  if (!meta || meta.redacted_at) return null;

  try {
    const bytes = await readFile(storagePath(attachmentId));
    return {
      meta: {
        id: meta.id,
        filename: meta.filename,
        contentType: meta.content_type,
        byteSize: Number(meta.byte_size),
        sha256: meta.sha256,
        uploadedAt: meta.uploaded_at.toISOString(),
        uploadedBy: meta.uploaded_by,
        redactedAt: null,
      },
      bytes,
    };
  } catch {
    return null;
  }
}

export async function listAttachments(
  userId: string,
  householdId: string,
): Promise<(StoredAttachment & { transactionReference: string | null })[]> {
  return asUser(userId, async (sql) => {
    const rows = await sql<
      {
        id: string;
        filename: string;
        content_type: string;
        byte_size: string;
        sha256: string;
        uploaded_at: Date;
        uploaded_by: string;
        redacted_at: Date | null;
        reference: string | null;
      }[]
    >`
      select a.id, a.filename, a.content_type, a.byte_size, a.sha256, a.uploaded_at,
             a.uploaded_by, a.redacted_at, t.reference
      from attachments a
      left join transactions t on t.id = a.transaction_id
      where a.household_id = ${householdId}
      order by a.uploaded_at desc
    `;
    return rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      contentType: row.content_type,
      byteSize: Number(row.byte_size),
      sha256: row.sha256,
      uploadedAt: row.uploaded_at.toISOString(),
      uploadedBy: row.uploaded_by,
      redactedAt: row.redacted_at ? row.redacted_at.toISOString() : null,
      transactionReference: row.reference,
    }));
  });
}

/**
 * Maskerar en bilaga: filen tas bort, men raden blir kvar som gravsten med
 * hash, storlek, uppladdare och tidpunkt. Hashkedjan i aktivitetsloggen förblir
 * obruten, och det syns att något har tagits bort.
 */
export async function redactAttachment(
  userId: string,
  attachmentId: string,
  reason: string,
): Promise<void> {
  return asUser(userId, async (sql) => {
    const rows = await sql<{ household_id: string; sha256: string }[]>`
      update attachments
      set redacted_at = now(), redacted_by = ${userId}, redaction_reason = ${reason},
          storage_key = null
      where id = ${attachmentId} and redacted_at is null
      returning household_id, sha256
    `;
    const row = rows[0];
    if (!row) throw new Error("Bilagan finns inte eller är redan maskerad.");

    await sql`
      insert into audit_events
        (household_id, event_type, entity_type, entity_id, actor_id, previous_value, new_value)
      values (${row.household_id}, 'attachment.redacted', 'attachment', ${attachmentId}, ${userId},
              ${sql.json({ sha256: row.sha256 } as never)}, ${sql.json({ reason } as never)})
    `;

    await unlink(storagePath(attachmentId)).catch(() => {});
  });
}
