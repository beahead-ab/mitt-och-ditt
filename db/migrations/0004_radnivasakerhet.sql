-- Radnivåsäkerhet.
--
-- Applikationsrollen ser bara det den inloggade användaren har rätt till, och
-- ingenting alls om app.user_id saknas. Spärrarna ligger i databasen, inte i
-- gränssnittet: ett fel i en serverfunktion ska inte kunna läcka data.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mittochditt_app') then
    create role mittochditt_app nologin;
  end if;
end
$$;

grant usage on schema public to mittochditt_app;
grant select, insert, update, delete on all tables in schema public to mittochditt_app;
grant execute on all functions in schema public to mittochditt_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to mittochditt_app;

alter table users enable row level security;
alter table sessions enable row level security;
alter table households enable row level security;
alter table household_members enable row level security;
alter table properties enable row level security;
alter table invites enable row level security;
alter table agreements enable row level security;
alter table agreement_versions enable row level security;
alter table agreement_addenda enable row level security;
alter table cost_category_rules enable row level security;
alter table transactions enable row level security;
alter table transaction_versions enable row level security;
alter table transaction_approvals enable row level security;
alter table loan_balance_snapshots enable row level security;
alter table attachments enable row level security;
alter table audit_events enable row level security;

-- ---------------------------------------------------------------- Användare

-- Man ser sig själv, och de man delar hushåll med. Ingen kan lista alla konton.
create policy users_read on users for select
  using (
    id = app_user_id()
    or exists (
      select 1 from household_members mine
      join household_members theirs on theirs.household_id = mine.household_id
      where mine.user_id = app_user_id() and theirs.user_id = users.id
    )
  );

create policy users_update_self on users for update
  using (id = app_user_id()) with check (id = app_user_id());

create policy sessions_own on sessions for all
  using (user_id = app_user_id()) with check (user_id = app_user_id());

-- ------------------------------------------------------------------ Hushåll

create policy households_read on households for select
  using (is_household_member(id));

create policy members_read on household_members for select
  using (is_household_member(household_id));

create policy properties_read on properties for select
  using (is_household_member(household_id));

create policy properties_write on properties for all
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

-- Inbjudningar hanteras av administratören genom en serverfunktion som kör
-- som ägare. Medlemmar får se sitt hushålls inbjudningar, inget mer.
create policy invites_read on invites for select
  using (is_household_member(household_id));

-- --------------------------------------------------------- Avtal och regler

create policy agreements_read on agreements for select
  using (is_household_member(household_id));

create policy agreement_versions_read on agreement_versions for select
  using (exists (
    select 1 from agreements a
    where a.id = agreement_versions.agreement_id and is_household_member(a.household_id)
  ));

-- Man får skapa en ny version för sitt eget hushåll och i eget namn.
create policy agreement_versions_insert on agreement_versions for insert
  with check (
    created_by = app_user_id()
    and exists (
      select 1 from agreements a
      where a.id = agreement_versions.agreement_id and is_household_member(a.household_id)
    )
  );

create policy addenda_read on agreement_addenda for select
  using (exists (
    select 1 from agreements a
    where a.id = agreement_addenda.agreement_id and is_household_member(a.household_id)
  ));

create policy addenda_insert on agreement_addenda for insert
  with check (
    created_by = app_user_id()
    and exists (
      select 1 from agreements a
      where a.id = agreement_addenda.agreement_id and is_household_member(a.household_id)
    )
  );

create policy rules_read on cost_category_rules for select
  using (is_household_member(household_id));

create policy rules_insert on cost_category_rules for insert
  with check (created_by = app_user_id() and is_household_member(household_id));

-- ------------------------------------------------------------ Transaktioner

create policy transactions_read on transactions for select
  using (is_household_member(household_id));

create policy transactions_insert on transactions for insert
  with check (created_by = app_user_id() and is_household_member(household_id));

create policy versions_read on transaction_versions for select
  using (exists (
    select 1 from transactions t
    where t.id = transaction_versions.transaction_id and is_household_member(t.household_id)
  ));

create policy versions_insert on transaction_versions for insert
  with check (
    created_by = app_user_id()
    and exists (
      select 1 from transactions t
      where t.id = transaction_versions.transaction_id and is_household_member(t.household_id)
    )
  );

-- Ett utkast får ändras av den som skrev det, så länge det inte börjat gälla.
create policy versions_update_own_draft on transaction_versions for update
  using (
    created_by = app_user_id()
    and effective_at is null
    and status = 'draft'
    and exists (
      select 1 from transactions t
      where t.id = transaction_versions.transaction_id and is_household_member(t.household_id)
    )
  )
  with check (created_by = app_user_id() and effective_at is null);

-- Ett eget utkast får raderas. Allt annat måste korrigeras eller makuleras.
create policy versions_delete_own_draft on transaction_versions for delete
  using (
    created_by = app_user_id()
    and effective_at is null
    and status = 'draft'
    and exists (
      select 1 from transactions t
      where t.id = transaction_versions.transaction_id and is_household_member(t.household_id)
    )
  );

create policy approvals_read on transaction_approvals for select
  using (exists (
    select 1 from transaction_versions v
    join transactions t on t.id = v.transaction_id
    where v.id = transaction_approvals.transaction_version_id
      and is_household_member(t.household_id)
  ));

-- Kärnregeln: ingen kan godkänna åt någon annan. Raden måste bära den
-- inloggades eget ID och den partsroll hen faktiskt har i hushållet.
create policy approvals_insert_self on transaction_approvals for insert
  with check (
    user_id = app_user_id()
    and exists (
      select 1 from transaction_versions v
      join transactions t on t.id = v.transaction_id
      where v.id = transaction_approvals.transaction_version_id
        and is_household_member(t.household_id)
        and transaction_approvals.party_id = my_party_id(t.household_id)
    )
  );

create policy snapshots_read on loan_balance_snapshots for select
  using (is_household_member(household_id));

create policy snapshots_insert on loan_balance_snapshots for insert
  with check (created_by = app_user_id() and is_household_member(household_id));

create policy attachments_read on attachments for select
  using (is_household_member(household_id));

create policy attachments_insert on attachments for insert
  with check (uploaded_by = app_user_id() and is_household_member(household_id));

-- Bilagor raderas aldrig; de maskeras och raden blir en gravsten.
create policy attachments_redact on attachments for update
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy audit_read on audit_events for select
  using (household_id is not null and is_household_member(household_id));

create policy audit_insert on audit_events for insert
  with check (actor_id = app_user_id() and is_household_member(household_id));

-- --------------------------------------------------- Oföränderlighet i sak

-- När en version börjat gälla är den låst för alla roller, även ägaren.
create or replace function deny_effective_change() returns trigger
  language plpgsql
  as $$
  begin
    if old.effective_at is not null then
      raise exception 'En gällande version kan inte ändras. Skapa en korrigering eller makulering.';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end;
  $$;

create trigger transaction_versions_freeze
  before update or delete on transaction_versions
  for each row execute function deny_effective_change();

create trigger agreement_versions_freeze
  before update or delete on agreement_versions
  for each row execute function deny_effective_change();

-- Ett godkännande är ett ställningstagande vid en tidpunkt och ändras aldrig.
create trigger approvals_immutable
  before update or delete on transaction_approvals
  for each row execute function deny_mutation();
