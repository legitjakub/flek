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
| `20260913145524_demo_offer_refresh.sql`, `…145627_…_spread.sql` | denní obnova demo FLEKů na 3 dny dopředu (`flek-demo-refresh`, jen podniky s účty `@flek.test`) |
| `20260913145931_read_models_only.sql` | anon nečte tabulky `businesses/services/offers`, jen čtecí RPC; analytika zaokrouhlená a mazaná po 180 dnech; limity délek a allowlist adres fotek |
| `20260913150229_admin_audit_log.sql` | neměnný audit log admin změn a RPC `admin_audit_log` |
| `20260913154845_stripe_payments.sql` | Stripe Connect: sloupce účtu podniku a platby, fronta vratek přes `pg_net`, RPC pro webhook (service role), `flek-stripe-maintenance` |
| `20260913160245_payments_mode.sql` | `payments_mode()` — testovací režim pro text u platby |
| `20260913170235_payments_stripe_only.sql` | jen Stripe: `start_payment` bez demo, `demo_confirm_payment` zrušená, demo obnova jen u podniků s aktivním Stripe |
| `20260913193637_booking_notifications.sql` | upozornění na rezervace: inbox `notifications`, preference, push předplatná, fronta `private.notification_delivery`, trigger `booking_notification`, cron `flek-notification-delivery` |
| `20260913202903_notification_delivery_fixes.sql` | pracovník doručování ověřovaný proti tajnému klíči v databázi, volání jen při splatné zprávě, upozornění mizí s rezervací a podnikem |

## Ověření a otevřené body

- Jednotkové testy a build s TypeScriptem běží v GitHub Actions (`.github/workflows/ci.yml`) při každém pushi; aktuální počet ukazuje CI. Vite upozorňuje na velikost mapového balíčku.
- Bezpečnostní hlavičky (CSP, nosniff, Referrer-Policy, Permissions-Policy, zákaz rámů) jsou ve `vercel.json`. Průchod feedu, detailu, mapy, zapomenutého hesla, Realtime podniku, skeneru QR, hledání adresy a auditu v administraci proběhl s CSP bez jediného porušení (13. 9. 2026).
- Produkční build prošel klikacím testem v systémovém Chrome při 375, 390, 430 a 1365 px: služba → nabídka → feed/mapa/detail → platba → potvrzení/historie a upozornění podniku ve druhém okně. Žádné horizontální přetečení ani chyby JavaScriptu; Realtime 881 ms a polling bez WebSocketu 29 013 ms.
- 100 akceptačních kontrol proti reálným JWT a hostované databázi prošlo, včetně posledního místa, opakování stejné platby, výpočtu poplatku a Realtime pouze pro vlastní podnik.
- `tests/pilot-maintenance.sql` prošel proti hostované databázi: hranice 24 hodin / 30 minut, neměnný finanční snímek, zachování výplaty při nedostavení, staré ceny a oprávnění. Testovací transakce se celá vrací zpět.
- Lokální integrační sada potřebuje běžící Docker/Supabase; v tomto prostředí neběžela. Typy aplikace jsou ručně spravované, nevyměňovat je přímo za generovaný soubor.
- Názvy souborů v `supabase/migrations/` odpovídají verzím v hostované tabulce `supabase_migrations.schema_migrations` (sladěno 13. 9. 2026 podle názvu, včetně pořadí `photo_matches_activity` před `google_place_ratings`, jak se skutečně aplikovaly). `supabase db push` proto již aplikované migrace nespustí znovu. Novou migraci po aplikaci přes MCP pojmenujte podle verze, kterou databáze zapsala.
- Platby jdou přes Stripe Connect v testovacím režimu (Edge Functions v `supabase/functions`, klíče v Supabase secrets). Ostrý režim, události Accounts v2 a účetní doklady jsou otevřené, viz `LIMITATIONS.md`. Integrační sada nově potvrzuje platbu přes `stripe_payment_succeeded` (náhrada webhooku), lokálně zatím neběžela.

Podrobné důkazy jsou v [VERIFICATION.md](../VERIFICATION.md), omezení v [LIMITATIONS.md](../LIMITATIONS.md), technická rozhodnutí v [DECISIONS.md](../DECISIONS.md) a historické předání v [HANDOFF.md](../HANDOFF.md).

## Historie posledních změn

