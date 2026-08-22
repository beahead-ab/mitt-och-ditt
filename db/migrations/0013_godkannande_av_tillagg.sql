-- Godkännandemaskinen känner nu även tilläggsavtal.
--
-- Varje slag får en egen gren. Den gamla funktionen lät sista grenen vara ett
-- else, och när slutavräkningar tillkom hamnade de först i fel gren av just det
-- skälet. Ett okänt slag ska hellre säga ifrån än gissa.

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

    elsif new.entity_type = 'settlement' then
      -- Slutavräkningen låses när båda parter godkänt den.
      update settlements set locked_at = coalesce(locked_at, now())
      where id = new.entity_id and locked_at is null;

    elsif new.entity_type = 'addendum' then
      -- Först när båda bekräftat samma handling börjar tillägget gälla, och i
      -- samma stund sätts den avtalsversion som vilar på det i kraft. Ingen av
      -- delarna sker vid den första bekräftelsen.
      update agreement_addenda set effective_at = coalesce(effective_at, now())
      where id = new.entity_id and effective_at is null;

      update agreement_versions set effective_at = coalesce(effective_at, now())
      where addendum_id = new.entity_id and effective_at is null;

    else
      raise exception 'Okänt slag av godkännande: %', new.entity_type;
    end if;

    return new;
  end;
  $$;

-- Insert-policyn räknar upp vilka dokumentslag som får godkännas. Den skrevs om
-- i 0008 och kände då inte till tilläggsavtal, så en bekräftelse avvisades av
-- radnivåsäkerheten trots att allt annat var rätt.
--
-- Ett nytt dokumentslag måste alltså in på tre ställen: enumet, den här policyn
-- och godkännandemaskinens grenar. Missas något av dem misslyckas det tyst
-- eller på ett sätt som ser ut som något annat.
drop policy if exists document_approvals_insert on document_approvals;

create policy document_approvals_insert on document_approvals for insert
  with check (
    user_id = app_user_id()
    and is_household_member(household_id)
    and party_id = my_party_id(household_id)
    and (
      (
        entity_type = 'agreement_version'
        and exists (
          select 1 from agreement_versions v join agreements a on a.id = v.agreement_id
          where v.id = document_approvals.entity_id
            and a.household_id = document_approvals.household_id
            and v.effective_at is null
            and v.version = (
              select max(latest.version) from agreement_versions latest
              where latest.agreement_id = v.agreement_id
            )
        )
      )
      or (
        entity_type = 'cost_category_rule'
        and exists (
          select 1 from cost_category_rules r
          where r.id = document_approvals.entity_id
            and r.household_id = document_approvals.household_id
        )
      )
      or (
        entity_type = 'settlement'
        and exists (
          select 1 from settlements s
          where s.id = document_approvals.entity_id
            and s.household_id = document_approvals.household_id
            and s.locked_at is null
        )
      )
      or (
        -- Ett tilläggsavtal går att bekräfta så länge det inte redan gäller.
        entity_type = 'addendum'
        and exists (
          select 1 from agreement_addenda t
          where t.id = document_approvals.entity_id
            and t.household_id = document_approvals.household_id
            and t.effective_at is null
        )
      )
    )
  );
