-- Vilken avtalsmodell handlingen förutsätter.
--
-- ENGINE_VERSION är byggets version: den säger vad koden är, inte vad
-- handlingen bygger på. Med flera par kommer avtal skrivna under olika
-- mallversioner att möta samma motor, och då behöver varje avtalsversion bära
-- sitt eget svar på frågan "vilken modell förutsätter det här".
--
-- Modellversionen är oföränderlig: den sätts när versionen skapas och ingår i
-- checksumman. Att ändra den i efterhand vore att byta ut avtalet under
-- parternas godkännande.
--
-- Befintliga avtal är skrivna under modell 1 - den enda som funnits.
alter table agreement_versions
  add column model_version text not null default '1';

-- Samma trigger som skyddar övriga fält efter att versionen börjat gälla
-- skyddar också den här kolumnen, eftersom den ligger i samma rad. Det som
-- behövs här är bara att ingen kan sätta ett tomt värde.
alter table agreement_versions
  add constraint agreement_versions_modellversion_ifylld
    check (length(trim(model_version)) > 0);
