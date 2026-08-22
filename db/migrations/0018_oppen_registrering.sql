-- Öppen registrering: ett par ska kunna komma igång utan att någon släpper in
-- dem.
--
-- Hittills kunde bara en administratör skapa ett hushåll, och bara en
-- administratör kunde bjuda in den första parten. Det gjorde en människa till
-- en nödvändig del av varje uppstart. Här flyttas den rätten till den som
-- bekräftat sin e-postadress - och inte en millimeter längre: rollen som
-- administratör går fortfarande inte att ge sig själv, och ingen kommer åt
-- något annat hushåll än sitt eget.

-- ---------------------------------------------------------- Bekräftad adress
--
-- En e-postadress som ingen bevisat är sin duger inte som grund för ett konto
-- på ett öppet nät. Utan bekräftelse kunde vem som helst registrera sig i
-- någon annans namn och sedan ta emot inbjudningar avsedda för den personen.
alter table users add column email_verified_at timestamptz;

-- Alla som redan finns kom in genom en inbjudningslänk skickad till just deras
-- adress. Det är samma bevis som bekräftelsen ger, så de räknas som bekräftade
-- och märker ingenting av den här ändringen.
update users set email_verified_at = coalesce(email_verified_at, created_at);

-- Samma form som password_resets, och av samma skäl ingen policy alls:
-- bekräftelsen måste kunna slås upp innan någon är inloggad och sker därför
-- genom ägarrollen. Att varken parterna eller administratören kan läsa en
-- bekräftelsetoken följer då av databasen, inte av koden.
create table email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,

  -- Bara hashen. Klartexten lämnar servern en enda gång, i mailet.
  token_hash text not null unique,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,

  -- Sätts när en nyare begäran gör den här överflödig.
  invalidated_at timestamptz
);

create index email_verifications_user on email_verifications (user_id);

alter table email_verifications enable row level security;

-- ------------------------------------------------------------------ Hjälpare
--
-- security definer: funktionerna måste läsa tabeller vars policyer de själva
-- används i, och skulle annars fastna i sin egen spärr.

create or replace function app_user_verified() returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (
      select 1 from users u
      where u.id = app_user_id() and u.email_verified_at is not null
    )
  $$;

-- Har hushållet någon part än? Den som skapar hushållet blir dess första part;
-- den andra kommer in genom en inbjudan, aldrig genom att lägga till sig själv.
create or replace function household_has_members(target uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$
    select exists (select 1 from household_members m where m.household_id = target)
  $$;

alter table households add column created_by uuid references users(id) on delete set null;

-- Hur många hushåll den inloggade själv har skapat. Ett tak behövs på ett
-- öppet nät: en bekräftad adress är ett lågt hinder, och tomma hushåll kostar
-- plats. Taket är satt så att verkliga fall ryms - en bostad med sin partner,
-- en med ett syskon, en med en förälder - och massuppläggning inte gör det.
create or replace function households_created_by_me() returns bigint
  language sql stable security definer set search_path = public
  as $$
    select count(*) from households h where h.created_by = app_user_id()
  $$;

-- --------------------------------------------------------- Skapa sitt hushåll
-- Den som skapat hushållet får läsa det.
--
-- Utan den här går inte ens ett `insert ... returning` igenom: radnivåsäkerheten
-- måste kunna visa raden tillbaka, och households_read bygger på medlemskap -
-- som inte finns förrän i nästa steg. Rätten är smal och bestående: den gäller
-- bara rader man själv skapat, och ger ingenting i något annat hushåll.
create policy households_self_read on households for select
  using (created_by = app_user_id());

create policy households_self_insert on households for insert
  with check (
    created_by = app_user_id()
    and app_user_verified()
    and households_created_by_me() < 5
  );

-- Den som skapade hushållet blir dess första part. Villkoret att hushållet
-- ännu saknar parter är det som hindrar någon från att lägga till sig själv i
-- ett hushåll som redan finns.
create policy members_self_insert on household_members for insert
  with check (
    user_id = app_user_id()
    and app_user_verified()
    and not household_has_members(household_id)
  );

-- Varje hushåll behöver sitt tomma avtalsskal, precis som när administratören
-- skapar ett. Skalet bär inget innehåll; innehållet kräver båda parters
-- godkännande som förut.
create policy agreements_self_insert on agreements for insert
  with check (is_household_member(household_id));
