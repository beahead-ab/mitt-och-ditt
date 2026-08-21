-- Mitt & Ditt – grundschema.
--
-- Två roller används:
--   mittochditt_owner  – äger schemat, kör migreringar, kringgår RLS.
--   mittochditt_app    – applikationens roll. Lyder under RLS och ser bara det
--                        den inloggade användaren har rätt till.
--
-- Applikationen sätter app.user_id per transaktion. Utan den ser rollen
-- ingenting alls, vilket är avsiktligt: ett glömt anrop ska ge tomt resultat,
-- aldrig någon annans uppgifter.

create extension if not exists pgcrypto;

-- Vem den inloggade användaren är. Tom sträng ger null, alltså inget synligt.
create or replace function app_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------- Användare

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  -- Null tills användaren accepterat sin inbjudan och valt lösenord.
  password_hash text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

-- Personnummer lagras avsiktligt inte någonstans. De finns i det undertecknade
-- avtalet och behövs inte för någon funktion i tjänsten.

create table sessions (
  -- Endast hashen av sessionstoken lagras; själva token finns bara i kakan.
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);

create index sessions_user_idx on sessions(user_id);
create index sessions_expires_idx on sessions(expires_at);

-- ----------------------------------------------------------------- Hushåll

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Parterna i hushållet. party_id är det stabila ID som beräkningsmotorn
-- använder, och det får aldrig ändras efter att poster har registrerats.
create table household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  party_id text not null,
  display_name text not null,
  joined_at timestamptz not null default now(),
  unique (household_id, user_id),
  unique (household_id, party_id)
);

create index household_members_user_idx on household_members(user_id);

-- Är den inloggade användaren medlem i hushållet? security definer krävs för
-- att funktionen ska kunna läsa medlemstabellen utan att fastna i sin egen
-- policy.
create or replace function is_household_member(target uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from household_members m
      where m.household_id = target and m.user_id = app_user_id()
    )
  $$;

-- Vilken part den inloggade användaren är i hushållet.
create or replace function my_party_id(target uuid) returns text
  language sql stable security definer set search_path = public
  as $$
    select m.party_id from household_members m
    where m.household_id = target and m.user_id = app_user_id()
  $$;

create table properties (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  address text not null,
  association text,
  apartment_number text,
  created_at timestamptz not null default now()
);

create index properties_household_idx on properties(household_id);

-- ------------------------------------------------------------ Inbjudningar

-- Tjänsten är endast för inbjudna. Ingen öppen registrering finns.
create table invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  household_id uuid not null references households(id) on delete cascade,
  party_id text not null,
  display_name text not null,
  invited_by uuid references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references users(id),
  revoked_at timestamptz
);

create index invites_household_idx on invites(household_id);
create index invites_email_idx on invites(lower(email));
