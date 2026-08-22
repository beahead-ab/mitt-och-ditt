-- Utkorg för e-post.
--
-- Mail läggs i databasen och skickas av en separat avsändare. Användarens
-- handling ska lyckas även när mailservern är nere; det som inte gick fram
-- ligger kvar och försöks igen.
--
-- Två tabeller med flit. Metadata om leveransen behöver administratören se för
-- att kunna sköta driften. Innehållet - som kan innehålla en inbjudningslänk
-- eller en återställningstoken - får hen aldrig se. Därför ligger de i skilda
-- tabeller med skilda policyer, i stället för i skilda kolumner: Postgres
-- kolumnrättigheter gäller per roll, och både part och administratör använder
-- samma applikationsroll. En kolumnspärr hade alltså inte hållit.

create table mail_messages (
  id uuid primary key default gen_random_uuid(),

  -- En nyckel per händelse och mottagare. Unik, så att en omstart mitt i ett
  -- flöde eller två samtidiga anrop inte kan lägga samma mail två gånger.
  idempotency_key text not null unique,

  template text not null,
  recipient_email text not null,
  recipient_user_id uuid references users(id) on delete set null,

  -- Null för mail som inte hör till något hushåll, till exempel
  -- lösenordsåterställning. Styr vilka parter som får se leveransstatusen.
  household_id uuid references households(id) on delete cascade,

  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),

  attempts integer not null default 0,
  max_attempts integer not null default 6,
  next_attempt_at timestamptz not null default now(),

  -- Kort, ofarlig text. Aldrig serverns svar rakt av, aldrig token.
  last_error text,

  created_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,

  constraint attempts_inom_taket check (attempts >= 0 and attempts <= max_attempts + 1)
);

-- Avsändaren hämtar det som är moget att skicka.
create index mail_messages_att_skicka
  on mail_messages (next_attempt_at)
  where status = 'pending';

create index mail_messages_hushall on mail_messages (household_id);

-- Innehållet. Ligger separat och krypterat, och töms när mailet är levererat
-- eller har gett upp - en token som redan använts ska inte bli kvar i en
-- säkerhetskopia.
create table mail_payloads (
  message_id uuid primary key references mail_messages(id) on delete cascade,
  params_encrypted text not null,
  purge_after timestamptz not null
);

alter table mail_messages enable row level security;
alter table mail_payloads enable row level security;

-- Administratören ser leveransen för att kunna sköta driften. Parterna ser
-- sitt eget hushålls mail, eftersom de själva bjuder in och behöver se om det
-- gick fram. Ingen ser någon annans.
create policy mail_messages_read on mail_messages for select
  using (
    is_admin()
    or (household_id is not null and is_household_member(household_id))
    or recipient_user_id = app_user_id()
  );

-- Ingen skrivpolicy. Att köa och att skicka sker genom ägarrollen, aldrig i en
-- inloggad användares namn: annars hade en part kunnat lägga ett mail med valfri
-- mall till valfri adress. Att raden skapas utanför användarens transaktion är
-- avsiktligt - ett mail ska bara gå ut för en handling som faktiskt blev av.

-- mail_payloads får medvetet ingen policy alls. Radnivåsäkerheten nekar då
-- allt för applikationsrollen, och innehållet är oåtkomligt för både parter och
-- administratör. Bara ägarrollen, som avsändaren använder, kommer åt det.
