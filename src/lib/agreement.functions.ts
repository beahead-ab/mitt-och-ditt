import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { AVTALSFALT, granskaTillagg, nyaAvtalsvarden } from "@/lib/tillaggsavtal";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ange datum som ÅÅÅÅ-MM-DD.");
const wholeKronor = z.number().int().min(0).max(100_000_000_000);

/** Avtalsversioner som väntar på parternas godkännande. */
export const pendingAgreement = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const user = await readSession();
    if (!user) return null;

    return asUser(user.id, async (sql) => {
      const rows = await sql<
        {
          id: string;
          version: number;
          start_date: string;
          start_value_ore: string;
          initial_loan_ore: string;
          total_units: string;
          start_units: Record<string, number>;
          formal_ownership: Record<string, number> | null;
          checksum: string | null;
          reason: string | null;
        }[]
      >`
        select v.id, v.version, v.start_date, v.start_value_ore, v.initial_loan_ore,
               v.total_units, v.start_units, v.formal_ownership, v.checksum, v.reason
        from agreement_versions v
        where v.agreement_id = current_agreement_id(${data.householdId})
          and v.effective_at is null
        order by v.version desc limit 1
      `;
      const version = rows[0];
      if (!version) return null;

      const approvals = await sql<{ party_id: string }[]>`
        select party_id from document_approvals
        where entity_type = 'agreement_version' and entity_id = ${version.id}
          and decision = 'approved'
      `;
      const me = await sql<{ party_id: string }[]>`
        select party_id from household_members
        where household_id = ${data.householdId} and user_id = ${user.id}
      `;

      return {
        id: version.id,
        version: version.version,
        startDate:
          typeof version.start_date === "string"
            ? version.start_date.slice(0, 10)
            : new Date(version.start_date).toISOString().slice(0, 10),
        startValue: Number(version.start_value_ore),
        initialLoan: Number(version.initial_loan_ore),
        totalUnits: Number(version.total_units),
        startUnits: version.start_units,
        formalOwnership: version.formal_ownership,
        checksum: version.checksum,
        reason: version.reason,
        approvedBy: approvals.map((a) => a.party_id),
        myPartyId: me[0]?.party_id ?? null,
      };
    });
  });

const initialAgreementInput = z
  .object({
    householdId: z.string().uuid(),
    address: z.string().trim().min(1).max(200),
    association: z.string().trim().max(200).optional(),
    apartmentNumber: z.string().trim().max(40).optional(),
    startDate: isoDate,
    startValueKr: wholeKronor,
    initialLoanKr: wholeKronor,
    // Nycklade på hushållets partsroller. Att rollerna verkligen är hushållets
    // går inte att avgöra här - det kräver databasen - så det kontrolleras i
    // hanteraren, innan något skrivs.
    capitalKrByParty: z.record(z.string(), wholeKronor),
    formalPercentByParty: z.record(z.string(), z.number().min(0).max(100)),
  })
  .superRefine((data, context) => {
    const netEquity = data.startValueKr - data.initialLoanKr;
    if (netEquity <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["initialLoanKr"],
        message: "Startvärdet måste vara större än bolånet.",
      });
    }
    const kapital = Object.values(data.capitalKrByParty);
    const andelar = Object.values(data.formalPercentByParty);
    if (kapital.reduce((a, b) => a + b, 0) !== netEquity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capitalKrByParty"],
        message: "Kapitalinsatserna måste tillsammans motsvara startvärdet minus bolånet.",
      });
    }
    if (Math.abs(andelar.reduce((a, b) => a + b, 0) - 100) > 0.000001) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formalPercentByParty"],
        message: "De formella ägarandelarna måste tillsammans vara 100 procent.",
      });
    }
  });

/**
 * Endera parten skapar den första avtalsversionen efter att båda har
 * anslutit. En ny inskickning ersätter aldrig ett äldre utkast i databasen –
 * den blir en ny version och kräver två helt nya godkännanden.
 */
