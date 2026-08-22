-- Kvartalsavstämning enligt avtalets punkt 14.4.
--
-- Hittills fanns bara en påminnelse som räknade från den senaste godkända
-- posten. Det gjorde att återkommande transaktioner kunde skjuta upp
-- avstämningen hur länge som helst - påminnelsen nollställdes av samma
-- aktivitet som den var till för att kontrollera.
--
-- Nu är avstämningen en egen sak som ska avslutas, och nästa förfallodag räknas
-- från den senast avslutade.

create table reconciliations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,

  period_start date not null,
  period_end date not null,
  due_on date not null,

  -- Punkterna som ska stämmas av. Lagras som objekt så att listan kan växa
  -- utan att schemat ändras.
  checklist jsonb not null default '{}'::jsonb,

  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),

  -- Sätts av databasen när båda parter bekräftat, aldrig av applikationen.
  completed_at timestamptz,

  unique (household_id, period_start)
);

create index reconciliations_hushall on reconciliations (household_id, period_start desc);

create table reconciliation_confirmations (
  reconciliation_id uuid not null references reconciliations(id) on delete cascade,
  user_id uuid not null references users(id),
  party_id text not null,
  confirmed_at timestamptz not null default now(),
  primary key (reconciliation_id, party_id)
);

alter table reconciliations enable row level security;
alter table reconciliation_confirmations enable row level security;

create policy reconciliations_read on reconciliations for select
  using (is_household_member(household_id));

create policy reconciliations_insert on reconciliations for insert
  with check (created_by = app_user_id() and is_household_member(household_id));

-- Checklistan får bockas av så länge avstämningen är öppen. Är den avslutad är
-- den ett avslutat ställningstagande och ändras inte.
create policy reconciliations_update_open on reconciliations for update
  using (is_household_member(household_id) and completed_at is null)
  with check (is_household_member(household_id));

create policy confirmations_read on reconciliation_confirmations for select
  using (exists (
    select 1 from reconciliations r
    where r.id = reconciliation_confirmations.reconciliation_id
      and is_household_member(r.household_id)
  ));

-- Samma kärnregel som för poster och avtal: bara i eget namn och med den
-- partsroll man faktiskt har.
create policy confirmations_insert_self on reconciliation_confirmations for insert
  with check (
    user_id = app_user_id()
    and exists (
      select 1 from reconciliations r
      where r.id = reconciliation_confirmations.reconciliation_id
        and is_household_member(r.household_id)
        and reconciliation_confirmations.party_id = my_party_id(r.household_id)
        and r.completed_at is null
    )
  );

create trigger confirmations_immutable
  before update or delete on reconciliation_confirmations
  for each row execute function deny_mutation();

/**
 * Alla punkter måste vara avbockade innan någon får bekräfta.
 *
 * Spärren ligger här och inte i gränssnittet: en bekräftelse är ett
 * ställningstagande som den andra parten ska kunna lita på, och då duger det
 * inte att kontrollen bara finns i den knapp man råkade klicka på.
 */
create or replace function guard_reconciliation_checklist() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    lista jsonb;
    nyckel text;
  begin
    select checklist into lista from reconciliations where id = new.reconciliation_id;

    if lista is null or lista = '{}'::jsonb then
      raise exception 'Avstämningens checklista är tom och går inte att bekräfta.';
    end if;

    for nyckel in select jsonb_object_keys(lista) loop
      if (lista ->> nyckel) is distinct from 'true' then
        raise exception 'Alla punkter måste vara avbockade innan avstämningen bekräftas.';
      end if;
    end loop;

    return new;
  end;
  $$;

create trigger confirmations_require_checklist
  before insert on reconciliation_confirmations
  for each row execute function guard_reconciliation_checklist();

/**
 * När båda parter bekräftat är perioden avslutad.
 *
 * Databasen sätter tiden, inte applikationen - annars hade klienten kunnat
 * markera en period klar utan att någon bekräftat.
 */
create or replace function apply_reconciliation_confirmation() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    bekraftade integer;
    kravda integer;
    hushall uuid;
  begin
    select r.household_id into hushall from reconciliations r where r.id = new.reconciliation_id;

    select count(distinct party_id) into bekraftade
    from reconciliation_confirmations
    where reconciliation_id = new.reconciliation_id;

    kravda := household_party_count(hushall);

    if bekraftade >= kravda then
      update reconciliations set completed_at = coalesce(completed_at, now())
      where id = new.reconciliation_id and completed_at is null;
    end if;

    return new;
  end;
  $$;

create trigger confirmations_complete_period
  after insert on reconciliation_confirmations
  for each row execute function apply_reconciliation_confirmation();
