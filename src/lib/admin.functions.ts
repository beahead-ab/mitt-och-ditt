import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Administration: konton, hushåll och inbjudningar.
 *
 * Administratören hanterar åtkomst, inte innehåll. Att hen inte kommer åt
 * parternas ekonomi avgörs av radnivåsäkerheten, inte av de här funktionerna –
 * de kan bara göra det policyerna redan tillåter.
 */

async function admin() {
  const { readSession } = await import("@/lib/auth/session.server");
  const user = await readSession();
  if (!user) throw new Error("Ej inloggad.");
  if (!user.isAdmin) throw new Error("Kräver administratörsbehörighet.");
  return user;
}

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  isSelf: boolean;
  isAdmin: boolean;
  hasPassword: boolean;
  disabledAt: string | null;
  createdAt: string;
  households: string[];
};

export const listUsers = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminUser[]> => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");

    return asUser(user.id, async (sql) => {
      const rows = await sql<
        {
          id: string;
          email: string;
          name: string;
          is_admin: boolean;
          password_hash: string | null;
          disabled_at: Date | null;
          created_at: Date;
        }[]
      >`select id, email, name, is_admin, password_hash, disabled_at, created_at
      from users order by created_at`;

      const members = await sql<{ user_id: string; household: string }[]>`
      select m.user_id, h.name as household
      from household_members m join households h on h.id = m.household_id`;

      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        isSelf: row.id === user.id,
        isAdmin: row.is_admin,
        // Lösenordshashen lämnar aldrig servern; bara om den finns.
        hasPassword: row.password_hash !== null,
        disabledAt: row.disabled_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        households: members.filter((m) => m.user_id === row.id).map((m) => m.household),
      }));
    });
  },
);

export const createUser = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(80),
        email: z.string().trim().toLowerCase().email().max(255),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await admin();
    const { asUser, owner } = await import("@/lib/db/client.server");
    const { expiresIn, hashToken, newToken } = await import("@/lib/auth/tokens");
    const { köaAktivering } = await import("@/lib/mail/invites.server");

    /**
     * Kontot skapas utan lösenord. Personen väljer det själv genom en länk.
     *
     * Administratören ska aldrig kunna välja någon annans lösenord: dels
     * kunde hen då logga in som den personen, dels är ett lösenord som någon
     * annan känner till inte längre ett bevis på vem som gjort vad - och hela
     * tjänsten bygger på att det går att visa vem som godkänt.
     */
    let created: { id: string };
    try {
      created = await asUser(user.id, async (sql) => {
        const [rad] = await sql<{ id: string }[]>`
          insert into users (email, name)
          values (${data.email}, ${data.name})
          returning id
        `;
        await sql`
          insert into audit_events
            (household_id, event_type, entity_type, entity_id, actor_id, new_value)
          values (null, 'admin.user_created', 'user', ${rad.id}, ${user.id},
                  ${sql.json({ email: data.email, name: data.name })})
        `;
        return rad;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new Error("Det finns redan ett konto med den e-postadressen.");
      }
      throw error;
    }

    // Aktiveringslänken går genom samma tabell som återställning. Den lever
    // längre än en vanlig återställning, eftersom den ska hinna fram och
    // användas av någon som ännu inte väntar på den.
    const token = newToken();
    const [reset] = await owner()<{ id: string }[]>`
      insert into password_resets (user_id, token_hash, expires_at)
      values (${created.id}, ${hashToken(token)}, ${expiresIn(7)})
      returning id
    `;
    await köaAktivering({
      resetId: reset.id,
      email: data.email,
      token,
      recipientUserId: created.id,
    });

    return { id: created.id };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const user = await admin();
    if (data.userId === user.id) {
      throw new Error("Du kan inte ta bort ditt eget administratörskonto.");
    }
    const { asUser } = await import("@/lib/db/client.server");

    try {
      await asUser(user.id, async (sql) => {
        const [target] = await sql<{ id: string; email: string; name: string }[]>`
          select id, email, name from users where id = ${data.userId}
        `;
        if (!target) throw new Error("Kontot finns inte längre.");

        const removed = await sql<{ id: string }[]>`
          delete from users where id = ${data.userId} returning id
        `;
        if (!removed[0]) throw new Error("Kontot kunde inte tas bort.");

        await sql`
          insert into audit_events
            (household_id, event_type, entity_type, entity_id, actor_id, previous_value)
          values (null, 'admin.user_deleted', 'user', ${target.id}, ${user.id},
                  ${sql.json({ email: target.email, name: target.name })})
        `;
      });
    } catch (error) {
      const pg = error as { code?: string; message?: string };
      if (pg.code === "23503" || /Aktivitetsloggen|gällande version/i.test(pg.message ?? "")) {
        throw new Error(
          "Kontot har historik som måste bevaras och kan därför inte tas bort. Stäng av kontot i stället.",
        );
      }
      throw error;
    }
    return { ok: true as const };
  });

