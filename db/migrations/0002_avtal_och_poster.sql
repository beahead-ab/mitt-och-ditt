-- Avtalet, kostnadsklassificeringarna och de ekonomiska posterna.
--
-- Genomgående princip: ingenting skrivs över. Varje ändring är en ny version
-- av hela posten, och versionen börjar gälla först när båda parter godkänt
-- den. Cellernas historik härleds ur skillnaden mellan versionerna.

-- ------------------------------------------------------------------- Avtal

create table agreements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index agreements_household_idx on agreements(household_id);

-- En avtalsversion bär både dokumentet och de maskinläsbara parametrar som
-- beräkningsmotorn läser. Fälten som avtalets punkt 25.1 skyddar får bara
-- ändras genom en ny version som stödjer sig på ett undertecknat tillägg.
create table agreement_versions (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references agreements(id) on delete cascade,
  version integer not null,
  start_date date not null,
  start_value_ore bigint not null check (start_value_ore >= 0),
  initial_loan_ore bigint not null check (initial_loan_ore >= 0),
  total_units numeric(20, 6) not null check (total_units > 0),
  -- Startenheter och formella ägarandelar per part.
  start_units jsonb not null,
  formal_ownership jsonb,
  document_md text,
  checksum text,
  -- Tilläggsavtalet som ligger till grund, när ändringen kräver ett sådant.
  addendum_id uuid,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  effective_at timestamptz,
  reason text,
  unique (agreement_id, version)
);

create index agreement_versions_agreement_idx on agreement_versions(agreement_id);

create table agreement_addenda (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references agreements(id) on delete cascade,
  title text not null,
  signed_on date not null,
  -- Den undertecknade handlingen. Ligger i privat lagring.
  attachment_id uuid,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  effective_at timestamptz
);

create index agreement_addenda_agreement_idx on agreement_addenda(agreement_id);

alter table agreement_versions
  add constraint agreement_versions_addendum_fk
  foreign key (addendum_id) references agreement_addenda(id);

-- --------------------------------------------------- Kostnadsklassificering

-- Temporal: en klassificering gäller från ett datum och aldrig bakåt. En
-- betalning som gjordes medan den gällde måste fortsätta räknas med den, så
-- rader tas aldrig bort - de ersätts av en ny med senare giltighetsdag.
create table cost_category_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  category text not null,
  effective_from date not null,
  included boolean not null,
  outside_split jsonb,
  reduces_loan boolean not null default false,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  effective_at timestamptz,
  reason text
);

create index cost_category_rules_household_idx
  on cost_category_rules(household_id, category, effective_from);

-- ------------------------------------------------------------ Transaktioner

create type transaction_status as enum (
  'draft', 'pending', 'withdrawn', 'approved', 'disputed'
);

-- Posten är ett skal med stabil identitet. Alla värden ligger i versionerna.
create table transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  -- Läsbart löpnummer, T-0001. Unikt inom hushållet.
  reference text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  -- Sätts bara för utkast som aldrig lämnat registratorn.
  deleted_at timestamptz,
  unique (household_id, reference)
);

create index transactions_household_idx on transactions(household_id);

create table transaction_versions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  version integer not null,
  status transaction_status not null default 'draft',
  payment_date date not null,
  category text not null,
  description text,
  -- Betalningar per part: brutto, rabatt, återbetalning, försäkringsersättning
  -- och faktisk skatteeffekt, allt i öre.
  payments jsonb not null default '{}'::jsonb,
  special_key jsonb,
  loan_balance_after_ore bigint,
  -- Korrigering ersätter posten med nya värden, makulering med ingenting.
  corrects_transaction_id uuid references transactions(id),
  voids_transaction_id uuid references transactions(id),
  reason text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  effective_at timestamptz,
  unique (transaction_id, version),
  -- En version kan inte både korrigera och makulera.
  constraint one_purpose check (
    corrects_transaction_id is null or voids_transaction_id is null
  ),
  -- Korrigering och makulering kräver alltid ett angivet skäl.
  constraint reason_required check (
    (corrects_transaction_id is null and voids_transaction_id is null)
    or (reason is not null and length(btrim(reason)) > 0)
  )
);

create index transaction_versions_tx_idx on transaction_versions(transaction_id);

-- Ett godkännande per part och version. Spärren mot att godkänna åt någon
-- annan ligger i policyn längre ned, inte bara i gränssnittet.
create type approval_decision as enum ('approved', 'objected');

create table transaction_approvals (
  id uuid primary key default gen_random_uuid(),
  transaction_version_id uuid not null
    references transaction_versions(id) on delete cascade,
  user_id uuid not null references users(id),
  party_id text not null,
  decision approval_decision not null,
  note text,
  decided_at timestamptz not null default now(),
  unique (transaction_version_id, user_id)
);

create index transaction_approvals_version_idx
  on transaction_approvals(transaction_version_id);

-- ----------------------------------------------------------- Lån och bilagor

create table loan_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  balance_date date not null,
  balance_ore bigint not null check (balance_ore >= 0),
  note text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create index loan_snapshots_household_idx
  on loan_balance_snapshots(household_id, balance_date);

-- Filen ligger i privat lagring. Raderas den kvarstår raden som gravsten med
-- hash och metadata, så att det syns att något har tagits bort.
create table attachments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete cascade,
  storage_key text,
  filename text not null,
  content_type text not null,
  byte_size bigint not null,
  sha256 text not null,
  uploaded_by uuid not null references users(id),
  uploaded_at timestamptz not null default now(),
  redacted_at timestamptz,
  redacted_by uuid references users(id),
  redaction_reason text
);

create index attachments_household_idx on attachments(household_id);
create index attachments_transaction_idx on attachments(transaction_id);