export const createInitialAgreementDraft = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => initialAgreementInput.parse(input))
  .handler(async ({ data }) => {
    const { createHash } = await import("node:crypto");
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const { kr } = await import("@/lib/engine");
    const user = await readSession();
    if (!user) throw new Error("Ej inloggad.");

    return asUser(user.id, async (sql) => {
      const members = await sql<{ party_id: string; display_name: string }[]>`
        select party_id, display_name from household_members
        where household_id = ${data.householdId}
        order by party_id
      `;
      const roles = members.map((member) => member.party_id);
      if (members.length !== 2) {
        throw new Error("Båda parter måste ha anslutit innan startuppgifterna sparas.");
      }
      // De uppgivna rollerna måste vara precis hushållets. Annars skulle en
      // påhittad nyckel hamna i start_units, och motorn räknar på nycklarna -
      // inte på namnen. En felstavad roll blir en part utan enheter.
      const uppgivna = [
        Object.keys(data.capitalKrByParty).sort(),
        Object.keys(data.formalPercentByParty).sort(),
      ];
      if (uppgivna.some((nycklar) => nycklar.join("\u0000") !== roles.join("\u0000"))) {
        throw new Error("Uppgifterna gäller andra partsroller än hushållets.");
      }

      const [agreement] = await sql<{ id: string }[]>`
        select id from agreements where id = current_agreement_id(${data.householdId})
      `;
      if (!agreement)
        throw new Error("Hushållets avtalsbehållare saknas. Kontakta administratören.");

      const [effective] = await sql<{ id: string }[]>`
        select v.id from agreement_versions v
        where v.agreement_id = ${agreement.id} and v.effective_at is not null
        limit 1
      `;
      if (effective) {
        throw new Error("Startuppgifterna är redan godkända. En ändring kräver tilläggsavtal.");
      }

      const [latest] = await sql<{ version: number }[]>`
        select version from agreement_versions
        where agreement_id = ${agreement.id}
        order by version desc limit 1
      `;
      const version = (latest?.version ?? 0) + 1;
      // Byggda ur `roles`, som är sorterad. Nyckelordningen går in i
      // checksumman nedan, så den får inte bero på i vilken ordning klienten
      // råkade skicka fälten.
      const startUnits = Object.fromEntries(
        roles.map((role) => [role, data.capitalKrByParty[role]]),
      );
      const formalOwnership = Object.fromEntries(
        roles.map((role) => [role, data.formalPercentByParty[role] / 100]),
      );
      // Modellversionen ingår i checksumman: den är en del av vad parterna
      // godkänner. Ett avtal som senare påstås förutsätta en annan modell ska
      // inte kunna göra det utan att summan slutar stämma.
      const { DEFAULT_MODEL_VERSION } = await import("@/lib/engine/engine");
      const modelVersion = DEFAULT_MODEL_VERSION;

      const canonical = JSON.stringify({
        version,
        modelVersion,
        address: data.address,
        association: data.association || null,
        apartmentNumber: data.apartmentNumber || null,
        startDate: data.startDate,
        startValueKr: data.startValueKr,
        initialLoanKr: data.initialLoanKr,
        startUnits,
        formalOwnership,
      });
      const checksum = createHash("sha256").update(canonical).digest("hex");
      const documentMd = [
        `# Startuppgifter · version ${version}`,
        "",
        `Bostad: ${data.address}`,
        `Startdag: ${data.startDate}`,
        `Startvärde: ${data.startValueKr} kr`,
        `Bolån: ${data.initialLoanKr} kr`,
        ...members.map(
          (member) => `Kapitalinsats ${member.display_name}: ${startUnits[member.party_id]} kr`,
        ),
        ...members.map(
          (member) =>
            `Formell ägarandel ${member.display_name}: ${data.formalPercentByParty[member.party_id]} %`,
        ),
      ].join("\n");

      const [property] = await sql<{ id: string }[]>`
        select id from properties where household_id = ${data.householdId}
      `;
      if (property) {
        await sql`
          update properties
          set address = ${data.address}, association = ${data.association || null},
              apartment_number = ${data.apartmentNumber || null}
          where id = ${property.id}
        `;
      } else {
        await sql`
          insert into properties (household_id, address, association, apartment_number)
          values (${data.householdId}, ${data.address}, ${data.association || null},
                  ${data.apartmentNumber || null})
        `;
      }

      const [draft] = await sql<{ id: string }[]>`
        insert into agreement_versions (
          agreement_id, version, start_date, start_value_ore, initial_loan_ore,
          total_units, start_units, formal_ownership, model_version, document_md, checksum,
          created_by, reason
        ) values (
          ${agreement.id}, ${version}, ${data.startDate}, ${kr(data.startValueKr)},
          ${kr(data.initialLoanKr)}, ${Object.values(startUnits).reduce((a, b) => a + b, 0)},
          ${sql.json(startUnits)}, ${sql.json(formalOwnership)}, ${modelVersion}, ${documentMd},
          ${checksum},
          ${user.id}, ${version === 1 ? "Startuppgifter registrerade av parterna" : "Korrigerat utkast före start"}
        ) returning id
      `;
      await sql`
        insert into audit_events
          (household_id, event_type, entity_type, entity_id, actor_id, new_value)
        values (
          ${data.householdId}, 'agreement_version.created', 'agreement_version', ${draft.id},
          ${user.id}, ${sql.json({ version, checksum } as never)}
        )
      `;

      // Beskedet får aldrig fälla registreringen; utkastet är redan skrivet.
      try {
        const { notifieraDokumentVantar } = await import("@/lib/mail/handelser.server");
        // Beskedet ska gå till den andra parten, så min egen roll måste slås
        // upp - inte gissas till den första i listan.
        const [minRoll] = await sql<{ party_id: string }[]>`
          select party_id from household_members
           where household_id = ${data.householdId} and user_id = ${user.id}`;
        await notifieraDokumentVantar({
          householdId: data.householdId,
          slag: "avtalsversion",
          entityId: draft.id,
          skapadAvPartyId: minRoll?.party_id ?? roles[0],
        });
      } catch {
        // Utkorgen är inte en del av transaktionen.
      }

      return { id: draft.id, version, checksum };
    });
  });

