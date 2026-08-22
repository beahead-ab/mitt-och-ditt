-- Tilläggsavtal.
--
-- Ett tilläggsavtal är en handling som parterna redan undertecknat utanför
-- tjänsten. Tjänstens roll är att registrera att det ska tillämpas, vad det
-- ändrar och från när - aldrig att ersätta underskriften.
--
-- Enumvärdet läggs till här och används först i nästa migrering. Att lägga till
-- ett värde och använda det i samma transaktion är inte tillåtet i Postgres, och
-- en migrering som faller halvvägs är sämre än en extra fil.

alter type approval_entity add value if not exists 'addendum';

alter table agreement_addenda
  -- Vad tillägget ändrar, i klartext. Parterna ska kunna läsa vad de bekräftar
  -- utan att först öppna handlingen.
  add column if not exists summary text,

  -- Från vilket datum ändringen gäller. Skilt från när den registrerades.
  add column if not exists applies_from date,

  -- Vilka låsta fält eller regler som berörs.
  add column if not exists affected text[] not null default '{}',

  -- Hashen av den undertecknade handlingen. Båda parter bekräftar samma hash,
  -- så att ingen kan byta ut filen mellan de två bekräftelserna.
  add column if not exists document_sha256 text,

  -- Behövs för att godkännanden ska kunna knytas till hushållet utan att gå
  -- via avtalet vid varje kontroll.
  add column if not exists household_id uuid references households(id) on delete cascade;

-- Befintliga rader saknar hushåll; fyll i ur avtalet.
update agreement_addenda a
   set household_id = ag.household_id
  from agreements ag
 where ag.id = a.agreement_id and a.household_id is null;

create index if not exists agreement_addenda_household_idx on agreement_addenda (household_id);

-- Ett tillägg får ändras så länge det inte börjat gälla. Därefter är det låst,
-- precis som en gällande avtalsversion.
create policy addenda_update_draft on agreement_addenda for update
  using (
    effective_at is null
    and created_by = app_user_id()
    and exists (
      select 1 from agreements a
      where a.id = agreement_addenda.agreement_id and is_household_member(a.household_id)
    )
  )
  with check (effective_at is null);

create or replace function deny_effective_addendum() returns trigger
  language plpgsql
  as $$
  begin
    if old.effective_at is not null then
      raise exception 'Ett tilläggsavtal som börjat gälla kan inte ändras eller tas bort.';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end;
  $$;

create trigger agreement_addenda_freeze
  before update or delete on agreement_addenda
  for each row execute function deny_effective_addendum();
