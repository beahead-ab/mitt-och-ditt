-- Oföränderlig aktivitetslogg med hashkedja.
--
-- Varje rad hashar föregående rads hash tillsammans med sitt eget innehåll.
-- Ändrar någon en rad i efterhand bryts kedjan och det går att upptäcka.
-- Hashen räknas fram av databasen, inte av applikationen, så den kan inte
-- förfalskas av den som skriver.

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  sequence bigint not null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  actor_id uuid references users(id),
  -- Före- och eftervärden för det som ändrades.
  previous_value jsonb,
  new_value jsonb,
  occurred_at timestamptz not null default now(),
  prev_hash text not null,
  hash text not null,
  unique (household_id, sequence)
);

create index audit_events_household_idx on audit_events(household_id, sequence);
create index audit_events_entity_idx on audit_events(entity_type, entity_id);

create or replace function audit_chain() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  declare
    last_row audit_events%rowtype;
    payload text;
  begin
    -- Serialisera per hushåll så att två samtidiga skrivningar inte kan få
    -- samma föregångare och därmed grena kedjan.
    perform pg_advisory_xact_lock(hashtext(coalesce(new.household_id::text, 'global')));

    select * into last_row from audit_events
      where household_id is not distinct from new.household_id
      order by sequence desc limit 1;

    new.sequence := coalesce(last_row.sequence, 0) + 1;
    new.prev_hash := coalesce(last_row.hash, repeat('0', 64));
    new.occurred_at := coalesce(new.occurred_at, now());

    payload := concat_ws(
      '|',
      new.prev_hash,
      new.sequence::text,
      coalesce(new.household_id::text, ''),
      new.event_type,
      new.entity_type,
      coalesce(new.entity_id::text, ''),
      coalesce(new.actor_id::text, ''),
      coalesce(new.previous_value::text, ''),
      coalesce(new.new_value::text, ''),
      to_char(new.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF')
    );
    new.hash := encode(digest(payload, 'sha256'), 'hex');
    return new;
  end;
  $$;

create trigger audit_chain_before_insert
  before insert on audit_events
  for each row execute function audit_chain();

-- Loggen är append-only. Ingen roll, inte ens ägaren, får ändra eller ta bort.
create or replace function deny_mutation() returns trigger
  language plpgsql
  as $$
  begin
    raise exception 'Aktivitetsloggen kan bara läggas till i, aldrig ändras eller raderas';
  end;
  $$;

create trigger audit_events_immutable
  before update or delete on audit_events
  for each row execute function deny_mutation();

-- Kontrollerar att kedjan är obruten. Används av exporten av revisionsunderlag.
create or replace function verify_audit_chain(target uuid)
  returns table (sequence bigint, ok boolean)
  language plpgsql stable security definer set search_path = public
  as $$
  declare
    row_data audit_events%rowtype;
    expected_prev text := repeat('0', 64);
    payload text;
  begin
    for row_data in
      select * from audit_events
      where household_id is not distinct from target
      order by sequence
    loop
      payload := concat_ws(
        '|',
        row_data.prev_hash,
        row_data.sequence::text,
        coalesce(row_data.household_id::text, ''),
        row_data.event_type,
        row_data.entity_type,
        coalesce(row_data.entity_id::text, ''),
        coalesce(row_data.actor_id::text, ''),
        coalesce(row_data.previous_value::text, ''),
        coalesce(row_data.new_value::text, ''),
        to_char(row_data.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF')
      );
      sequence := row_data.sequence;
      ok := row_data.prev_hash = expected_prev
        and row_data.hash = encode(digest(payload, 'sha256'), 'hex');
      expected_prev := row_data.hash;
      return next;
    end loop;
  end;
  $$;
