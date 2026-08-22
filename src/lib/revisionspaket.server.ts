/**
 * Komplett revisionspaket.
 *
 * Allt som behövs för att en utomstående ska kunna gå igenom samägandet:
 * överenskommelsen, varje avtalsversion, tilläggsavtalen, transaktionerna,
 * förteckningen över underlag, aktivitetsloggen och slutavräkningen - plus
 * checksummor över varje del.
 *
 * Paketet byggs på servern i ett enda anrop. Hämtades delarna var för sig från
 * klienten kunde de komma från olika ögonblick, och ett revisionsunderlag där
 * transaktionslistan och loggen inte hör ihop är sämre än inget.
 *
 * Är hashkedjan bruten byggs inget paket alls. Ett underlag som ser komplett ut
 * men vilar på en bruten kedja är farligare än ett uteblivet.
 */

export type Paketfil = { namn: string; innehall: string; sha256: string };

export type Revisionspaket = {
  ok: true;
  skapad: string;
  filer: Paketfil[];
};

export type PaketFel = { ok: false; skal: string; brutenVidSekvens?: number };

/** Semikolon, decimalkomma och byte order mark - så att svenska Excel öppnar direkt. */
const BOM = "﻿";

function csv(rubriker: string[], rader: (string | number | null)[][]): string {
  const fält = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    BOM + [rubriker.join(";"), ...rader.map((r) => r.map(fält).join(";"))].join("\r\n") + "\r\n"
  );
}

function ore(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  return (Number(v) / 100).toFixed(2).replace(".", ",");
}

import { asUser } from "./db/client.server";

/**
 * Bygger paketet. Fri från förfrågan och svar, så att hela innehållet går att
 * pröva rakt av - inklusive att checksummorna stämmer med filerna.
 */
