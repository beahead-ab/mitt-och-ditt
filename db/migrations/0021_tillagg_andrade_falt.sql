-- Vilka avtalsuppgifter ett tillägg faktiskt ändrar.
--
-- Sammanfattningen är fri text. Utan en strukturerad lista kunde den påstå att
-- ett belopp ändras medan värdet låg kvar - och parterna godkänna en text som
-- inte motsvarade vad tjänsten sedan räknade på.
--
-- Listan skrivs av servern ur den faktiska skillnaden mellan gällande och ny
-- avtalsversion, aldrig av klienten. Anger den som registrerar en egen lista
-- måste de två stämma exakt, annars avvisas tillägget.
alter table agreement_addenda
  add column changed_fields text[] not null default '{}';

comment on column agreement_addenda.changed_fields is
  'Avtalsfält som tillägget ändrar, härlett på servern ur skillnaden mellan avtalsversionerna.';
