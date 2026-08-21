-- Godkännandemaskinen.
--
-- Övergången "båda har godkänt, alltså gäller posten" sker i databasen och
-- drivs av godkännanderaderna. Klienten kan därmed inte sätta en post i kraft
-- genom att skriva rätt fält – den kan bara avge sitt eget godkännande.

-- Antalet parter i hushållet. Alla måste godkänna för att något ska gälla.
create or replace function household_party_count(target uuid) returns integer
  language sql stable security definer set search_path = public
  as $$ select count(*)::integer from household_members where household_id = target $$;

-- --------------------------------------------------- Poster

create or replace function apply_transaction_approval() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    target_household uuid;
    approved_parties integer;
    required integer;
  begin
    select t.household_id into target_household
    from transaction_versions v join transactions t on t.id = v.transaction_id
    where v.id = new.transaction_version_id;

    if new.decision = 'objected' then
      -- En invändning tar posten ur beräkningen tills parterna löst frågan.
      update transaction_versions set status = 'disputed'
      where id = new.transaction_version_id and effective_at is null;
      return new;
    end if;

    select count(distinct party_id) into approved_parties
    from transaction_approvals
    where transaction_version_id = new.transaction_version_id and decision = 'approved';
    required := household_party_count(target_household);

    if approved_parties >= required then
      update transaction_versions
      set status = 'approved', effective_at = coalesce(effective_at, now())
      where id = new.transaction_version_id and effective_at is null;
    end if;
    return new;
  end;
  $$;

create trigger transaction_approval_applies
  after insert on transaction_approvals
  for each row execute function apply_transaction_approval();

-- Registratorn får dra tillbaka en post som ännu inte tagits ställning till.
drop policy versions_update_own_draft on transaction_versions;
create policy versions_update_own on transaction_versions for update
  using (
    created_by = app_user_id()
    and effective_at is null
    and status in ('draft', 'pending')
    and exists (
      select 1 from transactions t
      where t.id = transaction_versions.transaction_id and is_household_member(t.household_id)
    )
  )
  with check (
    created_by = app_user_id()
    and effective_at is null
    and status in ('draft', 'pending', 'withdrawn')
  );

-- ------------------------------------- Avtal och kostnadsklassificeringar

-- Samma regel gäller allt parterna ska ta ställning till gemensamt, så en
-- gemensam tabell räcker i stället för en per sort.
create type approval_entity as enum ('agreement_version', 'cost_category_rule');

create table document_approvals (
  id uuid primary key default gen_random_uuid(),
  entity_type approval_entity not null,
  entity_id uuid not null,
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references users(id),
  party_id text not null,
  decision approval_decision not null,
  note text,
  decided_at timestamptz not null default now(),
  unique (entity_type, entity_id, user_id)
);

create index document_approvals_entity_idx on document_approvals(entity_type, entity_id);

alter table document_approvals enable row level security;

create policy document_approvals_read on document_approvals for select
  using (is_household_member(household_id));

-- Samma kärnregel som för poster: bara i eget namn och med egen partsroll.
create policy document_approvals_insert on document_approvals for insert
  with check (
    user_id = app_user_id()
    and is_household_member(household_id)
    and party_id = my_party_id(household_id)
  );

create trigger document_approvals_immutable
  before update or delete on document_approvals
  for each row execute function deny_mutation();

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
    else
      update cost_category_rules set effective_at = coalesce(effective_at, now())
      where id = new.entity_id and effective_at is null;
    end if;
    return new;
  end;
  $$;

create trigger document_approval_applies
  after insert on document_approvals
  for each row execute function apply_document_approval();

grant select, insert, update, delete on document_approvals to mittochditt_app;
