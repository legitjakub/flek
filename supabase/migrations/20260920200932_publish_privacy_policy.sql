/*
 * Zásady ochrany osobních údajů se zveřejňují: Jakub poslal údaje provozovatele.
 *
 * Aplikace veřejně sbírá e-mail, jméno, telefon a přibližnou polohu, takže informace o zpracování
 * patří k dispozici hned — GDPR ji váže na okamžik sběru, ne na to, jestli už existuje firma.
 * Správcem může být fyzická osoba, IČO k tomu potřeba není.
 *
 * Obchodní podmínky (zákaznické i pro podniky) zůstávají schované: ty předpokládají podnikatele
 * a čekají na IČO. Klient to odlišuje dvěma prahy — `privacyPublished` a `legalPublished`.
 */
insert into private.settings (key, value) values
  ('operator_name', 'Jakub Hrnčíř'),
  ('operator_address', 'Sinkulova 25, 147 00 Praha 4'),
  ('support_email', 'jakub@app-flek.eu')
on conflict (key) do update set value = excluded.value;

-- Verze 1.0 zásad platí od teď; podmínky si účinnost nechají prázdnou, dokud nebude IČO.
update public.legal_documents set effective_at = now()
where kind = 'privacy' and version = '1.0' and effective_at is null;