export async function byggRevisionspaket(
  userId: string,
  householdId: string,
): Promise<Revisionspaket | PaketFel> {
  const { createHash } = await import("node:crypto");
  const data = { householdId };

  return asUser(userId, async (sql) => {
    const [hushall] = await sql<{ name: string }[]>`
        select name from households where id = ${data.householdId}`;
    if (!hushall) return { ok: false as const, skal: "Hushållet finns inte." };

    // Kedjan först. Håller den inte byggs ingenting.
    const kedja = await sql<{ sequence: number; ok: boolean }[]>`
        select sequence, ok from verify_audit_chain(${data.householdId})`;
    const bruten = kedja.find((r) => !r.ok);
    if (bruten) {
      return {
        ok: false as const,
        skal:
          "Aktivitetsloggens kedja är bruten. Inget revisionspaket byggs, eftersom ett underlag " +
          "som ser komplett ut men vilar på en bruten kedja är farligare än ett uteblivet.",
        brutenVidSekvens: bruten.sequence,
      };
    }

    const parter = await sql<{ party_id: string; display_name: string }[]>`
        select party_id, display_name from household_members
         where household_id = ${data.householdId} order by party_id`;
    const namn = Object.fromEntries(parter.map((p) => [p.party_id, p.display_name]));

    const filer: { namn: string; innehall: string }[] = [];

    // --- Avtalsversioner -------------------------------------------------
    const versioner = await sql<
      {
        version: number;
        start_date: string;
        start_value_ore: string;
        initial_loan_ore: string;
        total_units: string;
        start_units: Record<string, number>;
        checksum: string;
        effective_at: Date | null;
        reason: string | null;
        created_by_name: string;
        godkant: string[];
      }[]
    >`
        select v.version, v.start_date, v.start_value_ore, v.initial_loan_ore, v.total_units,
               v.start_units, v.checksum, v.effective_at, v.reason, u.name as created_by_name,
               coalesce(array_agg(d.party_id) filter (where d.decision = 'approved'), '{}')
                 as godkant
          from agreement_versions v
          join agreements a on a.id = v.agreement_id
          join users u on u.id = v.created_by
          left join document_approvals d
                 on d.entity_type = 'agreement_version' and d.entity_id = v.id
         where a.household_id = ${data.householdId}
         group by v.id, u.name
         order by v.version
      `;

    filer.push({
      namn: "02-avtalsversioner.csv",
      innehall: csv(
        [
          "Version",
          "Startdag",
          "Startvärde (kr)",
          "Ursprungligt lån (kr)",
          "Totalt antal enheter",
          "Startenheter",
          "Skäl",
          "Skapad av",
          "Gäller från",
          "Godkänd av",
          "Checksumma",
        ],
        versioner.map((v) => [
          v.version,
          String(v.start_date).slice(0, 10),
          ore(v.start_value_ore),
          ore(v.initial_loan_ore),
          v.total_units,
          Object.entries(v.start_units ?? {})
            .map(([p, e]) => `${namn[p] ?? p}: ${e}`)
            .join(", "),
          v.reason,
          v.created_by_name,
          v.effective_at ? v.effective_at.toISOString() : "utkast",
          (v.godkant ?? [])
            .filter(Boolean)
            .map((p) => namn[p] ?? p)
            .join(", "),
          v.checksum,
        ]),
      ),
    });

    // --- Tilläggsavtal ---------------------------------------------------
    const tillagg = await sql<
      {
        title: string;
        signed_on: string;
        applies_from: string | null;
        summary: string | null;
        affected: string[];
        document_sha256: string | null;
        effective_at: Date | null;
        created_by_name: string;
        bekraftat: string[];
      }[]
    >`
        select t.title, t.signed_on, t.applies_from, t.summary, t.affected,
               t.document_sha256, t.effective_at, u.name as created_by_name,
               coalesce(array_agg(d.party_id) filter (where d.decision = 'approved'), '{}')
                 as bekraftat
          from agreement_addenda t
          join agreements a on a.id = t.agreement_id
          join users u on u.id = t.created_by
          left join document_approvals d
                 on d.entity_type = 'addendum' and d.entity_id = t.id
         where a.household_id = ${data.householdId}
         group by t.id, u.name
         order by t.signed_on
      `;

    filer.push({
      namn: "03-tillaggsavtal.csv",
      innehall: csv(
        [
          "Rubrik",
          "Undertecknat",
          "Gäller från",
          "Ändrar",
          "Berörda fält",
          "Registrerat av",
          "Gäller sedan",
          "Bekräftat av",
          "Handlingens kontrollsumma",
        ],
        tillagg.map((t) => [
          t.title,
          String(t.signed_on).slice(0, 10),
          t.applies_from ? String(t.applies_from).slice(0, 10) : "",
          t.summary,
          (t.affected ?? []).join(", "),
          t.created_by_name,
          t.effective_at ? t.effective_at.toISOString() : "ej i kraft",
          (t.bekraftat ?? [])
            .filter(Boolean)
            .map((p) => namn[p] ?? p)
            .join(", "),
          t.document_sha256,
        ]),
      ),
    });

    // --- Transaktioner ---------------------------------------------------
    const poster = await sql<
      {
        reference: string;
        version: number;
        status: string;
        payment_date: string;
        category: string;
        payments: Record<string, { gross?: number; deduction?: number }>;
        description: string | null;
        reason: string | null;
        corrects: string | null;
        voids: string | null;
        effective_at: Date | null;
        created_by_name: string;
        godkant: string[];
      }[]
    >`
        select t.reference, v.version, v.status, v.payment_date, v.category, v.payments,
               v.description, v.reason,
               kv.reference as corrects, mv.reference as voids,
               v.effective_at, u.name as created_by_name,
               coalesce(array_agg(ap.party_id) filter (where ap.decision = 'approved'), '{}')
                 as godkant
          from transaction_versions v
          join transactions t on t.id = v.transaction_id
          join users u on u.id = v.created_by
          left join transactions kv on kv.id = v.corrects_transaction_id
          left join transactions mv on mv.id = v.voids_transaction_id
          left join transaction_approvals ap on ap.transaction_version_id = v.id
         where t.household_id = ${data.householdId}
         group by t.reference, v.id, kv.reference, mv.reference, u.name
         order by t.reference, v.version
      `;

    filer.push({
      namn: "04-transaktioner.csv",
      innehall: csv(
        [
          "Post",
          "Version",
          "Status",
          "Betalningsdag",
          "Kostnadsslag",
          "Beskrivning",
          ...parter.map((p) => `${p.display_name} brutto (kr)`),
          "Korrigerar",
          "Makulerar",
          "Skäl",
          "Registrerad av",
          "Gäller från",
          "Godkänd av",
        ],
        poster.map((p) => [
          p.reference,
          p.version,
          p.status,
          String(p.payment_date).slice(0, 10),
          p.category,
          p.description,
          ...parter.map((part) => ore(p.payments?.[part.party_id]?.gross ?? 0)),
          p.corrects,
          p.voids,
          p.reason,
          p.created_by_name,
          p.effective_at ? p.effective_at.toISOString() : "",
          (p.godkant ?? [])
            .filter(Boolean)
            .map((x) => namn[x] ?? x)
            .join(", "),
        ]),
      ),
    });

    // --- Bilageförteckning ------------------------------------------------
    // Filerna själva följer inte med. De kan vara stora och innehålla mer än
    // vad ett revisionsunderlag behöver; kontrollsumman räcker för att visa
    // att en viss fil är den som låg till grund, och att den inte bytts ut.
    const bilagor = await sql<
      {
        filename: string;
        content_type: string;
        byte_size: string;
        sha256: string;
        uploaded_at: Date;
        uploaded_by_name: string;
        reference: string | null;
        redacted_at: Date | null;
      }[]
    >`
        select b.filename, b.content_type, b.byte_size, b.sha256, b.uploaded_at,
               u.name as uploaded_by_name, t.reference, b.redacted_at
          from attachments b
          join users u on u.id = b.uploaded_by
          left join transactions t on t.id = b.transaction_id
         where b.household_id = ${data.householdId}
         order by b.uploaded_at
      `;

    filer.push({
      namn: "05-bilagor.csv",
      innehall: csv(
        [
          "Filnamn",
          "Typ",
          "Storlek (byte)",
          "Kontrollsumma",
          "Hör till post",
          "Uppladdad av",
          "Uppladdad",
          "Borttagen",
        ],
        bilagor.map((b) => [
          b.filename,
          b.content_type,
          b.byte_size,
          b.sha256,
          b.reference,
          b.uploaded_by_name,
          b.uploaded_at.toISOString(),
          b.redacted_at ? b.redacted_at.toISOString() : "",
        ]),
      ),
    });

    // --- Aktivitetslogg ---------------------------------------------------
    const logg = await sql<
      {
        sequence: number;
        occurred_at: Date;
        event_type: string;
        entity_type: string;
        actor: string | null;
        previous_value: unknown;
        new_value: unknown;
        hash: string;
      }[]
    >`
        select e.sequence, e.occurred_at, e.event_type, e.entity_type,
               u.name as actor, e.previous_value, e.new_value, e.hash
          from audit_events e
          left join users u on u.id = e.actor_id
         where e.household_id = ${data.householdId}
         order by e.sequence
      `;

    filer.push({
      namn: "06-aktivitetslogg.csv",
      innehall: csv(
        ["Nr", "Tidpunkt", "Händelse", "Objekt", "Av", "Förevärde", "Eftervärde", "Hash"],
        logg.map((e) => [
          e.sequence,
          e.occurred_at.toISOString(),
          e.event_type,
          e.entity_type,
          e.actor,
          e.previous_value ? JSON.stringify(e.previous_value) : "",
          e.new_value ? JSON.stringify(e.new_value) : "",
          e.hash,
        ]),
      ),
    });

    // --- Slutavräkningar --------------------------------------------------
    const avrakningar = await sql<
      {
        end_date: string;
        basis: string;
        end_loan_ore: string;
        sale_costs_ore: string;
        engine_version: string;
        end_value_ore: string;
        checksum: string;
        locked_at: Date | null;
        frozen_result: unknown;
      }[]
    >`
        select end_date, basis, end_value_ore, end_loan_ore, sale_costs_ore,
               checksum, engine_version, locked_at, frozen_result
          from settlements where household_id = ${data.householdId}
         order by end_date
      `;

    if (avrakningar.length > 0) {
      filer.push({
        namn: "07-slutavrakningar.csv",
        innehall: csv(
          [
            "Avräkningsdag",
            "Grund",
            "Slutvärde (kr)",
            "Kvarvarande lån (kr)",
            "Försäljningskostnader (kr)",
            "Motorversion",
            "Låst",
            "Checksumma",
            "Resultat",
          ],
          avrakningar.map((s) => [
            String(s.end_date).slice(0, 10),
            s.basis,
            ore(s.end_value_ore),
            ore(s.end_loan_ore),
            ore(s.sale_costs_ore),
            s.engine_version,
            s.locked_at ? s.locked_at.toISOString() : "ej låst",
            s.checksum,
            s.frozen_result ? JSON.stringify(s.frozen_result) : "",
          ]),
        ),
      });
    }

    // --- Kvartalsavstämningar ---------------------------------------------
    const avstamningar = await sql<
      {
        period_start: string;
        period_end: string;
        completed_at: Date | null;
        bekraftat: string[];
      }[]
    >`
        select r.period_start, r.period_end, r.completed_at,
               coalesce(array_agg(c.party_id) filter (where c.party_id is not null), '{}')
                 as bekraftat
          from reconciliations r
          left join reconciliation_confirmations c on c.reconciliation_id = r.id
         where r.household_id = ${data.householdId}
         group by r.id
         order by r.period_start
      `;

    if (avstamningar.length > 0) {
      filer.push({
        namn: "08-kvartalsavstamningar.csv",
        innehall: csv(
          ["Periodens början", "Periodens slut", "Avslutad", "Bekräftad av"],
          avstamningar.map((r) => [
            String(r.period_start).slice(0, 10),
            String(r.period_end).slice(0, 10),
            r.completed_at ? r.completed_at.toISOString() : "pågår",
            (r.bekraftat ?? [])
              .filter(Boolean)
              .map((p) => namn[p] ?? p)
              .join(", "),
          ]),
        ),
      });
    }

    // --- Innehållsförteckning med checksummor -----------------------------
    const skapad = new Date().toISOString();
    const medSumma: Paketfil[] = filer.map((f) => ({
      ...f,
      sha256: createHash("sha256").update(f.innehall, "utf8").digest("hex"),
    }));

    const innehall = [
      `# Revisionsunderlag – ${hushall.name}`,
      "",
      `Skapat ${skapad}.`,
      "",
      "Underlaget är hämtat i ett enda ögonblick, så delarna hör ihop. Aktivitetsloggens",
      "hashkedja är kontrollerad och obruten; utan det hade inget paket byggts.",
      "",
      "## Innehåll",
      "",
      "| Fil | Rader | SHA-256 |",
      "| --- | ---: | --- |",
      ...medSumma.map((f) => {
        const rader = Math.max(0, f.innehall.trim().split("\n").length - 1);
        return `| ${f.namn} | ${rader} | \`${f.sha256}\` |`;
      }),
      "",
      "## Så kontrolleras paketet",
      "",
      "Räkna om SHA-256 för varje fil och jämför med tabellen ovan:",
      "",
      "```sh",
      "sha256sum *.csv",
      "```",
      "",
      "Aktivitetsloggens egen kedja kontrolleras i tjänsten under Systemadmin →",
      "Revisionsunderlag. Varje rad bär hashen av föregående rad, så en ändrad eller",
      "borttagen rad bryter kedjan och syns.",
      "",
      "## Vad som inte ingår",
      "",
      "Underlagen som bilder och PDF:er följer inte med. De kan vara stora och innehålla",
      "mer än vad ett revisionsunderlag behöver. Förteckningen i 05-bilagor.csv bär varje",
      "fils kontrollsumma, vilket räcker för att visa att en viss fil är den som låg till",
      "grund och att den inte bytts ut.",
      "",
      "Ett borttaget underlag syns i förteckningen med tidpunkt, men innehållet är borta.",
      "",
    ].join("\n");

    const innehallsfil: Paketfil = {
      namn: "00-INNEHALL.md",
      innehall,
      sha256: createHash("sha256").update(innehall, "utf8").digest("hex"),
    };

    return { ok: true as const, skapad, filer: [innehallsfil, ...medSumma] };
  });
}
