-- En part får bjuda in den saknade motparten till sitt eget hushåll.
--
-- Caesar och Felicia ska inte behöva systemadministratören för den personliga
-- inbjudningslänken. Rätten är samtidigt avsiktligt mycket smalare än
-- administratörens: en part kan bara bjuda in den andra av avtalets två fasta
-- partsroller, och bara när rollen ännu inte är upptagen.

create policy invites_partner_insert on invites for insert
  with check (
    invited_by = app_user_id()
    and accepted_at is null
    and accepted_by is null
    and revoked_at is null
    and is_household_member(household_id)
    and (
      (my_party_id(household_id) = 'caesar' and party_id = 'felicia')
      or
      (my_party_id(household_id) = 'felicia' and party_id = 'caesar')
    )
    and not exists (
      select 1 from household_members m
      where m.household_id = invites.household_id
        and m.party_id = invites.party_id
    )
  );

-- Den som skapade en fortfarande öppen inbjudan får återkalla den. Ingen
-- annan ändring tillåts av triggern nedan. Godkännandet av en inbjudan körs
-- som databasägare och påverkas därför inte.
create policy invites_partner_update on invites for update
  using (
    invited_by = app_user_id()
    and accepted_at is null
    and revoked_at is null
    and is_household_member(household_id)
  )
  with check (
    invited_by = app_user_id()
    and accepted_at is null
    and revoked_at is not null
    and is_household_member(household_id)
  );

create or replace function guard_partner_invite_update() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    if app_user_id() is null or is_admin() then
      return new;
    end if;

    if old.invited_by is distinct from app_user_id()
       or old.accepted_at is not null
       or old.revoked_at is not null then
      raise exception 'Inbjudan kan inte återkallas av den här användaren.';
    end if;

    if new.email is distinct from old.email
       or new.token_hash is distinct from old.token_hash
       or new.household_id is distinct from old.household_id
       or new.party_id is distinct from old.party_id
       or new.display_name is distinct from old.display_name
       or new.invited_by is distinct from old.invited_by
       or new.created_at is distinct from old.created_at
       or new.expires_at is distinct from old.expires_at
       or new.accepted_at is distinct from old.accepted_at
       or new.accepted_by is distinct from old.accepted_by
       or new.revoked_at is null then
      raise exception 'En part får bara återkalla sin egen öppna inbjudan.';
    end if;

    return new;
  end;
  $$;

create trigger invites_guard_partner_update
  before update on invites
  for each row execute function guard_partner_invite_update();

-- Ett hushåll i Mitt & Ditt består alltid av två parter. Innan motparten har
-- anslutit får den första parten därför inte ensam göra ett avtal eller en
-- ekonomisk post gällande.
create or replace function household_party_count(target uuid) returns integer
  language sql stable security definer set search_path = public
  as $$
    select greatest(count(*)::integer, 2)
    from household_members where household_id = target
  $$;

-- Ett godkännande måste avse rätt hushåll. För avtalsutkast gäller dessutom
-- bara den senaste versionen, så ett ersatt utkast aldrig kan börja gälla i
-- efterhand med ett gammalt godkännande.
drop policy document_approvals_insert on document_approvals;
create policy document_approvals_insert on document_approvals for insert
  with check (
    user_id = app_user_id()
    and is_household_member(household_id)
    and party_id = my_party_id(household_id)
    and (
      (
        entity_type = 'agreement_version'
        and exists (
          select 1
          from agreement_versions v join agreements a on a.id = v.agreement_id
          where v.id = document_approvals.entity_id
            and a.household_id = document_approvals.household_id
            and v.effective_at is null
            and v.version = (
              select max(latest.version) from agreement_versions latest
              where latest.agreement_id = v.agreement_id
            )
        )
      )
      or
      (
        entity_type = 'cost_category_rule'
        and exists (
          select 1 from cost_category_rules r
          where r.id = document_approvals.entity_id
            and r.household_id = document_approvals.household_id
        )
      )
      or
      (
        entity_type = 'settlement'
        and exists (
          select 1 from settlements s
          where s.id = document_approvals.entity_id
            and s.household_id = document_approvals.household_id
            and s.locked_at is null
        )
      )
    )
  );
