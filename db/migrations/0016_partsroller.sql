-- Hushållets två partsroller.
--
-- Partsnyckeln är en intern nyckel, inte ett namn. Den står som nyckel inuti
-- transaktionernas payments-objekt, i avtalets start_units och
-- formal_ownership, och därmed inuti de checksummor som låser en frusen
-- slutavräkning. Att döpa om en nyckel i efterhand skulle bryta de
-- låsningarna, och en låsning som går att bryta är inte en låsning.
--
-- Därför ändras ingen befintlig nyckel här. I stället får hushållet självt
-- säga vilka två roller det har, så att koden kan sluta anta att de heter
-- något särskilt. Nya hushåll får 'a' och 'b'; vad parterna heter står i
-- display_name, där ett namn hör hemma.

alter table households
  add column party_a text not null default 'a',
  add column party_b text not null default 'b';

-- Befintliga hushåll behåller sina nycklar oförändrade. Ordningen är den som
-- parterna kom in i - medlemskap och inbjudningar räknas båda, eftersom den
-- andra parten kan vara inbjuden men ännu inte ansluten. Nyckeln avgör när
-- tidpunkten är densamma, så resultatet inte beror på hur raderna råkar ligga.
with slots as (
  select household_id, party_id, min(sedan) as sedan
    from (
      select household_id, party_id, joined_at  as sedan from household_members
      union all
      select household_id, party_id, created_at as sedan from invites
    ) as alla
   group by household_id, party_id
),
ordnade as (
  select household_id,
         (array_agg(party_id order by sedan, party_id))[1] as a,
         (array_agg(party_id order by sedan, party_id))[2] as b
    from slots
   group by household_id
)
update households h
   set party_a = o.a,
       -- Ett hushåll där bara den ena rollen hunnit bli till får en andra roll
       -- som inte krockar med den första.
       party_b = coalesce(o.b, case when o.a = 'b' then 'a' else 'b' end)
  from ordnade o
 where o.household_id = h.id and o.a is not null;

-- Två roller, aldrig samma. Motorn räknar på exakt två parter.
alter table households
  add constraint households_tva_skilda_parter check (party_a <> party_b);

-- ------------------------------------------------------- Policyn följer med
--
-- Rätten att bjuda in sin motpart låg tidigare på namnen 'caesar' och
-- 'felicia' (0008). Den spärren är ett andra skyddslager under
-- applikationskoden, så den måste veta samma sak som koden nu vet: att
-- rollerna står på hushållet. Utan det här hade appkoden varit rättad och
-- databasen nekat ändå - för varje par utom det första.
--
-- Rätten är fortfarande lika smal: en part får bjuda in den *andra* av
-- hushållets två roller, och bara när den rollen ännu inte är upptagen.

drop policy if exists invites_partner_insert on invites;

create policy invites_partner_insert on invites for insert
  with check (
    invited_by = app_user_id()
    and accepted_at is null
    and accepted_by is null
    and revoked_at is null
    and is_household_member(household_id)
    and exists (
      select 1 from households h
      where h.id = invites.household_id
        and (
          (my_party_id(invites.household_id) = h.party_a and invites.party_id = h.party_b)
          or
          (my_party_id(invites.household_id) = h.party_b and invites.party_id = h.party_a)
        )
    )
    and not exists (
      select 1 from household_members m
      where m.household_id = invites.household_id
        and m.party_id = invites.party_id
    )
  );