export const setUserDisabled = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), disabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await admin();
    if (data.userId === user.id && data.disabled) {
      throw new Error("Du kan inte stänga av ditt eget konto.");
    }
    const { asUser } = await import("@/lib/db/client.server");
    await asUser(user.id, async (sql) => {
      await sql`
        update users set disabled_at = ${data.disabled ? sql`now()` : null}
        where id = ${data.userId}
      `;

      try {
        const { notifieraKontostatus } = await import("@/lib/mail/handelser.server");
        await notifieraKontostatus({ userId: data.userId, avstangt: data.disabled });
      } catch {
        // Åtgärden är redan gjord; beskedet får inte fälla den.
      }
      // Ett avstängt konto ska inte kunna fortsätta på en öppen session.
      if (data.disabled) await sql`delete from sessions where user_id = ${data.userId}`;
    });
    return { ok: true as const };
  });

export type AdminHousehold = {
  id: string;
  name: string;
  address: string | null;
  createdAt: string;
  /** Hushållets två partsroller. Bara dessa går att bjuda in till. */
  partyIds: [string, string];
  members: { userId: string; partyId: string; name: string }[];
};

export const listHouseholdsAdmin = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminHousehold[]> => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");

    return asUser(user.id, async (sql) => {
      const rows = await sql<
        {
          id: string;
          name: string;
          address: string | null;
          created_at: Date;
          party_a: string;
          party_b: string;
        }[]
      >`
        select h.id, h.name, p.address, h.created_at, h.party_a, h.party_b
        from households h left join properties p on p.household_id = h.id
        order by h.created_at
      `;
      const members = await sql<
        { household_id: string; user_id: string; party_id: string; display_name: string }[]
      >`select household_id, user_id, party_id, display_name from household_members`;

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        createdAt: row.created_at.toISOString(),
        partyIds: [row.party_a, row.party_b],
        members: members
          .filter((m) => m.household_id === row.id)
          .map((m) => ({ userId: m.user_id, partyId: m.party_id, name: m.display_name })),
      }));
    });
  },
);

export const createHousehold = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ name: z.string().trim().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data }) => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");
    return asUser(user.id, async (sql) => {
      const [household] = await sql<{ id: string }[]>`
        insert into households (name) values (${data.name}) returning id
      `;
      await sql`insert into agreements (household_id) values (${household.id})`;
      await sql`
        insert into audit_events
          (household_id, event_type, entity_type, entity_id, actor_id, new_value)
        values (null, 'admin.household_created', 'household', ${household.id}, ${user.id},
                ${sql.json({ name: data.name })})
      `;
      return { id: household.id };
    });
  });

export const deleteHousehold = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ householdId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");

    try {
      await asUser(user.id, async (sql) => {
        const [target] = await sql<{ id: string; name: string }[]>`
          select id, name from households where id = ${data.householdId}
        `;
        if (!target) throw new Error("Hushållet finns inte längre.");

        const removed = await sql<{ id: string }[]>`
          delete from households where id = ${data.householdId} returning id
        `;
        if (!removed[0]) throw new Error("Hushållet kunde inte tas bort.");

        await sql`
          insert into audit_events
            (household_id, event_type, entity_type, entity_id, actor_id, previous_value)
          values (null, 'admin.household_deleted', 'household', ${target.id}, ${user.id},
                  ${sql.json({ name: target.name })})
        `;
      });
    } catch (error) {
      const pg = error as { code?: string; message?: string };
      if (
        pg.code === "23503" ||
        /Aktivitetsloggen|gällande version|kan bara läggas till/i.test(pg.message ?? "")
      ) {
        throw new Error(
          "Hushållet innehåller historik som måste bevaras och kan därför inte tas bort.",
        );
      }
      throw error;
    }
    return { ok: true as const };
  });

