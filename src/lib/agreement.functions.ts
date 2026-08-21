import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
        from agreement_versions v join agreements a on a.id = v.agreement_id
        where a.household_id = ${data.householdId} and v.effective_at is null
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
    caesarCapitalKr: wholeKronor,
    feliciaCapitalKr: wholeKronor,
    caesarFormalPercent: z.number().min(0).max(100),
    feliciaFormalPercent: z.number().min(0).max(100),
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
    if (data.caesarCapitalKr + data.feliciaCapitalKr !== netEquity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["feliciaCapitalKr"],
        message: "Kapitalinsatserna måste tillsammans motsvara startvärdet minus bolånet.",
      });
    }
    if (Math.abs(data.caesarFormalPercent + data.feliciaFormalPercent - 100) > 0.000001) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["feliciaFormalPercent"],
        message: "De formella ägarandelarna måste tillsammans vara 100 procent.",
      });
    }
  });

/**
 * Caesar eller Felicia skapar den första avtalsversionen efter att båda har
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
      const members = await sql<{ party_id: string }[]>`
        select party_id from household_members
        where household_id = ${data.householdId}
        order by party_id
      `;
      const roles = members.map((member) => member.party_id);
      if (members.length !== 2 || !roles.includes("caesar") || !roles.includes("felicia")) {
        throw new Error("Både Caesar och Felicia måste ha anslutit innan startuppgifterna sparas.");
      }

      const [agreement] = await sql<{ id: string }[]>`
        select id from agreements where household_id = ${data.householdId}
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
      const startUnits = {
        caesar: data.caesarCapitalKr,
        felicia: data.feliciaCapitalKr,
      };
      const formalOwnership = {
        caesar: data.caesarFormalPercent / 100,
        felicia: data.feliciaFormalPercent / 100,
      };
      const canonical = JSON.stringify({
        version,
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
        `Caesars kapitalinsats: ${data.caesarCapitalKr} kr`,
        `Felicias kapitalinsats: ${data.feliciaCapitalKr} kr`,
        `Formell ägarandel Caesar: ${data.caesarFormalPercent} %`,
        `Formell ägarandel Felicia: ${data.feliciaFormalPercent} %`,
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
          total_units, start_units, formal_ownership, document_md, checksum,
          created_by, reason
        ) values (
          ${agreement.id}, ${version}, ${data.startDate}, ${kr(data.startValueKr)},
          ${kr(data.initialLoanKr)}, ${data.caesarCapitalKr + data.feliciaCapitalKr},
          ${sql.json(startUnits)}, ${sql.json(formalOwnership)}, ${documentMd}, ${checksum},
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

      return { id: draft.id, version, checksum };
    });
  });