/* ------------------------------------------------------- Avtalsversioner */

export type Avtalsversion = {
  id: string;
  version: number;
  status: "utkast" | "gällande" | "ersatt";
  startDate: string;
  startValueOre: string;
  initialLoanOre: string;
  totalUnits: string;
  startUnits: Record<string, number>;
  formalOwnership: Record<string, number> | null;
  checksum: string | null;
  reason: string | null;
  documentMd: string | null;
  createdBy: string;
  createdAt: string;
  effectiveAt: string | null;
  addendumId: string | null;
  /** Partsroller som godkänt, och de som invänt. */
  approvedBy: string[];
  objectedBy: string[];
  /** Vad som skiljer mot närmast föregående version. */
  changes: { field: string; before: string; after: string }[];
};

/** Läsbara namn på de fält som kan skilja mellan två versioner. */
const FALTNAMN: Record<string, string> = {
  startDate: "Startdag",
  startValueOre: "Startvärde",
  initialLoanOre: "Ursprungligt lån",
  totalUnits: "Totalt antal enheter",
  startUnits: "Startenheter",
  formalOwnership: "Formell ägarandel",
};

function jamforVersioner(
  fore: Record<string, unknown> | null,
  efter: Record<string, unknown>,
): { field: string; before: string; after: string }[] {
  if (!fore) return [];
  const ut: { field: string; before: string; after: string }[] = [];
  for (const [nyckel, namn] of Object.entries(FALTNAMN)) {
    const a = JSON.stringify(fore[nyckel] ?? null);
    const b = JSON.stringify(efter[nyckel] ?? null);
    if (a !== b) {
      ut.push({
        field: namn,
        before: a.replace(/^"|"$/g, ""),
        after: b.replace(/^"|"$/g, ""),
      });
    }
  }
  return ut;
}

