-- Administratören får skapa och ta bort oanvända konton och hushåll.
--
-- Databasens befintliga främmande nycklar och oföränderlighetstriggers gör
-- att konton och hushåll med avtals-, ekonomi- eller revisionshistorik inte
-- kan raderas. Då ska kontot stängas av i stället. Den inloggade
-- administratören får aldrig radera sitt eget konto.

create policy users_admin_insert on users for insert
  with check (is_admin());

create policy users_admin_delete on users for delete
  using (is_admin());

create or replace function guard_self_delete() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    if app_user_id() is not null and old.id = app_user_id() then
      raise exception 'Du kan inte ta bort ditt eget administratörskonto.';
    end if;
    return old;
  end;
  $$;

create trigger users_guard_self_delete
  before delete on users
  for each row execute function guard_self_delete();

-- En använd inbjudan ska inte ensam låsa ett annars oanvänt konto. Själva
-- inbjudningsraden och dess historik ligger kvar, men användarreferensen blir
-- tom om kontot tas bort.
alter table invites drop constraint invites_invited_by_fkey;
alter table invites
  add constraint invites_invited_by_fkey
  foreign key (invited_by) references users(id) on delete set null;

alter table invites drop constraint invites_accepted_by_fkey;
alter table invites
  add constraint invites_accepted_by_fkey
  foreign key (accepted_by) references users(id) on delete set null;

create policy households_admin_delete on households for delete
  using (is_admin());

-- Varje nytt hushåll får ett tomt avtalsskal. Administratören kan skapa
-- skalet men får fortfarande varken läsa eller ändra avtalsinnehåll.
create policy agreements_admin_insert on agreements for insert
  with check (
    is_admin()
    and exists (select 1 from households h where h.id = agreements.household_id)
  );

-- Administrativa händelser loggas globalt utan att ge administratören
-- läsrätt till något hushålls ekonomiska revisionslogg.
create policy audit_admin_insert on audit_events for insert
  with check (
    is_admin()
    and actor_id = app_user_id()
    and household_id is null
  );
