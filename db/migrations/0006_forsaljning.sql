-- Försäljning och utköp.
--
-- Slutavräkningen fryser sina indata och sitt resultat. Den kan därefter
-- räknas om ur exakt samma indata och ska då ge exakt samma resultat – det är
-- hela poängen med ett bevisverktyg. En låst avräkning kan inte ändras av
-- någon roll.

create type exit_kind as enum ('extern_forsaljning', 'utkop', 'dodsfall', 'annan');
create type exit_status as enum ('pagaende', 'genomford', 'avbruten');

-- Avtalsmässig processdag och fristerna som följer av den (avtal 16–17).
create table exit_processes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  process_date date not null,
  kind exit_kind not null default 'annan',
  status exit_status not null default 'pagaende',
  -- Den part som meddelat att hen vill överta bostaden (avtal 17.1).
  takeover_party_id text,
  takeover_notified_at timestamptz,
  -- Avbockad checklista inför genomfört utköp (avtal 19.3).
  checklist jsonb not null default '{}'::jsonb,
  note text,
  started_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index exit_processes_household_idx on exit_processes(household_id, process_date);

-- Oberoende mäklarvärderingar (avtal 18.2–18.3).
create table valuations (
  id uuid primary key default gen_random_uuid(),
  exit_process_id uuid not null references exit_processes(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  -- Vilken part som utsett mäklaren. Null för den tredje, gemensamma.
  ordered_by_party_id text,
  broker text not null,
  valued_on date not null,
  amount_ore bigint not null check (amount_ore > 0),
  attachment_id uuid references attachments(id),
  note text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create index valuations_process_idx on valuations(exit_process_id);

-- Den frysta slutavräkningen.
create table settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  exit_process_id uuid references exit_processes(id) on delete set null,
  -- Grunden för slutvärdet: extern försäljning, utköpsvärdering eller annan.
  basis text not null,
  end_date date not null,
  end_value_ore bigint not null,
  end_loan_ore bigint not null check (end_loan_ore >= 0),
  sale_costs_ore bigint not null default 0 check (sale_costs_ore >= 0),
  agreement_signed_on date,
  notes text,
  -- Allt beräkningen vilade på, och vad den gav. Sparas så att den kan
  -- räknas om och jämföras.
  frozen_input jsonb not null,
  frozen_result jsonb not null,
  engine_version text not null,
  -- Checksumma över kanoniskt serialiserade indata och resultat.
  checksum text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  -- Sätts när båda parter godkänt. Därefter är avräkningen låst.
  locked_at timestamptz
);

create index settlements_household_idx on settlements(household_id);

-- Godkännanden av slutavräkningen använder samma tabell som avtal och regler.
alter type approval_entity add value 'settlement';

alter table exit_processes enable row level security;
alter table valuations enable row level security;
alter table settlements enable row level security;

create policy exit_read on exit_processes for select
  using (is_household_member(household_id));

create policy exit_write on exit_processes for all
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy valuations_read on valuations for select
  using (is_household_member(household_id));

create policy valuations_insert on valuations for insert
  with check (created_by = app_user_id() and is_household_member(household_id));

create policy settlements_read on settlements for select
  using (is_household_member(household_id));

create policy settlements_insert on settlements for insert
  with check (created_by = app_user_id() and is_household_member(household_id));

-- Uppdatering behövs bara för att sätta låset, och det sköter triggern nedan.
create policy settlements_update on settlements for update
  using (is_household_member(household_id) and locked_at is null)
  with check (is_household_member(household_id));

-- En låst slutavräkning kan inte ändras eller tas bort av någon roll, inte
-- ens ägaren. Vill parterna räkna om gör de en ny avräkning.
create or replace function deny_locked_settlement() returns trigger
  language plpgsql
  as $$
  begin
    if old.locked_at is not null then
      raise exception 'En godkänd slutavräkning är låst. Gör en ny avräkning i stället.';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end;
  $$;

create trigger settlements_freeze
  before update or delete on settlements
  for each row execute function deny_locked_settlement();

grant select, insert, update, delete on exit_processes, valuations, settlements
  to mittochditt_app;

-- Godkännandetriggern ska även kunna låsa en slutavräkning. Enumvärdet läggs
-- till ovan; plpgsql-kroppen tolkas först vid körning, så den kan referera
-- till det redan här.
create or replace function apply_document_approval() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    approved_parties integer;
    required integer;
  begin
    if new.decision = 'objected' then
      return new;
    end if;

    select count(distinct party_id) into approved_parties
    from document_approvals
    where entity_type = new.entity_type and entity_id = new.entity_id and decision = 'approved';
    required := household_party_count(new.household_id);
    if approved_parties < required then
      return new;
    end if;

    if new.entity_type = 'agreement_version' then
      update agreement_versions set effective_at = coalesce(effective_at, now())
      where id = new.entity_id and effective_at is null;
    elsif new.entity_type = 'cost_category_rule' then
      update cost_category_rules set effective_at = coalesce(effective_at, now())
      where id = new.entity_id and effective_at is null;
    else
      -- Slutavräkningen låses när båda parter godkänt den.
      update settlements set locked_at = coalesce(locked_at, now())
      where id = new.entity_id and locked_at is null;
    end if;
    return new;
  end;
  $$;
