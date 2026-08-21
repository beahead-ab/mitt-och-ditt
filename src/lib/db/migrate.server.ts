import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { owner } from "./client.server";

/**
 * Migreringarna körs i filnamnsordning och varje fil körs exakt en gång.
 * Enkelt med flit: ett par användare behöver ingen migreringsmotor.
 */
export async function migrate(directory = "db/migrations"): Promise<string[]> {
  const sql = owner();
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const applied = new Set(
    (await sql<{ name: string }[]>`select name from schema_migrations`).map((row) => row.name),
  );

  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const ran: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const contents = await readFile(path.join(directory, file), "utf8");
    // Varje migrering körs i sin egen transaktion: antingen hela filen eller
    // ingenting, så en halvkörd migrering kan inte lämna schemat i otakt.
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    ran.push(file);
  }

  return ran;
}
