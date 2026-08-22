-- Sparade simulatorscenarier.
--
-- Simulatorn räknar på antaganden, inte på fakta. Ett sparat scenario är
-- därför bara indata till en beräkning som visas - det ändrar aldrig avtalet,
-- transaktionerna eller andelarna. Tabellen har medvetet ingen koppling till
-- något av det: den bär bara de fält man matar in i simulatorn.
--
-- Ett scenario per hushåll kan märkas som utgångspunkt för översiktens prognos.
-- Även det är ett antagande, och översikten säger det.

create table simulator_scenarios (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,

  name text not null,

  -- Antagandena. Samma fält som simulatorns formulär.
  end_date date not null,
  end_value_ore bigint not null check (end_value_ore >= 0),
  end_loan_ore bigint not null check (end_loan_ore >= 0),
  sale_costs_ore bigint not null default 0 check (sale_costs_ore >= 0),
  spread_percent numeric(5, 2) not null default 10 check (spread_percent >= 0),

  -- Högst ett per hushåll får vara utgångspunkt. Villkorat unikt index i
  -- stället för en flagga som kan hamna på två rader.
  is_default boolean not null default false,

  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (household_id, name)
);

create unique index simulator_scenarios_ett_standard
  on simulator_scenarios (household_id)
  where is_default;

create index simulator_scenarios_hushall on simulator_scenarios (household_id, created_at desc);

alter table simulator_scenarios enable row level security;

-- Båda parter får läsa, skapa, ändra och ta bort scenarier. Ett antagande är
-- inte ett ställningstagande, så här behövs ingen godkännandegång och ingen
-- oföränderlighet - till skillnad från allt annat i tjänsten.
create policy scenarios_read on simulator_scenarios for select
  using (is_household_member(household_id));

create policy scenarios_insert on simulator_scenarios for insert
  with check (created_by = app_user_id() and is_household_member(household_id));

create policy scenarios_update on simulator_scenarios for update
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy scenarios_delete on simulator_scenarios for delete
  using (is_household_member(household_id));