| Datum | Změna | Stav |
| --- | --- | --- |
| 13. 9. 2026 | Push upozornění připravená: `VAPID_PRIVATE_KEY` doplněný v Edge Function secrets | otisk SHA256 sedí se souborem klíčů, `notification-delivery` vrací 200; skutečný push na telefonu zatím nevyzkoušený |
| 13. 9. 2026 | E-mailová upozornění zapnutá: `NOTIFICATION_FROM` a `VAPID_PUBLIC_KEY` v Edge Function secrets | `notification-delivery` vrací 200; zkušební upozornění i obnova hesla doručené přes Resend (Delivered); push čeká na `VAPID_PRIVATE_KEY` |
| 13. 9. 2026 | Nová paleta „Mandarinka“ místo olivové: tokeny, logo, ikony aplikace (SVG i PNG), mapa, univerzální obrázek služby, manifest, e-mailové šablony (repozitář i Supabase) a e-maily upozornění | build, 84 unit testů, snímky 390 px (feed, mapa, profil, partner), WCAG AA pro text |
| 13. 9. 2026 | Dokončení práce ChatGPT (Codex): olivová paleta včetně loga a PNG ikon, univerzální obrázek `flek-placeholder.svg`, kompaktní náhled na mapě, české e-maily a obnova hesla odkazem s `token_hash` (funguje i v jiném prohlížeči), Supabase Auth na www.app-flek.eu přes SMTP Resend, upozornění na rezervace (zvonek, e-mail, Web Push, nastavení pro zákazníka i podnik). Opraveno: doručování končilo 401, cron volal funkci naprázdno, chybějící cascade, tykání v push textu | migrace a funkce v produkci; build, 84 unit testů, 99/99 akceptačních kontrol, UI na 375/390/1280 px; doména v Resendu ověřená; e-mail a push upozornění čekají na Edge secrets `NOTIFICATION_FROM` a VAPID |
| 13. 9. 2026 | Stripe Connect, všude jen Stripe: Checkout s destination charge a application fee, webhook zaplatí a obsadí místo (nebo zařadí vratku), vratky přes `stripe-refunds`, účty podniků přes Accounts v2 (`recipient`), sekce „Platby a výplaty“ a krok v checklistu, testovací účty 16 demo podniků, demo platby odstraněny | migrace a funkce v produkci; build, unit testy, akceptační kontroly se skutečnými testovacími platbami Stripe |
| 13. 9. 2026 | Fáze A auditu: denní obnova demo FLEKů, veřejná data jen přes čtecí RPC, bezpečnostní hlavičky s CSP, audit log admina, zapomenuté heslo, odolnější error boundary, analytika bez přesné polohy a s retencí, CI a secret scanning, oprava popisu a vysvětlení řazení | migrace v produkci; 100/100 akceptačních kontrol, build, unit testy, CSP průchod v prohlížeči |
| 13. 9. 2026 | `docs/NOTION.md` (todolist, fáze, jak to funguje, kde co běží) vložený do Notionu; `AGENTS.md` a `CLAUDE.md` jako vstupní bod pro AI agenty; `HANDOFF.md` označený jako zastaralý | ověřeno proti kódu, Supabase (cron, Edge Functions, advisor) a stránce v Notionu |
| 13. 9. 2026 | Nový vzhled zákaznické appky: profil v barevných blocích se seznamem nastavení, celoobrazovková mapa s fotkami služeb ve špendlících, shluky s přiblížením a náhledovou kartou, plovoucí spodní navigace, nové Oblíbené a Rezervace | implementováno; typy, 81 unit testů, build a Playwright audit (kontrast, 44px, přetečení) na 375/390/1280 px |
| 13. 9. 2026 | Audit rolí: zrušené rezervace u podniku bez „Vy dostanete“ a sbalené pod platnými, stav nabídky jako barevný štítek, detail nabídky vede na další termíny v podniku, jasnější prázdné stavy a větší dotykové plochy; migrace sladěné s hostovanou historií | ověřeno v prohlížeči, 77 testů, build |
| 13. 9. 2026 | Dokončení Claudeova pilotu: cenový model, bezpečné opakování a vratky, automatické dokončení a upozornění podniku | implementováno; databáze a 100 API kontrol ověřeny |
| 11. 9. 2026 | Partner, zákazník a admin zobrazují odděleně cenu zákazníka, výplatu podniku a výnos FLEK; přidané vysvětlení peněz při registraci podniku | implementováno, build prochází |
| 9.–10. 9. 2026 | Intro pro první anonymní návštěvu, snap carousel na mapě a ve výběru fotek, galerie podle konkrétní aktivity, Google Places hodnocení a ilustrační fotografie | implementováno v repozitáři; akceptační průchod je stále ruční |
| 7.–8. 9. 2026 | Základní zákaznický, partnerský a admin tok, rezervace s QR, RLS, PostGIS vyhledávání, platby a storno | implementováno a popsáno ve VERIFICATION.md |

Při další změně přidejte jeden řádek s datem, stručným dopadem na uživatele a stavem ověření. Historie nemá nahrazovat Git; slouží jako rychlý kontext pro produkt a další AI.

## Jak tento přehled udržovat

Po každé změně aktualizujte datum a příslušnou část tohoto souboru. Do části „Aktuálně implementované“ patří jen kód, který je v repozitáři; do „Ověření a otevřené body“ patří vše, co ještě nebylo spuštěné nebo zkontrolované na cílovém prostředí. Pro technické podrobnosti odkazujte na konkrétní soubor či migraci místo kopírování celé implementace.

Pro Notion je tento Markdown kanonický export. Synchronizační skript je `scripts/sync-notion.mjs`; jeho použití je popsáno v [README.md](../README.md).
