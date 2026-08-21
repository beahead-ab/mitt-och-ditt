import postgres from "postgres";

/**
 * Databasanslutningen. Applikationen använder rollen `mittochditt_app`, som
 * lyder under radnivåsäkerheten. Ägarrollen används bara av migreringar och
 * av de få funktioner som måste kringgå RLS, till exempel inloggning.
 */
let appSql: postgres.Sql | undefined;
let ownerSql: postgres.Sql | undefined;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL saknas. Se .env.example.");
  return url;
}

/** Ägaranslutning. Kringgår RLS – används bara där det är oundvikligt. */
export function owner(): postgres.Sql {
  if (!ownerSql) {
    ownerSql = postgres(connectionString(), { max: 4, onnotice: () => {} });
  }
  return ownerSql;
}

/** Applikationsanslutning. Allt som går genom den lyder under RLS. */
export function app(): postgres.Sql {
  if (!appSql) {
    appSql = postgres(connectionString(), {
      max: 10,
      onnotice: () => {},
      connection: { role: "mittochditt_app" },
    });
  }
  return appSql;
}

/**
 * Kör arbetet som en viss användare. `set_local` gäller bara inuti
 * transaktionen, så identiteten kan aldrig läcka mellan två förfrågningar som
 * råkar återanvända samma anslutning ur poolen.
 *
 * Utan userId ser rollen ingenting – ett glömt anrop ger tomt resultat i
 * stället för någon annans uppgifter.
 */
export async function asUser<T>(
  userId: string | null,
  work: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  return app().begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId ?? ""}, true)`;
    return work(tx as unknown as postgres.Sql);
  }) as Promise<T>;
}

export async function closeConnections(): Promise<void> {
  await Promise.all([appSql?.end(), ownerSql?.end()]);
  appSql = undefined;
  ownerSql = undefined;
}