export const listAgreementVersions = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<Avtalsversion[]> => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const user = await readSession();
    if (!user) return [];

    return asUser(user.id, async (sql) => {
      const rows = await sql<
        {
          id: string;
          version: number;
          start_date: string;
          start_value_ore: string;
          initial_loan_ore: string;
          total_units: string;
          start_units: Record<string, number>;
          formal_ownership: Record<string, number> | null;
          checksum: string | null;
          reason: string | null;
          document_md: string | null;
          created_at: Date;
          effective_at: Date | null;
          addendum_id: string | null;
          created_by_name: string;
        }[]
      >`
        select v.id, v.version, v.start_date, v.start_value_ore, v.initial_loan_ore,
               v.total_units, v.start_units, v.formal_ownership, v.checksum, v.reason,
               v.document_md, v.created_at, v.effective_at, v.addendum_id,
               u.name as created_by_name
          from agreement_versions v
          join users u on u.id = v.created_by
         where v.agreement_id = current_agreement_id(${data.householdId})
         order by v.version asc
      `;
      if (rows.length === 0) return [];

      const beslut = await sql<{ entity_id: string; party_id: string; decision: string }[]>`
        select entity_id, party_id, decision from document_approvals
         where entity_type = 'agreement_version'
           and entity_id in ${sql(rows.map((r) => r.id))}
      `;

      // Den gällande är den med högst versionsnummer som börjat gälla. Övriga
      // som börjat gälla är ersatta.
      const gallande = [...rows].reverse().find((r) => r.effective_at !== null)?.id;

      return rows.map((rad, index) => {
        const forra = index > 0 ? rows[index - 1] : null;
        const mitt = {
          startDate: rad.start_date,
          startValueOre: rad.start_value_ore,
          initialLoanOre: rad.initial_loan_ore,
          totalUnits: rad.total_units,
          startUnits: rad.start_units,
          formalOwnership: rad.formal_ownership,
        };
        const forragang = forra
          ? {
              startDate: forra.start_date,
              startValueOre: forra.start_value_ore,
              initialLoanOre: forra.initial_loan_ore,
              totalUnits: forra.total_units,
              startUnits: forra.start_units,
              formalOwnership: forra.formal_ownership,
            }
          : null;

        return {
          id: rad.id,
          version: rad.version,
          status: !rad.effective_at ? "utkast" : rad.id === gallande ? "gällande" : "ersatt",
          startDate: rad.start_date,
          startValueOre: rad.start_value_ore,
          initialLoanOre: rad.initial_loan_ore,
          totalUnits: rad.total_units,
          startUnits: rad.start_units,
          formalOwnership: rad.formal_ownership,
          checksum: rad.checksum,
          reason: rad.reason,
          documentMd: rad.document_md,
          createdBy: rad.created_by_name,
          createdAt: rad.created_at.toISOString(),
          effectiveAt: rad.effective_at?.toISOString() ?? null,
          addendumId: rad.addendum_id,
          approvedBy: beslut
            .filter((b) => b.entity_id === rad.id && b.decision === "approved")
            .map((b) => b.party_id),
          objectedBy: beslut
            .filter((b) => b.entity_id === rad.id && b.decision === "objected")
            .map((b) => b.party_id),
          changes: jamforVersioner(forragang, mitt),
        } satisfies Avtalsversion;
      });
    });
  });

/* --------------------------------------------------------- Tilläggsavtal */

