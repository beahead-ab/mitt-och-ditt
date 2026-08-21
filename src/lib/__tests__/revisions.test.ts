import { describe, expect, it } from "vitest";

import {
  currentVersion,
  fieldHistory,
  hasChanged,
  recordsAsOf,
  timeline,
  versionAsOf,
  type RecordVersion,
} from "@/lib/revisions";

type Post = { id: string; belopp: number; text: string };

const version = (
  n: number,
  values: Post,
  createdAt: string,
  effectiveAt: string | null,
  extra: Partial<RecordVersion<Post>> = {},
): RecordVersion<Post> => ({
  version: n,
  values,
  authorId: "caesar",
  createdAt,
  approvedBy: { caesar: createdAt, felicia: effectiveAt },
  effectiveAt,
  ...extra,
});

const versions: RecordVersion<Post>[] = [
  version(
    1,
    { id: "T-1", belopp: 10_000, text: "Tvättmaskin" },
    "2025-06-23T09:00:00Z",
    "2025-06-24T07:30:00Z",
  ),
  version(
    2,
    { id: "T-1", belopp: 12_400, text: "Tvättmaskin" },
    "2025-07-02T11:15:00Z",
    "2025-07-03T18:05:00Z",
    {
      authorId: "felicia",
      reason: "Fakturan visade rätt belopp",
    },
  ),
  version(
    3,
    { id: "T-1", belopp: 12_400, text: "Tvättmaskin som lämnas kvar" },
    "2025-08-01T08:00:00Z",
    "2025-08-01T20:00:00Z",
    {
      reason: "Förtydligad beskrivning",
    },
  ),
];

describe("Cellhistorik", () => {
  it("visar från- och tillvärde för varje ändring", () => {
    const history = fieldHistory(versions, (post) => String(post.belopp));
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ from: null, to: "10000", version: 1 });
    expect(history[1]).toMatchObject({
      from: "10000",
      to: "12400",
      version: 2,
      authorId: "felicia",
      reason: "Fakturan visade rätt belopp",
    });
  });

  it("hoppar över versioner som inte rörde cellen", () => {
    // Version 3 ändrade bara texten, alltså syns den inte i beloppets historia.
    const belopp = fieldHistory(versions, (post) => String(post.belopp));
    expect(belopp.map((c) => c.version)).toEqual([1, 2]);
    const text = fieldHistory(versions, (post) => post.text);
    expect(text.map((c) => c.version)).toEqual([1, 3]);
  });

  it("räknar en oförändrad cell som oändrad", () => {
    expect(hasChanged(versions, (post) => post.id)).toBe(false);
    expect(hasChanged(versions, (post) => String(post.belopp))).toBe(true);
  });

  it("bär med sig när ändringen började gälla, inte bara när den skrevs", () => {
    const history = fieldHistory(versions, (post) => String(post.belopp));
    expect(history[1].changedAt).toBe("2025-07-02T11:15:00Z");
    expect(history[1].effectiveAt).toBe("2025-07-03T18:05:00Z");
  });

  it("klarar versioner i fel ordning", () => {
    const shuffled = [versions[2], versions[0], versions[1]];
    expect(fieldHistory(shuffled, (post) => String(post.belopp))).toEqual(
      fieldHistory(versions, (post) => String(post.belopp)),
    );
  });
});

describe("Läget vid en tidpunkt", () => {
  it("ger den version som gällde då", () => {
    expect(versionAsOf(versions, "2025-06-30T00:00:00Z")?.values.belopp).toBe(10_000);
    expect(versionAsOf(versions, "2025-07-10T00:00:00Z")?.values.belopp).toBe(12_400);
    expect(versionAsOf(versions, "2025-09-01T00:00:00Z")?.values.text).toBe(
      "Tvättmaskin som lämnas kvar",
    );
  });

  it("ger ingenting före första godkännandet", () => {
    expect(versionAsOf(versions, "2025-06-23T12:00:00Z")).toBeNull();
  });

  it("räknar inte en version som bara en part godkänt", () => {
    const pending = [
      versions[0],
      version(2, { id: "T-1", belopp: 99_000, text: "Fel" }, "2025-07-02T11:15:00Z", null),
    ];
    expect(versionAsOf(pending, "2025-12-31T00:00:00Z")?.values.belopp).toBe(10_000);
    expect(currentVersion(pending)?.version).toBe(1);
  });
});

describe("Hela underlaget över tid", () => {
  const andra: RecordVersion<Post>[] = [
    version(
      1,
      { id: "T-2", belopp: 4_850, text: "BRF-avgift" },
      "2025-09-30T09:00:00Z",
      "2025-10-01T09:00:00Z",
    ),
  ];
  const revisions = new Map([
    ["T-1", versions],
    ["T-2", andra],
  ]);

  it("visar bara poster som fanns vid tidpunkten", () => {
    expect(recordsAsOf(revisions, "2025-07-01T00:00:00Z").map((p) => p.id)).toEqual(["T-1"]);
    const later = recordsAsOf(revisions, "2025-10-02T00:00:00Z")
      .map((p) => p.id)
      .sort();
    expect(later).toEqual(["T-1", "T-2"]);
  });

  it("listar tidpunkterna då underlaget ändrades", () => {
    const points = timeline(revisions);
    expect(points.map((p) => p.at)).toEqual([
      "2025-06-24T07:30:00Z",
      "2025-07-03T18:05:00Z",
      "2025-08-01T20:00:00Z",
      "2025-10-01T09:00:00Z",
    ]);
    expect(points.every((p) => p.changes === 1)).toBe(true);
  });

  it("slår ihop ändringar som började gälla samtidigt", () => {
    const samtidigt = new Map([
      [
        "A",
        [
          version(
            1,
            { id: "A", belopp: 1, text: "a" },
            "2025-01-01T00:00:00Z",
            "2025-01-02T00:00:00Z",
          ),
        ],
      ],
      [
        "B",
        [
          version(
            1,
            { id: "B", belopp: 2, text: "b" },
            "2025-01-01T00:00:00Z",
            "2025-01-02T00:00:00Z",
          ),
        ],
      ],
    ]);
    expect(timeline(samtidigt)).toEqual([{ at: "2025-01-02T00:00:00Z", changes: 2 }]);
  });
});
