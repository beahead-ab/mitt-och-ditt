-- Regressfordran med dröjsmålsränta (avtal 12.3) och fristerna vid dödsfall
-- (avtal 22).
--
-- Ingen av delarna rör beräkningsmotorn. En försenad betalning mellan
-- personerna ska inte kunna flytta andelsenheter i bostaden, och en frist
-- säger bara vad som ska hända när.

-- ---------------------------------------------------------- Referensräntan
--
-- Riksbankens referensränta gäller från en viss dag tills nästa avlöser den,
-- och ändras normalt 1 januari och 1 juli. Den är en offentlig uppgift och
-- alltså inte hushållets - därför en global tabell som alla får läsa och bara
-- administratören får skriva.
--
-- Tabellen börjar tom med flit. En gissad räntesats som ser riktig ut vore
-- värre än ingen alls: räntan går att räkna men blir fel, och felet syns inte.
-- Saknas satsen för en period vägrar beräkningen i stället för att anta något.
create table reference_rates (
  -- Dagen satsen börjar gälla. Nyckeln är dagen: två satser kan inte gälla
  -- från samma dag.
  from_date date primary key,
  percent numeric(6, 3) not null,
  -- Var uppgiften kommer ifrån, så den går att kontrollera i efterhand.
  source text,
  created_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null
);

alter table reference_rates enable row level security;

create policy reference_rates_read on reference_rates for select using (true);
create policy reference_rates_admin_write on reference_rates for insert with check (is_admin());
create policy reference_rates_admin_update on reference_rates for update
  using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------ Regressfordran
--
-- Uppstår när den ena parten betalat mer till banken än vad som följer av den
-- interna fördelningen. Att framställa ett skriftligt krav är den enes
-- ensidiga handling - det kräver inget godkännande från motparten - men det är
-- vad som startar klockan, så dagen måste registreras.
create table regress_claims (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,

  -- Den som har fordran, och den som svarar för den.
  creditor_party_id text not null,
  debtor_party_id text not null,
  check (creditor_party_id <> debtor_party_id),

  amount_ore bigint not null check (amount_ore > 0),

  -- Dagen det skriftliga kravet framställdes. Förfallodagen är trettio dagar
  -- senare och räknas fram, aldrig lagras: en lagrad förfallodag kan sluta
  -- stämma med sitt eget krav.
  demanded_on date not null,

  description text,
  attachment_id uuid references attachments(id) on delete set null,

  -- Reglering. Beloppet kan skilja sig från fordran när parterna kommit
  -- överens om något annat än fullt belopp.
  settled_on date,
  settled_amount_ore bigint check (settled_amount_ore >= 0),
  check ((settled_on is null) = (settled_amount_ore is null)),
  check (settled_on is null or settled_on >= demanded_on),

  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create index regress_claims_hushall on regress_claims (household_id, demanded_on desc);

alter table regress_claims enable row level security;

create policy regress_claims_read on regress_claims for select
  using (is_household_member(household_id));

-- Man framställer krav för egen räkning. Att kunna registrera en fordran i
-- motpartens namn vore att skriva under åt någon annan.
create policy regress_claims_insert on regress_claims for insert
  with check (
    is_household_member(household_id)
    and created_by = app_user_id()
    and creditor_party_id = my_party_id(household_id)
  );

-- Bara borgenären kan reglera sin egen fordran, och bara en gång: en reglering
-- som går att ta tillbaka är ingen reglering.
create policy regress_claims_settle on regress_claims for update
  using (
    is_household_member(household_id)
    and creditor_party_id = my_party_id(household_id)
    and settled_on is null
  )
  with check (
    is_household_member(household_id)
    and creditor_party_id = my_party_id(household_id)
  );

-- Ingen raderingspolicy: en fordran som framställts ligger kvar. Att den
-- reglerats eller bestridits är också en uppgift, och den försvinner inte.

-- ------------------------------------------------------- Fristerna vid dödsfall
--
-- Två frister löper efter varandra, och var och en börjar först när sitt eget
-- underlag finns. Bara källdagarna lagras; fristerna räknas fram, så att en
-- lagrad förfallodag aldrig kan sluta stämma med det den räknats från.
alter table exit_processes
  -- Dagen bouppteckningsförrättningen hölls (avtal 22.2).
  add column estate_inventory_on date,
  -- Dagen den efterlevande meddelade att hen vill överta bostaden.
  add column takeover_declared_on date,
  -- Dagen värdet fastställdes.
  add column value_established_on date,
  -- Dagen finansieringen var ordnad.
  add column financing_arranged_on date;

alter table exit_processes
  add constraint exit_processes_dodsfallsdagar_i_ordning
    check (
      (takeover_declared_on is null or estate_inventory_on is null
        or takeover_declared_on >= estate_inventory_on)
      and (financing_arranged_on is null or value_established_on is null
        or financing_arranged_on >= value_established_on)
    );