export const saveProperty = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        address: z.string().trim().min(1).max(200),
        association: z.string().trim().max(200).optional(),
        apartmentNumber: z.string().trim().max(40).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");
    await asUser(user.id, async (sql) => {
      const existing = await sql<{ id: string }[]>`
        select id from properties where household_id = ${data.householdId}`;
      if (existing[0]) {
        await sql`
          update properties
          set address = ${data.address}, association = ${data.association ?? null},
              apartment_number = ${data.apartmentNumber ?? null}
          where id = ${existing[0].id}
        `;
      } else {
        await sql`
          insert into properties (household_id, address, association, apartment_number)
          values (${data.householdId}, ${data.address}, ${data.association ?? null},
                  ${data.apartmentNumber ?? null})
        `;
      }
    });
    return { ok: true as const };
  });

export type AdminInvite = {
  id: string;
  email: string;
  displayName: string;
  partyId: string;
  household: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  /** Leveransen av inbjudningsmailet. Null när inget mail köats. */
  mailStatus: string | null;
};

export const listInvites = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminInvite[]> => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");

    return asUser(user.id, async (sql) => {
      const rows = await sql<
        {
          id: string;
          email: string;
          display_name: string;
          party_id: string;
          household: string;
          created_at: Date;
          expires_at: Date;
          accepted_at: Date | null;
          revoked_at: Date | null;
          mail_status: string | null;
        }[]
      >`
        select i.id, i.email, i.display_name, i.party_id, h.name as household,
               i.created_at, i.expires_at, i.accepted_at, i.revoked_at,
               (select m.status from mail_messages m
                 where m.idempotency_key like 'invite:' || i.id::text || ':%'
                   and m.template in ('inbjudan', 'inbjudan_ny')
                 order by m.created_at desc limit 1) as mail_status
        from invites i join households h on h.id = i.household_id
        order by i.created_at desc
      `;
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        partyId: row.party_id,
        household: row.household,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        acceptedAt: row.accepted_at?.toISOString() ?? null,
        revokedAt: row.revoked_at?.toISOString() ?? null,
        mailStatus: row.mail_status,
      }));
    });
  },
);

/**
 * Skapar en inbjudan. Länken visas en enda gång – bara hashen sparas, så den
 * kan inte hämtas fram i efterhand.
 */
export const createInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        householdId: z.string().uuid(),
        email: z.string().trim().toLowerCase().email().max(255),
        displayName: z.string().trim().min(1).max(80),
        partyId: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .regex(
            /^[a-z0-9_-]+$/,
            "Partsrollen får bara innehålla små bokstäver, siffror och bindestreck.",
          ),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");
    const { INVITE_DAYS, expiresIn, hashToken, newToken } = await import("@/lib/auth/tokens");

    const { köaInbjudan } = await import("@/lib/mail/invites.server");

    const token = newToken();
    const giltigTill = expiresIn(INVITE_DAYS);

    const skapad = await asUser(user.id, async (sql) => {
      // Rollen måste vara en av hushållets två. Annars skulle en inbjudan
      // skapa en tredje part som motorn inte räknar med, och som
      // radnivåsäkerhetens spärr för parternas egna inbjudningar inte känner
      // igen - hushållet skulle se helt i sin ordning och ändå vara trasigt.
      const [slots] = await sql<{ party_a: string; party_b: string }[]>`
        select party_a, party_b from households where id = ${data.householdId}`;
      if (!slots) throw new Error("Hushållet finns inte.");
      if (data.partyId !== slots.party_a && data.partyId !== slots.party_b) {
        throw new Error(
          `Hushållets partsroller är ${slots.party_a} och ${slots.party_b}. Välj en av dem.`,
        );
      }

      const taken = await sql<{ id: string }[]>`
        select id from household_members
        where household_id = ${data.householdId} and party_id = ${data.partyId}`;
      if (taken[0]) throw new Error("Partsrollen är redan upptagen i hushållet.");

      const [rad] = await sql<{ id: string }[]>`
        insert into invites
          (email, token_hash, household_id, party_id, display_name, invited_by, expires_at)
        values (${data.email}, ${hashToken(token)}, ${data.householdId}, ${data.partyId},
                ${data.displayName}, ${user.id}, ${giltigTill})
        returning id
      `;
      const [hushall] = await sql<{ name: string }[]>`
        select name from households where id = ${data.householdId}`;
      return { id: rad.id, hushall: hushall?.name ?? "hushållet" };
    });

    // Mailet köas efter att inbjudan finns. Går köandet fel visas länken ändå i
    // gränssnittet, så uppsättningen aldrig fastnar på att mailet krånglar.
    await köaInbjudan({
      inviteId: skapad.id,
      email: data.email,
      namn: data.displayName,
      hushall: skapad.hushall,
      token,
      giltigTill,
      householdId: data.householdId,
    });

    return { token, expiresInDays: INVITE_DAYS };
  });

