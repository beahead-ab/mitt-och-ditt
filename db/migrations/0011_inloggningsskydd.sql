-- Återställning av lösenord, försöksspärr och säkerhetslogg.
--
-- Ingen av tabellerna får någon policy. Radnivåsäkerheten nekar då allt för
-- applikationsrollen, och bara ägarrollen kommer åt dem. Det är avsiktligt:
-- inloggning och återställning måste kunna slå upp konton innan någon är
-- inloggad, och sker därför redan genom ägarrollen. Att parterna eller
-- administratören inte kan läsa återställningstoken eller spärrarnas räknare
-- följer då av databasen och inte av koden.

create table password_resets (
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

create index password_resets_user on password_resets (user_id);

-- Räknare för försök. Nyckeln är hashad, aldrig adressen eller IP:t i klartext:
-- den som får tag i tabellen ska inte kunna läsa ut vilka som försökt logga in.
create table auth_throttle (
  bucket text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);

create index auth_throttle_stadning on auth_throttle (window_started_at);

-- Säkerhetshändelser. Skild från hushållens aktivitetslogg, som är parternas
-- bevis och har en hashkedja; det här är driftens spår.
create table security_events (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  event_type text not null,
  user_id uuid references users(id) on delete set null,

  -- Hashad adress för misslyckade försök, så att upprepade försök mot samma
  -- konto går att se utan att listan blir en förteckning över våra användare.
  email_hash text,

  -- Bara nätdelen av IP-adressen. Räcker för att se ett mönster, men pekar
  -- inte ut en enskild uppkoppling.
  ip_prefix text,

  detail text
);

create index security_events_tid on security_events (occurred_at desc);

alter table password_resets enable row level security;
alter table auth_throttle enable row level security;
alter table security_events enable row level security;
