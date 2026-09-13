# FLEK — živý přehled projektu

> Poslední kontrola: 13. 9. 2026
> Zdroj pravdy: repozitář FLEK v této složce. Tento soubor shrnuje stav produktu; technické detaily a akceptační důkazy zůstávají v odkazovaných dokumentech.

## Co FLEK řeší

FLEK je český marketplace pro volnou kapacitu služeb na poslední chvíli. Zákazník najde blízký volný termín, vidí konečnou cenu, zaplatí v aplikaci a v provozovně ukáže rezervační kód. Podnik zveřejní prázdný termín, určí částku, kterou chce za místo dostat, a FLEK k ní připočte servisní poplatek pro zákazníka.

Pilot používá češtinu, CZK a časovou zónu `Europe/Prague`. Praha je seed a výchozí místo ukázky, město ale není zadrátované v doméně.

## Přístupy a hlavní obrazovky

| Role | Vstup | Co může dělat |
| --- | --- | --- |
| Zákazník | `/` → `/mapa`, `/nabidka/:id`, `/rezervace`, `/oblibene`, `/profil` | hledat termíny, procházet mapu, rezervovat a zaplatit, zobrazit voucher/QR, spravovat oblíbená místa a profil |
| Podnik | `/partner` | spravovat provozovnu, připravené i vlastní služby, zveřejňovat FLEKy, sledovat rezervace a metriky, ověřit kód zákazníka |
| Admin | `/admin` | schvalovat provozovny, kontrolovat nabídky a rezervace, spravovat uživatele a metriky pilotu |

Demo účty a jejich omezení jsou v [README.md](../README.md). Produkční hesla nejsou součástí repozitáře.

## Aktuálně implementované části

### Objevování a mapa

- Hodnocení z Google Places je v kódu hotové (Edge Function `google-place-rating` a komponenta na kartě), **v produkci ale neaktivní**: funkce není v Supabase nasazená, chybí `GOOGLE_MAPS_API_KEY` a žádný podnik nemá Place ID (ověřeno 13. 9. 2026). Karty proto hodnocení neukazují a falešné se nedoplňuje. Zapnutí: klíč s billingem → `supabase secrets set GOOGLE_MAPS_API_KEY=…` → `supabase functions deploy google-place-rating` → Place ID u podniků v administraci. Každé zobrazení karty volá Places API bez cache, s rostoucím provozem to poroste i v nákladech.
- Klik na samostatnou cenu na mapě otevře přímo konkrétní aktivitu. Skupina více termínů otevře spodní panel.
- Spodní panel má horizontální snap carousel, číslování, šipky a odkaz na detail každé aktivity. Každá karta se zarovnává na celou šířku, takže není potřeba „přeswipovat“ několik karet najednou.
- Mapa má ovládání „Moje poloha“, seznamový režim a krátkou nápovědu. Mapové markery jsou skupinované podle provozovny/místa.

### První návštěva

- Anonymní návštěvník na `/` dostane jednorázové tříkrokové intro uložené v `localStorage`.
- Intro vysvětluje princip volného termínu, cenu a rezervaci. Obsahuje ilustrativní pražské fotografie a žádná falešná jména podniků.
- Respektuje `prefers-reduced-motion`; poslední krok vede na objevování.

### Služby a fotografie pro podnik

- Při založení služby jsou nejdříve připravené názvy podle kategorie, potom možnost „Vlastní služba“.
- Po výběru šablony lze upravit název, délku, běžnou cenu a popis.
- Galerie je vázaná na konkrétní aktivitu (např. padel, tenis, squash, badminton, osobní trénink), takže se nemíchají nesouvisející sportovní fotky.
- Výběr fotky používá snap carousel s šipkami, indikátorem pozice a jedním velkým náhledem. Ilustrační fotografie mají nenápadný textový štítek.

### Zveřejnění FLEKu a cena