export type Tillagg = {
  id: string;
  title: string;
  signedOn: string;
  summary: string | null;
  appliesFrom: string | null;
  affected: string[];
  documentSha256: string | null;
  attachmentId: string | null;
  createdBy: string;
  createdAt: string;
  effectiveAt: string | null;
  approvedBy: string[];
  /** Avtalsversionen som börjar gälla när båda bekräftat. */
  versionId: string | null;
  versionNumber: number | null;
  /** Avtalsfälten tillägget ändrar, härlett på servern ur skillnaden. */
  changedFields: string[];
  /**
   * Värdena före och efter, så båda parter kan kontrollera innan de bekräftar.
   *
   * Belopp och datum kommer som text ur databasen; startenheter och formella
   * ägarandelar som objekt per part. Typen är uttrycklig eftersom svaret
   * serialiseras över nätet - `unknown` går inte att skicka.
   */
  fore: Avtalsvardesvy | null;
  efter: Avtalsvardesvy | null;
};

export type Avtalsvardesvy = Record<string, string | Record<string, number> | null>;

export const listAddenda = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<Tillagg[]> => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const user = await readSession();
    if (!user) return [];

    return asUser(user.id, async (sql) => {
      const rows = await sql<
        {
          id: string;
          title: string;
          signed_on: string;
          summary: string | null;
          applies_from: string | null;
          affected: string[];
          document_sha256: string | null;
          attachment_id: string | null;
          created_at: Date;
          effective_at: Date | null;
          created_by_name: string;
          version_id: string | null;
          version_number: number | null;
          changed_fields: string[] | null;
          fore: Avtalsvardesvy | null;
          efter: Avtalsvardesvy | null;
        }[]
      >`
        select t.id, t.title, t.signed_on, t.summary, t.applies_from, t.affected,
               t.document_sha256, t.attachment_id, t.created_at, t.effective_at,
               u.name as created_by_name,
               v.id as version_id, v.version as version_number,
               t.changed_fields,
               -- Före och efter för de fält tillägget ändrar. Föregående
               -- version är den med närmast lägre nummer i samma avtal; utan
               -- den kan parterna inte se vad ett ja faktiskt betyder.
               case when v.id is null then null else jsonb_build_object(
                 'startDate', to_char(fore.start_date, 'YYYY-MM-DD'),
                 'startValueOre', fore.start_value_ore::text,
                 'initialLoanOre', fore.initial_loan_ore::text,
                 'totalUnits', fore.total_units::text,
                 'startUnits', fore.start_units,
                 'formalOwnership', fore.formal_ownership
               ) end as fore,
               case when v.id is null then null else jsonb_build_object(
                 'startDate', to_char(v.start_date, 'YYYY-MM-DD'),
                 'startValueOre', v.start_value_ore::text,
                 'initialLoanOre', v.initial_loan_ore::text,
                 'totalUnits', v.total_units::text,
                 'startUnits', v.start_units,
                 'formalOwnership', v.formal_ownership
               ) end as efter
          from agreement_addenda t
          join users u on u.id = t.created_by
          left join agreement_versions v on v.addendum_id = t.id
          left join lateral (
            select * from agreement_versions tidigare
             where tidigare.agreement_id = t.agreement_id
               and tidigare.version < v.version
             order by tidigare.version desc limit 1
          ) fore on true
         where t.agreement_id = current_agreement_id(${data.householdId})
         order by t.created_at desc
      `;
      if (rows.length === 0) return [];

      const beslut = await sql<{ entity_id: string; party_id: string }[]>`
        select entity_id, party_id from document_approvals
         where entity_type = 'addendum' and decision = 'approved'
           and entity_id in ${sql(rows.map((r) => r.id))}
      `;

      return rows.map((rad) => ({
        id: rad.id,
        title: rad.title,
        signedOn: rad.signed_on,
        summary: rad.summary,
        appliesFrom: rad.applies_from,
        affected: rad.affected ?? [],
        documentSha256: rad.document_sha256,
        attachmentId: rad.attachment_id,
        createdBy: rad.created_by_name,
        createdAt: rad.created_at.toISOString(),
        effectiveAt: rad.effective_at?.toISOString() ?? null,
        approvedBy: beslut.filter((b) => b.entity_id === rad.id).map((b) => b.party_id),
        versionId: rad.version_id,
        versionNumber: rad.version_number,
        changedFields: rad.changed_fields ?? [],
        fore: rad.fore,
        efter: rad.efter,
      }));
    });
  });

