/*
 * Obchodní podmínky 1.1: hodnocení (audit 28. 9., nález M5).
 *
 * Verze 1.0 tvrdila „Hodnocení podniků zatím nezveřejňujeme“, ale stránka podniku ukazuje ověřená
 * hodnocení od 21. 9. Verze 1.1 popisuje, kdo smí hodnotit, co se zveřejní a jak se text kontroluje.
 * Podmínky zatím nejsou v účinnosti (čekají na IČO), proto i 1.1 zůstává bez `effective_at`;
 * migrace, která podmínky zveřejní, nastaví účinnost nejnovější verzi.
 */
insert into public.legal_documents (kind, version) values ('customer_terms', '1.1');