Cenový model v1 je implementovaný a ověřený v hostovaném Supabase projektu. Příklad: běžně 1 000 Kč, podnik 750 Kč, servisní poplatek 38 Kč, zákazník 788 Kč a úspora 21 %. Staré nabídky a rezervace zůstávají ve verzi 0 bez dodatečného poplatku.

- Podnik zadává částku, kterou chce dostat (`merchant_price_cents`).
- Server vypočítá servisní poplatek: 5 % zaokrouhlených na celé koruny, minimálně 25 Kč a maximálně 149 Kč.
- Zákazník vidí a platí `deal_price_cents = merchant_price_cents + service_fee_cents`.
- V nabídce se ukládá verze cenové politiky; finanční snapshot rezervace je po vytvoření neměnný.
- Zveřejnění hlídá čas, kapacitu, minimální úsporu a kolize termínů. Předchozí cenu podniku a kapacitu si služba pamatuje pro další FLEK.
- Partner vidí odděleně „Vy dostanete“ a „Zákazník uvidí“; zákaznické obrazovky zůstávají all-in.

Job `flek-maintenance` je aktivní a běží každých 15 minut: dokončí rezervace 24 hodin po konci a vrátí ukázkové platby bez rezervace starší než 30 minut. Při kontrole 13. 9. byly poslední tři běhy úspěšné; při kontrole nezůstala žádná zaplacená platba bez rezervace ani prošlá nedokončená rezervace. Vracení je zatím změna stavu demo platby, nikoliv volání skutečné banky.

Podnik dostává upozornění přes Realtime a záložní dotaz každých 30 sekund. Upozornění i odznak jsou oddělené podle přihlášeného uživatele a provozovny; odhlášení je vymaže. Otevření rezervací odznak zhasne. Aplikace neodesílá push, SMS ani e-mail při zavřené aplikaci.

## Doménová pravidla, která se nesmí obcházet

- `sold_out` a `expired` se neukládají jako konkurenční stavy; dostupnost se odvozuje přes `offer_is_bookable(...)`.
- Kapacitu mění pouze serverová RPC s podmíněným aktualizováním. Klient nesmí zapisovat `capacity_remaining`.
- Opakované i souběžné volání se stejnou platbou vrátí stejnou rezervaci a odečte jediné místo. Zámek zákazníka, druhá kontrola po získání zámku a unikátní indexy chrání kapacitu i kód.
- Všechny peníze jsou celočíselné haléře; časová způsobilost se rozhoduje pomocí PostgreSQL `now()`.
- Google Place ID je jediný údaj uložený v databázi; samotné hodnocení se načítá živě a bez cache v klientovi.
- Vlastní nahrávání veřejných fotografií partnerem není v první verzi povoleno.

## Databáze a architektura

Frontend je React 19 + TypeScript + Vite, Tailwind v4, TanStack Query, MapLibre GL a Supabase. Supabase zajišťuje Auth, PostgreSQL, PostGIS, Storage, RLS a serverové RPC. Čtecí modely jsou vystavené jako pohledy/RPC; finanční a kapacitní zápisy jdou přes `security definer` funkce.

Nejdůležitější migrace:

| Migrace | Účel |
| --- | --- |
| `20260907215051`–`20260907215349` | schéma, rezervace, partner, dotazy, Storage a metriky |
| `20260907220149`–`20260908180956` | serverový čas, denní části, hodnocení, platby a storno lhůty |
| `20260908182847`–`20260909213817` | oblíbená místa, růstová smyčka, galerie, fotografie bez tváří, Google Places a stránka podniku |
| `20260909234559_service_gallery_images.sql` | katalog ilustračních fotografií podle aktivity |
| `20260910005253_business_billing.sql` | podklady pro účtování podniku |
| `20260911161109_service_fee_v1.sql` | cenový model v1, finanční snapshoty, nové sloupce a `publish_flek` |
| `20260911161149_maintenance_cron.sql` | periodická údržba plateb a starých rezervací |
| `20260912222313_pilot_booking_reliability.sql` | souběžné opakování rezervace, bezpečné zamykání vratek, neměnnost nabídky i po stornu |
| `20260913085542_pilot_completion_read_models.sql` | metriky čekajícího dokončení podle konce rezervace + 24 h |