/**
 * Registrerar ett undertecknat tilläggsavtal och den avtalsversion det leder
 * till.
 *
 * Versionen läggs som utkast. Den börjar gälla först när båda parter bekräftat
 * tillägget, vilket databasens godkännandemaskin sköter - inte den här koden.
 */
export const createAddendum = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        title: z.string().trim().min(1).max(160),
        signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        appliesFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        summary: z.string().trim().min(1).max(2000),
        affected: z.array(z.string().trim().min(1).max(60)).max(20),
        attachmentId: z.string().uuid(),
        // Avtalets värden efter tillägget. Utelämnade fält behåller sitt värde.
        //
        // startDate finns med, men bara som ett uttryckligt val. Tidigare sattes
        // avtalets startdag automatiskt till tilläggets giltighetsdag, vilket
        // flyttade hela den linjära tidslinjen och uteslöt varje historisk post.
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        /** Fälten tillägget säger sig ändra. Måste stämma med den faktiska skillnaden. */
        andrarFalt: z.array(z.enum(AVTALSFALT)).max(AVTALSFALT.length).optional(),
        startValueOre: z.string().regex(/^\d+$/).optional(),
        initialLoanOre: z.string().regex(/^\d+$/).optional(),
        totalUnits: z.string().optional(),
        startUnits: z.record(z.string(), z.number()).optional(),
        formalOwnership: z.record(z.string(), z.number()).optional(),
        reason: z.string().trim().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { registreraTillagg } = await import("@/lib/db/tillagg.server");

    const user = await readSession();
    if (!user) throw new Error("Ej inloggad.");
    return registreraTillagg(user.id, data);
  });

/**
 * Bekräftar ett tilläggsavtal.
 *
 * Bekräftaren anger hashen hen sett. Stämmer den inte med handlingens avvisas
 * bekräftelsen. Utan den kontrollen hade den som registrerat tillägget kunnat
 * byta ut filen mellan de två bekräftelserna, och den andra parten hade bundit
 * sig vid något annat än det hen läste.
 */
export const confirmAddendum = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        addendumId: z.string().uuid(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { readSession } = await import("@/lib/auth/session.server");
    const { asUser } = await import("@/lib/db/client.server");
    const { approveDocument } = await import("@/lib/db/transactions.server");
    const user = await readSession();
    if (!user) throw new Error("Ej inloggad.");

    const kontroll = await asUser(user.id, async (sql) => {
      const [tillagg] = await sql<{ document_sha256: string | null }[]>`
        select document_sha256 from agreement_addenda
         where id = ${data.addendumId} and household_id = ${data.householdId}`;
      if (!tillagg) throw new Error("Tilläggsavtalet finns inte.");

      const [medlem] = await sql<{ party_id: string }[]>`
        select party_id from household_members
         where household_id = ${data.householdId} and user_id = ${user.id}`;
      // Administratören är inte part och kan därför inte bekräfta åt någon.
      // Spärren ligger även i databasens policy; den här ger ett begripligt svar.
      if (!medlem) throw new Error("Bara hushållets parter kan bekräfta ett tilläggsavtal.");

      return { hash: tillagg.document_sha256, partyId: medlem.party_id };
    });

    if (kontroll.hash !== data.sha256) {
      throw new Error(
        "Handlingen har ändrats sedan du läste den. Läs igenom den på nytt innan du bekräftar.",
      );
    }

    await approveDocument(user.id, kontroll.partyId, data.householdId, "addendum", data.addendumId);
    return { ok: true as const };
  });
