-- Boendekedjan.
--
-- Ett par bor sällan kvar för alltid. De säljer, köper nästa, och den interna
-- andelen ska följa med: slutavräkningen av det gamla boendet ger varje part
-- en slutposition, och de beloppen är - i den mån de faktiskt går in i det nya
-- boendet - startenheterna där, en andelsenhet per krona styrkt kapital
-- (avtal 2.2). Kedjan komponerar alltså av sig själv, förutsatt att tjänsten
-- kan hålla mer än ett boende per hushåll.
--
-- Schemat hindrade aldrig det. Applikationen antog det.

-- ------------------------------------------------------------- Vad slags bostad
--
-- Skillnaden mellan bostadsrätt och fastighet är inte bara fält. En fastighet
-- har ingen månadsavgift till en förening - avtalets punkt 7.2 undantar den
-- uttryckligen - men väl kommunal fastighetsavgift, sotning och ibland
-- tomträttsavgäld. Enligt 7.3 ligger allt oklassificerat utanför
-- enhetsmodellen tills båda parter tagit ställning. Tjänsten ska alltså bära
-- uppgiften om vad det är för bostad, men inte själv avgöra vad som hör till
-- modellen. Det är parternas beslut.
alter table properties
  add column kind text not null default 'bostadsratt'
    check (kind in ('bostadsratt', 'fastighet')),
  -- Fastighetsbeteckning; motsvarigheten till lägenhetsnumret.
  add column property_designation text,
  add column acquired_on date,
  add column disposed_on date;

alter table properties
  add constraint properties_period_i_ordning
    check (disposed_on is null or acquired_on is null or disposed_on >= acquired_on);

-- Här står medvetet ingen spärr mot två samtidiga boenden.
--
-- Under en flytt äger paret ofta båda en tid: tillträdet till det nya kommer
-- före försäljningen av det gamla, och däremellan löper två lån. En regel om
-- "högst ett aktuellt boende per hushåll" hade sett riktig ut och brustit
-- precis i det läge den skulle ha skyddat.

-- ------------------------------------------------------- Avtalet hör till en bostad
alter table agreements
  add column property_id uuid references properties(id) on delete set null;

-- Befintliga avtal pekar på hushållets dittills enda bostad.
update agreements a
   set property_id = p.id
  from properties p
 where p.household_id = a.household_id and a.property_id is null;

create index agreements_property_idx on agreements(property_id);

-- ------------------------------------------------------------ Vilket avtal gäller nu
--
-- Frågan behöver ett svar, annars måste varje anrop hitta på sitt eget - och
-- de skulle sluta säga samma sak den dag kedjan blir mer än ett led.
--
-- Det aktuella boendet är det som ännu inte avyttrats. Finns flera, vilket
-- händer under en flytt, gäller det senast tillträdda. Saknar avtalet bostad
-- alls - läget innan uppstarten är klar - faller svaret tillbaka på hushållets
-- senast skapade avtal.
--
-- Ingen security definer: funktionen ska se precis det den anropande parten
-- får se. En utomstående får null, vilket är rätt svar på frågan.
create or replace function current_agreement_id(target uuid) returns uuid
  language sql stable set search_path = public
  as $$
    select a.id
      from agreements a
      left join properties p on p.id = a.property_id
     where a.household_id = target
     order by (p.id is not null and p.disposed_on is null) desc,
              p.acquired_on desc nulls last,
              a.created_at desc
     limit 1
  $$;
