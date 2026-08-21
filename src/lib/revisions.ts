/**
 * Versionshistorik.
 *
 * Ingenting skrivs över. Varje ändring skapar en ny version av hela posten, och
 * cellernas historik **härleds** ur skillnaden mellan versionerna. Det är
 * avsiktligt: en separat logg per cell skulle kunna hamna i otakt med det
 * faktiska värdet, och i ett bevisverktyg får det aldrig hända.
 *
 * Godkännandet hör till hela posten, inte till en enskild cell. Man kan inte
 * godkänna ett nytt belopp men inte det nya datumet, så versionen är den
 * minsta enhet parterna tar ställning till.
 */

export type Timestamp = string;

export type RecordVersion<T> = {
  version: number;
  /** Postens samtliga värden i den här versionen. */
  values: T;
  /** Vem som skapade versionen. */
  authorId: string;
  /** När versionen skapades, i UTC. */
  createdAt: Timestamp;
  /** Tidpunkt då respektive part godkände. null = har inte tagit ställning. */
  approvedBy: Record<string, Timestamp | null>;
  /** När versionen började gälla, alltså när båda hade godkänt. */
  effectiveAt: Timestamp | null;
  /** Skälet till ändringen. Krävs för korrigering och makulering. */
  reason?: string;
};

export type CellChange = {
  version: number;
  /** Värdet före ändringen. null när posten skapades. */
  from: string | null;
  to: string;
  authorId: string;
  changedAt: Timestamp;
  effectiveAt: Timestamp | null;
  reason?: string;
};

function byVersion<T>(versions: RecordVersion<T>[]): RecordVersion<T>[] {
  return [...versions].sort((a, b) => a.version - b.version);
}

/**
 * En cells historia: varje tillfälle då just det här värdet ändrades, med
 * värdet före och efter. Versioner som inte rörde cellen hoppas över, så
 * historiken visar bara ändringar som faktiskt gäller den.
 */
export function fieldHistory<T>(
  versions: RecordVersion<T>[],
  format: (values: T) => string,
): CellChange[] {
  const ordered = byVersion(versions);
  const changes: CellChange[] = [];
  let previous: string | null = null;

  for (const version of ordered) {
    const value = format(version.values);
    if (changes.length > 0 && value === previous) continue;
    changes.push({
      version: version.version,
      from: previous,
      to: value,
      authorId: version.authorId,
      changedAt: version.createdAt,
      effectiveAt: version.effectiveAt,
      reason: version.reason,
    });
    previous = value;
  }
  return changes;
}

/** Har cellen ändrats sedan posten registrerades? Styr hörnmarkören i rutnätet. */
export function hasChanged<T>(
  versions: RecordVersion<T>[],
  format: (values: T) => string,
): boolean {
  return fieldHistory(versions, format).length > 1;
}

/**
 * Postens läge vid en viss tidpunkt: den senaste version som hade börjat gälla
 * då. En version som ännu inte godkänts av båda har inte börjat gälla och
 * räknas därför inte, hur nyskriven den än är.
 */
export function versionAsOf<T>(
  versions: RecordVersion<T>[],
  at: Timestamp,
): RecordVersion<T> | null {
  const effective = byVersion(versions).filter(
    (version) => version.effectiveAt !== null && version.effectiveAt <= at,
  );
  return effective.length > 0 ? effective[effective.length - 1] : null;
}

/** Den senast gällande versionen. */
export function currentVersion<T>(versions: RecordVersion<T>[]): RecordVersion<T> | null {
  const effective = byVersion(versions).filter((version) => version.effectiveAt !== null);
  return effective.length > 0 ? effective[effective.length - 1] : null;
}

/**
 * Hela underlagets läge vid en viss tidpunkt. Poster som ännu inte hade börjat
 * gälla då utelämnas – de fanns inte i arket vid den tidpunkten.
 */
export function recordsAsOf<T>(revisions: Map<string, RecordVersion<T>[]>, at: Timestamp): T[] {
  const rows: T[] = [];
  for (const versions of revisions.values()) {
    const version = versionAsOf(versions, at);
    if (version) rows.push(version.values);
  }
  return rows;
}

export type TimelinePoint = {
  at: Timestamp;
  /** Antal poster som började gälla vid den här tidpunkten. */
  changes: number;
};

/**
 * Alla tidpunkter då underlaget ändrades, tidigast först. Används för att
 * bläddra bakåt genom hur arket har vuxit fram.
 */
export function timeline<T>(revisions: Map<string, RecordVersion<T>[]>): TimelinePoint[] {
  const counts = new Map<Timestamp, number>();
  for (const versions of revisions.values()) {
    for (const version of versions) {
      if (!version.effectiveAt) continue;
      counts.set(version.effectiveAt, (counts.get(version.effectiveAt) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([at, changes]) => ({ at, changes }))
    .sort((a, b) => a.at.localeCompare(b.at));
}
