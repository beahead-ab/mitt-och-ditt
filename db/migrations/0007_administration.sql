-- Administration.
--
-- Administratören hanterar **åtkomst**, inte **innehåll**. Hen kan bjuda in,
-- stänga av konton och sätta upp hushåll med bostadsuppgifter, men kommer
-- aldrig åt parternas ekonomiska poster, avtal, bilagor eller aktivitetslogg.
-- Gränsen ligger i policyerna nedan, inte i gränssnittet.

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$
    select coalesce(
      (select u.is_admin and u.disabled_at is null from users u where u.id = app_user_id()),
      false
    )
  $$;

-- ------------------------------------------------------------------ Konton

create policy users_admin_read on users for select using (is_admin());

-- Administratören får stänga av och öppna konton, men aldrig sätta lösenord
-- åt någon annan. Kolumnrättigheterna tvingar det.
create policy users_admin_update on users for update
  using (is_admin()) with check (is_admin());

revoke update on users from mittochditt_app;
grant update (name, email, is_admin, disabled_at) on users to mittochditt_app;

-- ----------------------------------------------------------------- Hushåll

create policy households_admin_read on households for select using (is_admin());
create policy households_admin_insert on households for insert with check (is_admin());
create policy households_admin_update on households for update
  using (is_admin()) with check (is_admin());

create policy members_admin_read on household_members for select using (is_admin());
create policy members_admin_insert on household_members for insert with check (is_admin());
create policy members_admin_delete on household_members for delete using (is_admin());

-- Bostadens adress hör till uppsättningen av hushållet, inte till ekonomin.
create policy properties_admin on properties for all
  using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------ Inbjudningar

create policy invites_admin_read on invites for select using (is_admin());
create policy invites_admin_insert on invites for insert with check (is_admin());
-- Återkallande är en uppdatering; själva inbjudan raderas aldrig.
create policy invites_admin_update on invites for update
  using (is_admin()) with check (is_admin());

-- Ingen policy ger administratören åtkomst till transactions,
-- transaction_versions, transaction_approvals, agreements, agreement_versions,
-- cost_category_rules, loan_balance_snapshots, attachments, audit_events,
-- exit_processes, valuations eller settlements. Det är avsiktligt: den som
-- administrerar tjänsten ska inte kunna läsa parternas ekonomi.

-- ------------------------------------------------- Spärr mot rättighetsklättring

-- Policyn users_update_self låter var och en rätta sina egna uppgifter, men
-- kolumnrättigheter kan inte skilja på vilka fält en viss policy får röra.
-- Utan spärren nedan skulle en part kunna sätta is_admin på sig själv och ta
-- sig förbi hela administratörsgränsen.
create or replace function guard_privileges() returns trigger
  language plpgsql security definer set search_path = public
  as $$
  begin
    -- Spärren gäller anrop som sker i en inloggad användares namn. Migreringar
    -- och seed körs som ägare utan app.user_id och ska inte hindras.
    if app_user_id() is null then
      return new;
    end if;
    if new.is_admin is distinct from old.is_admin and not is_admin() then
      raise exception 'Bara en administratör kan ändra administratörsrättigheter.';
    end if;
    if new.disabled_at is distinct from old.disabled_at and not is_admin() then
      raise exception 'Bara en administratör kan stänga av eller öppna ett konto.';
    end if;
    return new;
  end;
  $$;

create trigger users_guard_privileges
  before update on users
  for each row execute function guard_privileges();
