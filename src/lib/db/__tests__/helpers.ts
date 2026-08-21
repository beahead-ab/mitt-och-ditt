import postgres from "postgres";

/**
 * Testerna kör mot en riktig Postgres. Radnivåsäkerhet går inte att låtsas
 * bort – den måste bevisas i den databas som faktiskt kör i drift.
 *
 * Sätt TEST_DATABASE_URL för att peka på en annan server. Utan den används en
 * lokal instans över unix-socket.
 */
const url = process.env.TEST_DATABASE_URL;

const local = {
  host: process.env.TEST_PGHOST ?? "/tmp",
  port: Number(process.env.TEST_PGPORT ?? 5433),
  user: process.env.TEST_PGUSER ?? "postgres",
};

function connect(
  database: string,
  options: Partial<postgres.Options<Record<string, never>>>,
): postgres.Sql {
  const settings = { ...options, database, max: 4, onnotice: () => {} };
  return url ? postgres(url, settings) : postgres({ ...local, ...settings });
}

export function ownerSql(database: string): postgres.Sql {
  return connect(database, {});
}

export function appSql(database: string): postgres.Sql {
  return connect(database, { connection: { role: "mittochditt_app" } });
}

/** Kör som en viss användare, precis som applikationen gör. */
export async function asUser<T>(
  sql: postgres.Sql,
  userId: string | null,
  work: (tx: postgres.Sql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId ?? ""}, true)`;
    return work(tx as unknown as postgres.Sql);
  }) as Promise<T>;
}

/**
 * Går det att nå en databas? Utan en sådan hoppas integrationstesterna över
 * lokalt, men aldrig i CI: säkerhetstester som tyst försvinner är farligare än
 * inga alls.
 */
export async function databaseAvailable(): Promise<boolean> {
  const sql = connect("postgres", {});
  try {
    await sql`select 1`;
    return true;
  } catch {
    if (process.env.CI) {
      throw new Error(
        "Ingen databas nåbar. Integrationstesterna för radnivåsäkerhet måste köras i CI.",
      );
    }
    console.warn(
      "\n  Hoppar över integrationstesterna: ingen Postgres nåbar." +
        "\n  Starta en och sätt TEST_DATABASE_URL för att köra dem.\n",
    );
    return false;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

/** Sant om anropet avvisades av radnivåsäkerheten eller en spärr. */
export async function isRejected(work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work();
    return false;
  } catch {
    return true;
  }
}