## Ověření a otevřené body

- 77 jednotkových testů prošlo; `npm run build` včetně TypeScriptu prošel. Vite upozorňuje na velikost mapového balíčku.
- Produkční build prošel klikacím testem v systémovém Chrome při 375, 390, 430 a 1365 px: služba → nabídka → feed/mapa/detail → platba → potvrzení/historie a upozornění podniku ve druhém okně. Žádné horizontální přetečení ani chyby JavaScriptu; Realtime 881 ms a polling bez WebSocketu 29 013 ms.
- 100 akceptačních kontrol proti reálným JWT a hostované databázi prošlo, včetně posledního místa, opakování stejné platby, výpočtu poplatku a Realtime pouze pro vlastní podnik.
- `tests/pilot-maintenance.sql` prošel proti hostované databázi: hranice 24 hodin / 30 minut, neměnný finanční snímek, zachování výplaty při nedostavení, staré ceny a oprávnění. Testovací transakce se celá vrací zpět.
- Lokální integrační sada potřebuje běžící Docker/Supabase; v tomto prostředí neběžela. Typy aplikace jsou ručně spravované, nevyměňovat je přímo za generovaný soubor.
- Názvy souborů v `supabase/migrations/` odpovídají verzím v hostované tabulce `supabase_migrations.schema_migrations` (sladěno 13. 9. 2026 podle názvu, včetně pořadí `photo_matches_activity` před `google_place_ratings`, jak se skutečně aplikovaly). `supabase db push` proto již aplikované migrace nespustí znovu. Novou migraci po aplikaci přes MCP pojmenujte podle verze, kterou databáze zapsala.
- Připojení skutečné platební brány, skutečné výplaty a účetní doklady zůstávají mimo tento pilot. UI u placení výslovně uvádí ukázkový režim.

Podrobné důkazy jsou v [VERIFICATION.md](../VERIFICATION.md), omezení v [LIMITATIONS.md](../LIMITATIONS.md), technická rozhodnutí v [DECISIONS.md](../DECISIONS.md) a historické předání v [HANDOFF.md](../HANDOFF.md).

## Historie posledních změn

| Datum | Změna | Stav |
| --- | --- | --- |
| 13. 9. 2026 | Dokončení Claudeova pilotu: cenový model, bezpečné opakování a vratky, automatické dokončení a upozornění podniku | implementováno; databáze a 100 API kontrol ověřeny |
| 11. 9. 2026 | Partner, zákazník a admin zobrazují odděleně cenu zákazníka, výplatu podniku a výnos FLEK; přidané vysvětlení peněz při registraci podniku | implementováno, build prochází |
| 9.–10. 9. 2026 | Intro pro první anonymní návštěvu, snap carousel na mapě a ve výběru fotek, galerie podle konkrétní aktivity, Google Places hodnocení a ilustrační fotografie | implementováno v repozitáři; akceptační průchod je stále ruční |
| 7.–8. 9. 2026 | Základní zákaznický, partnerský a admin tok, rezervace s QR, RLS, PostGIS vyhledávání, platby a storno | implementováno a popsáno ve VERIFICATION.md |

Při další změně přidejte jeden řádek s datem, stručným dopadem na uživatele a stavem ověření. Historie nemá nahrazovat Git; slouží jako rychlý kontext pro produkt a další AI.

## Jak tento přehled udržovat

Po každé změně aktualizujte datum a příslušnou část tohoto souboru. Do části „Aktuálně implementované“ patří jen kód, který je v repozitáři; do „Ověření a otevřené body“ patří vše, co ještě nebylo spuštěné nebo zkontrolované na cílovém prostředí. Pro technické podrobnosti odkazujte na konkrétní soubor či migraci místo kopírování celé implementace.

Pro Notion je tento Markdown kanonický export. Synchronizační skript je `scripts/sync-notion.mjs`; jeho použití je popsáno v [README.md](../README.md).