/**
 * Skickar en ny inbjudan och gör den gamla oanvändbar.
 *
 * Att skicka om samma länk hade varit sämre: har den gamla legat i fel inkorg
 * ska den sluta gälla, inte få en andra chans.
 */
export const resendInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ inviteId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");
    const { INVITE_DAYS, expiresIn, hashToken, newToken } = await import("@/lib/auth/tokens");
    const { avbrytInbjudningsmail, köaInbjudan } = await import("@/lib/mail/invites.server");

    const token = newToken();
    const giltigTill = expiresIn(INVITE_DAYS);

    const ny = await asUser(user.id, async (sql) => {
      const [gammal] = await sql<
        {
          email: string;
          display_name: string;
          party_id: string;
          household_id: string;
          accepted_at: Date | null;
        }[]
      >`
        select email, display_name, party_id, household_id, accepted_at
          from invites where id = ${data.inviteId}
      `;
      if (!gammal) throw new Error("Inbjudan finns inte.");
      if (gammal.accepted_at) throw new Error("Inbjudan är redan accepterad.");

      await sql`
        update invites set revoked_at = now()
        where id = ${data.inviteId} and accepted_at is null and revoked_at is null
      `;

      const [rad] = await sql<{ id: string }[]>`
        insert into invites
          (email, token_hash, household_id, party_id, display_name, invited_by, expires_at)
        values (${gammal.email}, ${hashToken(token)}, ${gammal.household_id}, ${gammal.party_id},
                ${gammal.display_name}, ${user.id}, ${giltigTill})
        returning id
      `;
      const [hushall] = await sql<{ name: string }[]>`
        select name from households where id = ${gammal.household_id}`;
      return {
        id: rad.id,
        email: gammal.email,
        namn: gammal.display_name,
        householdId: gammal.household_id,
        hushall: hushall?.name ?? "hushållet",
      };
    });

    await avbrytInbjudningsmail(data.inviteId);
    await köaInbjudan({
      inviteId: ny.id,
      email: ny.email,
      namn: ny.namn,
      hushall: ny.hushall,
      token,
      giltigTill,
      householdId: ny.householdId,
      ersatter: true,
    });

    return { token, expiresInDays: INVITE_DAYS };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ inviteId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const user = await admin();
    const { asUser } = await import("@/lib/db/client.server");
    const { avbrytInbjudningsmail } = await import("@/lib/mail/invites.server");

    await asUser(user.id, async (sql) => {
      await sql`
        update invites set revoked_at = now()
        where id = ${data.inviteId} and accepted_at is null and revoked_at is null
      `;
    });
    // Har mailet redan gått fram går det inte att ta tillbaka, men länken
    // slutade gälla i samma stund och mailet är därmed verkningslöst.
    await avbrytInbjudningsmail(data.inviteId);
    return { ok: true as const };
  });
