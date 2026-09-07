# Ověření FLEK

Průběžný pracovní záznam. Nejde o prohlášení o dokončení.

## Aktuálně provedené kontroly

- `npm run test:unit`: **6/6 prošlo**, 7. 9. 2026. Praha přes půlnoc, nezávislost na UTC dni, neexistující březnový čas, dvojí říjnový čas, 23/25hodinový den, celá čísla pro peníze.
- `tsc --noEmit`: bez chyb pro dosud vytvořený zdrojový kód a testy.
- Integrační testy: napsané, **dosud nespouštěné**; čekají na skutečný Supabase runtime.

## Akceptační kritéria

| Kritérium | Důkaz / stav |
|---|---|
| 1. Registrace obchodníka → provozovna čeká | RPC create_business implementováno; UI a e2e čeká |
| 2. Admin schválí provozovnu | RPC admin_set_business_status implementováno; e2e čeká |
| 3. Vytvoření služby | RPC save_service implementováno; e2e čeká |
| 4. Publikace pod 30 sekund | RPC publish_offer implementováno; měření čeká |
| 5. Objevení nabídky se vzdáleností a slevou | search_offers používá PostGIS; skutečný běh čeká |
| 6. Registrace zákazníka, telefon, rezervace a kód | RPCs připraveny; UI a e2e čeká |
| 7. Poslední místo a souběh | Pojmenované integrační testy napsané; běh čeká |
| 8. Vyhledání kódem a docházka | Merchant RPCs připraveny; běh čeká |
| 9. Historie zákazníka | my_bookings implementováno; UI čeká |
| 10. Výnos a fill rate | Čeká po P0 |
| 11. Kapacita 2 odmítne třetí rezervaci | Souběžné testy kapacity 1/5 napsané; e2e čeká |
| 12. Zrušení vrací kapacitu do vyhledávání | Integrační test napsaný; běh čeká |
| Produkční build | Čeká na implementaci UI |
| RLS, žádný service key v klientu | Politiky napsané; běh a kontrola balíčku čeká |
| Lighthouse 80/90 a responzivita | Neměřeno |
| Obnovení stránky, klávesnice, chybové stavy | Neověřeno |
