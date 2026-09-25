# Ověření FLEK

## Vlastní fotografie služby má přednost — 20. 9. 2026

- `serviceIllustration` vrací uloženou `services.image_url` dřív než fotografii aktivity, kategorie i univerzální FLEK. Unit test používá skutečný tvar veřejné Storage URL a ověřuje, že se nezamění za ilustrační fotografii.
- Partner má v editoru služby ovladač „Nahrát fotku“ pro JPG, PNG a WebP do 5 MB. Soubor se ukládá do `covers/{business_id}/services`; existující Storage RLS dovolí zápis jen členovi dané provozovny. Uložení služby je během uploadu zamčené.
- Označení „ilustrační foto“ se počítá podle zdroje: katalog FLEKu a starší stock fotografie ano, vlastní Storage URL a fotka provozovny ne. Stejné pravidlo používá Objevit, náhled na mapě, detail nabídky a obě partnerské obrazovky.
- Produkční partnerský editor zkontrolovaný v přihlášeném Chromu při viewportu 380 × 842 px: upload má 44px dotykovou výšku, pravý okraj 347 px, stránka nemá horizontální přetečení a input přijímá přesně `image/jpeg,image/png,image/webp`.
- `npm run build` a `npm run test:unit`: 151/151 testů. GitHub kontrola typů/build/testů, Supabase Preview a Vercel nasazení commitu `b430df2` doběhly úspěšně.

## Aktivní fotky a rozšířený demo katalog — 20. 9. 2026

- Migrace `refresh_activity_photos_and_demo_services` proběhla před nasazením celá v transakci s rollbackem proti hostované databázi. Kontroly uvnitř stejné transakce potvrdily 37 katalogových aktivit, 24 nových služeb jen u provozoven vlastněných výhradně účty `@flek.test` a žádnou aktivní službu s chybějícím, Unsplash nebo starým `/images/services` obrázkem.
- Po nasazení je účinná migrace v produkci jako `20260920210547`: všech 37 katalogových řádků a všech 60 aktivních služeb míří do `/images/activities`, staré i chybějící zdroje mají nulový počet. Nových 24 služeb vytvořilo 128 budoucích zveřejněných FLEKů. Supabase eviduje také verzi `20260920164139` z transakčního dry runu; lokální no-op soubor ji zachovává, aby preview databáze neměla rozpadlou historii.
- Reálné obrázky nahrané podnikem do Supabase Storage se nemění. Ukázkové provozovny dostávají odpovídající obálku a `private.flek_demo_refresh(3)` připraví nabídky nových služeb na tři dny dopředu.
- Statická kontrola knihovny: 74 originálů 1254 × 1254 px, ke každému 800px a 176px derivát; celkem 222 JPG souborů. Po sloučení s nejnovějším `main` prošel `npm run build` a `npm run test:unit` (150 testů). Vercel nasazení commitu `c9b7819` doběhlo úspěšně a produkční doména vrací nový obrázek půjčení kola s HTTP 200.

> Aktuální ověření pilotu z 13. 9. 2026 je v poslední sekci tohoto dokumentu. Starší sekce zachycují tehdejší stav, nikoliv aktuální omezení.
Stav k 8. 9. 2026. Každý řádek říká, čím je doložený.

Migrace i seed byly aplikované na **skutečný hostovaný PostgreSQL 17 s PostGIS** (Supabase, eu-west-1) a akceptační průchod proti němu proběhl přes veřejné API se **skutečnými JWT a zapnutou RLS**, bez service-role klíče. Docker na tomto počítači není, takže `npm test` (integrační sada přes lokální Supabase) nespouštěné zůstává — jeho obsah ale pokrývá `npm run test:acceptance`, viz níže.

## Akceptační běh proti skutečné databázi

`npm run test:acceptance` — **34/34 prošlo**, opakovaně spustitelné (skript si nabídky sám zveřejní přes `publish_offer` a na konci je zruší).

| Kontrola | Výsledek |
| --- | --- |
| capacity=1, **10 souběžných uživatelů** | právě **1 rezervace**, 9× `OFFER_UNAVAILABLE`, žádný oversell |
| capacity=5, 10 souběžných volání | právě **5** rezervací |
| Dvojité klepnutí téhož uživatele | 1 rezervace, druhé volání `ALREADY_BOOKED` |
| Vyprodaná nabídka | okamžitě `bookable=false` a mizí z vyhledávání |
| Zrušení rezervace | kapacita zpět, nabídka znovu v prodeji — bez jakéhokoli cronu |
| Rezervační kód | tvar `FLEK-XXXXXX`, abeceda bez zaměnitelných znaků |
| Zákazník vs. cizí data | nevidí cizí rezervace ani cizí profil |
| Přímý zápis `capacity_remaining` | `permission denied for table offers` |
| Přímý insert do `bookings` | `permission denied for table bookings` |
| Partner vs. cizí provozovna | `merchant_metrics` cizímu `FORBIDDEN`, cizí kód nenalezen |
| Identita zákazníka | v seznamu jen „Tereza N.", telefon až v detailu vlastní potvrzené rezervace |
| `Nedorazil` před začátkem | `TOO_EARLY` |
| Admin funkce neadminovi | `FORBIDDEN`; `analytics_events` nepřečte |
| Anonym | nevidí neschválené provozovny ani žádné rezervace |
| Vyhledávání | 33 nabídek, žádná nedostupná; nese průměr hodnocení i jeho počet |
| Hodnotit smí jen ten, kdo dorazil | vlastní dokončená ✓, nedokončená `NOT_RATEABLE`, cizí `FORBIDDEN`, mimo rozsah `VALIDATION_ERROR`, hodnocení se propíše zpět |

Ověřeno navíc přímo v databázi: seed nahrán (15 provozoven, 30 služeb, 38 nabídek, 11 rezervací ve všech pěti stavech), trigger `handle_new_user` zakládá profily, PostGIS vzdálenosti a skóre `search_offers` odpovídají, filtr denní doby řeže podle **pražských** hodin (ráno 24 nabídek do 11:30, odpoledne 8 mezi 12:00 a 15:30).

## Nasazená ukázka

Nasazeno na <https://flek-nine.vercel.app> (produkční build, hostovaný Supabase, automaticky z `main`). Ověřeno po nasazení: domovská stránka, `/mapa`, `/partner`, `/admin`, hluboký odkaz na detail i neznámá cesta vrací 200 (SPA přepis funguje), assety mají roční cache, service-role klíč v balíčku není, 17 nabídek ve třech sekcích, žádný vodorovný posun, všechny čtyři položky spodní navigace dosažitelné a žádná chyba v konzoli. **Lighthouse na produkci: objevování 82/100, detail nabídky 85/100.**

Demo hesla byla před zveřejněním otočena; stará přestala platit, administrátorský účet má vlastní.

## Ostatní kontroly

| Kontrola | Výsledek |
| --- | --- |
| `npm run test:unit` | **6/6 prošlo** — Praha přes půlnoc, nezávislost na UTC dni, neexistující březnová 02:30, dvojí říjnová 02:30, 23‑ a 25hodinový den, celočíselné peníze |
| `npx tsc --noEmit` | bez chyb |
| `npm run build` | projde; MapLibre je vydělený a načítá se až na obrazovkách s mapou |
| **Lighthouse** (produkční build, stránky se skutečnými daty **včetně fotografií**) | Objevování **výkon 81, přístupnost 100**; detail nabídky **výkon 81, přístupnost 100**. CLS 0. Obojí nad prahem (≥ 80 / ≥ 90), ale výkon má jen malou rezervu — viz poznámka níže. |
| Service-role klíč v balíčku | jediná shoda `service_role` je naše vlastní pojistka, která takový klíč odmítne |
| Vodorovný posun | žádný na 375, 768 ani 1280 px |
| Trasy v prohlížeči | `/`, `/prihlaseni`, `/rezervace`, `/partner`, `/admin`, detail nabídky i neznámá cesta bez chyb v konzoli |
| Filtry end-to-end v aplikaci | volba „Odpoledne" zúžila 30 → 8 nabídek, všechny 12:00–16:59 |
| Řídký inventář | 16 nabídek dá tři sekce; po zúžení na 4 se obrazovka přeskládá do jednoho seznamu a **žádná sekce nezůstane prázdná** |
| Karta | Kompaktní časový řádek, živý odpočet a cena bez velké barevné nálepky; interní demo hodnocení se veřejně nezobrazuje |
| Publikace termínu partnerem | dvě klepnutí (sleva → zveřejnit), sheet se zavře sám, potvrzení na stránce; při překryvu se z tlačítka stane „Zveřejnit i tak" |

## Chyby nalezené a opravené při ověřování

1. Cache dotazů se mazala při každé události přihlášení včetně úvodní — zahazovalo to probíhající dotazy a obrazovka zůstala navždy v načítání.
2. TanStack Query ve výchozím režimu výpadek sítě jen pozastaví; zákazník by při ztrátě spojení viděl nekonečný skeleton a zaseknuté „Potvrdit rezervaci". Nastaveno `networkMode: 'always'`.
3. `server_clock` byla jediná funkce bez pevného `search_path` — odhalil databázový linter po nasazení. Opraveno migrací `202609080007`.
4. Neaktivní položky segmentovaného ovladače měly kontrast 4,48:1, těsně pod AA. Tlumená barva ztmavena na `#5d6a68`.
7. Registrace povolovala prázdné příjmení, ale rezervační formulář ho vyžadoval — zákazník registrovaný jen s křestním jménem narazil na chybu u pole, které potvrzovací text nezmiňuje. Sjednoceno na nepovinné.
8. `customer_booking_details` vznikl před sloupcem `rating`, takže ho neobsahoval a hodnocení se nevracelo do aplikace. Pohled přestavěn migrací `202609080010`.
9. `Zopakovat nabídku` navrhovalo čas „za 30 minut" místo stejné denní doby, takže zopakovat zítřejší osmnáctou hodinu nešlo jedním klepnutím.
10. Editace nabídky startovala z prázdných polí; uložení bez zásahu prošlo jako úspěch, ačkoli neposlalo žádnou změnu.
5. Odznak „Začíná za…" měl na světlém tyrkysovém podkladu 4,29:1. Akcentní barva ztmavena na `#0a6a62`; obě stránky mají přístupnost 100.
6. Detail nabídky platil při načtení za celý balík MapLibre, přestože mapa je pod ohybem stránky. Mapa se teď načte, až se doroluje do zorného pole — výkon 80 → 88.

## Akceptační kritéria ze sekce 17

| # | Kritérium | Stav |
| --- | --- | --- |
| 1–3 | Registrace partnera → schválení adminem → služba | RPC ověřené během; ruční průchod UI neproveden |
| 4 | Zveřejnění pod 30 sekund | `publish_offer` ověřeno během; **čas nezměřen** |
| 5 | Zákazník vidí nabídku se vzdáleností a slevou | **ověřeno** — aplikace běží nad reálnými daty, vzdálenosti i slevy sedí |
| 6 | Rezervace a kód `FLEK-XXXXXX` | **ověřeno** akceptačním během |
| 7 | Nabídka okamžitě přestane být rezervovatelná | **ověřeno** — 10 souběžných uživatelů, 1 uspěje |
| 8 | Vyhledání podle kódu a docházka | **ověřeno**; `Nedorazil` před začátkem odmítnut |
| 9 | Historie zákazníka | `my_bookings` ověřeno; ruční průchod UI neproveden |
| 10 | Získaná tržba a naplněnost | **ověřeno** — `merchant_metrics` i `admin_metrics` odpovídají |
| 11 | Kapacita 2: třetí odmítnut | **ověřeno** variantou capacity=5 na 10 volání |
| 12 | Zrušení vrátí kapacitu do vyhledávání | **ověřeno** |

### Poznámka k výkonu

Před doplněním fotografií měly obě stránky výkon 88–93. S fotografiemi je to 81. Příčinou není aplikace, ale to, že demo obrázky jdou z cizího hostitele (`images.unsplash.com`) — LCP čeká na DNS, TLS a stažení. Zmenšení na 640 px, `fetchpriority` na první kartě a `preconnect` daly dohromady jen jednotky bodů. Pro pilot patří fotky do Supabase Storage, které aplikace už umí; tím se to vyřeší.

### Co zůstává neověřené

- `npm test` (integrační sada přes lokální Supabase) — chybí Docker. Obsahově ji pokrývá `npm run test:acceptance`.
- Ruční klikací průchod celým UI ve dvou prohlížečích. Prohlížeč v tomto prostředí běží na skryté kartě, kde nejde spolehlivě klikat; ověřeno bylo vykreslení, filtry a čtení stromu stránky.
- Měření času „pod 30 sekund" u zveřejnění nabídky.

---

## Růstová smyčka a skenování QR (9. 9. 2026)

### Ověřené měřením

| Co | Čím |
| --- | --- |
| Pravidla proti zneužití doporučení | Přímo proti hostované databázi: pokus o self-referral skončil `check_violation`, druhý referrer na tentýž účet `unique_violation`, druhá kvalifikace toutéž rezervací `unique_violation`. Všechny tři jsou vynucené constraintem, ne aplikačním kódem. |
| Oprávnění nových RPC | `has_function_privilege` proti `pg_proc`: `set_favorite`, `my_customer_metrics`, `my_referral_code`, `claim_referral`, `my_referral_stats` jen pro `authenticated` a `service_role`; `resolve_referral_code` navíc pro `anon` (vstupní stránka pozvánky musí fungovat před přihlášením); `private.qualify_referral` jen pro `service_role`. |
| Pojmenování důvodu nedostupnosti | 9 jednotkových testů, včetně případů, kdy platí víc faktů zároveň. Helper nikdy neodporuje `bookable` a nikdy netvrdí „chytil", když termín vypršel. |
| Parsování QR | 5 jednotkových testů: celá URL voucheru, holý kód, kód mezi jinými parametry, cizí QR (Wi-Fi, náhodná URL) a podobné, ale neplatné tvary. |
| Vykreslení všech nových stavů | Playwright proti produkčnímu buildu, 390×844: dostupná nabídka, vyprodaná („Tenhle FLEK už někdo chytil."), proběhlá („Tenhle FLEK už proběhl."), platná pozvánka („Jakub tě zve na FLEK."), neplatná pozvánka. Žádná chyba v konzoli. |
| Rozvržení | 375×667, 390×844, 430×932 a 1280×900: nikde vodorovné přetečení, nikde ovládací prvek bez popisku. |
| Zrušená nabídka | Anonymní návštěvník ji nevidí vůbec — `get_offer_detail` ji vrací jen členovi podniku, administrátorovi nebo tomu, kdo na ni má rezervaci. Text o zrušení se proto zobrazí jen tomu, kdo na něj má nárok; to je správné chování RLS, ne chyba. |
| Jednotkové testy | 24/24. `tsc --noEmit` a `vite build` bez chyby. |

### Opraveno během ověřování

- Sekce „Zrušení" se u nerezervovatelné nabídky tvářila, že lhůta pořád platí.
- Rozbalovací „Proč je to levnější?" mělo 20 px místo minimálních 44; po opravě naměřeno 44.
- `find()` v partnerských rezervacích četl kód ze stavu, takže kód doručený a hledaný ve stejném ticku — což je právě sken — by hledal předchozí hodnotu.

### Co ověřené není

- **Akceptační sada.** Rozšířena z 54 na **76 kontrol** (idempotentní sledování, veřejný detail nedostupné nabídky, zákaznické metriky proti `my_bookings`, atribuce doporučení včetně pokusu zavedeného účtu, počet sledujících). **Spuštěna proti hostované databázi: 76/76 prošlo.**

  Skript si adresu projektu a anon klíč bere z `.env.local` sám. Dřív se musely vyexportovat ručně a doporučený příkaz kvůli tomu padal na „Nastavte SUPABASE_URL", přestože obě hodnoty v repozitáři byly. Spuštění je teď jen `npm run test:acceptance`.

  První běh skončil 72/76 a všechny čtyři pády byly chyby v nově psaných kontrolách, ne v chování:
  - Tři kontroly očekávaly u anonymního volání `AUTH_REQUIRED`. Anonym ale na tyhle funkce nemá EXECUTE, takže ho PostgREST odmítne o vrstvu dřív (`42501 permission denied`) a tělo funkce se vůbec nespustí — ochrana je **přísnější**, než tvrdil test. Ověřeno curlem proti `set_favorite`, `my_customer_metrics` a `claim_referral`. Kontroly teď ověřují výsledek (anonymovi se nic nevrátilo), ne konkrétní vrstvu odmítnutí.
  - Jedna kontrola sahala kvůli přehlédnutému přejmenování na obálku odpovědi `merchant_metrics` místo na zákaznické metriky.
- **Živý průchod kamerou.** Skener nebyl vyzkoušen na skutečném zařízení; partnerská část vyžaduje přihlášení demo hesly.
- **Kvalifikace doporučení od konce ke konci.** Databázová pravidla ověřená jsou, celý průchod „pozvánka → registrace → první proběhlá rezervace" ne, protože vyžaduje dokončení rezervace partnerem.
- **Lighthouse** na nových obrazovkách. Dřívější měření (přístupnost 100) se týkalo starší podoby detailu.

## Dokončení pilotu v1 — 13. 9. 2026

### Co bylo skutečně ověřeno

- `npm run test:unit`: **77/77**. Zahrnuje sdílené cenové vektory, hranice poplatku, ochranu před přetečením a izolaci/deduplikaci upozornění podle identity a provozovny. Testy shlukování mapy nebyly měněné.
- `npm run build`: TypeScript i Vite prošly. Zůstává upozornění na velikost samostatného mapového balíčku.
- `npm run test:acceptance`: **100/100** proti hostovanému Supabase, skutečné JWT demo uživatelů a reálné RLS. Deset souběžných zákazníků neobsadí stejné poslední místo; osm souběžných volání se stejnou platbou vrátí jedinou rezervaci a odečte jediné místo. Ověřeno vrácení platby bez místa a odmítnutí cizího přístupu.
- `tests/pilot-maintenance.sql`: prošel na hostovaném PostgreSQL. Testuje přesnou hranici 24 h po konci, čerstvou a osiřelou platbu kolem 30 minut, neměnnost finančního snímku, zachování výplaty při nedostavení, idempotenci údržby, staré ceny a granty. Všechny změny se vracejí transakcí zpět.
- Job `flek-maintenance` aktivní každých 15 minut; poslední tři kontrolované běhy `succeeded`. Kontrola před UI testy: nula zaplacených plateb bez rezervace, nula potvrzených rezervací po lhůtě dokončení.

### Klikací průchod produkčním buildem

Systémový Chrome přes Playwright, viditelné okno, `http://127.0.0.1:5175`. Browser plugin není dostupný; použitý existující Playwright 1.63 bez instalace další závislosti. Vývojové preview 5173 sloužilo prvnímu ladění, konečný běh 5175 neobsahuje HMR. Dočasné skripty a snímky jsou mimo repozitář v `/tmp/flek-pilot-*`.

| Kontrola | Výsledek |
| --- | --- |
| Identita stránky, obsah, žádný framework overlay | PASS — ověřené nadpisy a trasy veřejného partnera, formulářů, detailu, rezervací a metrik |
| Konzole | PASS — závěrečný hlavní průchod neměl chyby JavaScriptu ani chybové konzolové zprávy; očekávaná 400 při odmítnutí ceny se nezaměňuje za chybu vykreslení |
| Mobil a desktop | PASS — 375/390/430/1365 px bez horizontálního přetečení |
| Služba | PASS — zvolená kategorie a šablona, vlastní název, běžná cena, přednastavená i vlastní délka, změna fotky, uložení šablony; další nová služba začíná prázdným formulářem |
| Nabídka | PASS — 980 Kč pro podnik odmítnuto u pole; 750 Kč uloží zákaznických 788 Kč a poplatek 38 Kč, úsporu 21 % |
| Zákazník | PASS — stejných 788 Kč ve feedu, panelu mapy, detailu, checkoutu, potvrzení i rezervacích |
| Podnik ve druhém okně | PASS — nová rezervace bez reloadu za 881 ms, odznak a titul `(1) FLEK Partner`; otevření rezervací odznak vynuluje |
| Výpadek Realtime | PASS — WebSocket záměrně vypnutý, polling přinesl rezervaci za 29 013 ms |
| Změna ceny před placením | PASS — při změně 788 → 735 Kč původní potvrzení nic nezaplatí, platba zůstane pending; až nové potvrzení 735 Kč vydá rezervaci |
| Změna účtu | PASS — odhlášení vymaže upozornění; přihlášení jiného podniku přes skutečný formulář nepřevezme staré oznámení ani odznak |
| Admin | PASS — metriky oddělují výnos FLEK a částky podniků |

Během průchodu opraveno: chybná lhůta pro storno blízkého termínu, duplicitní React klíče odděleného rámce upozornění/obsahu, čistý formulář nové služby, zachování vlastní fotografie u známé šablony a soulad metrik s koncem + 24 hodin. První pokus o měření konzole zachytil chybu pomocného testovacího skriptu na `about:blank`; po omezení inicializace na původ aplikace čistý průchod prošel.

### Nasazené databázové změny a zbývající hranice

Cenový model a cron byly na serveru již od Claudea. Doplňující opravy byly aplikovány přídavnými migracemi; staré soubory nebyly přepsané. Mapování lokálních názvů a časů aplikace MCP je v PROJECT_STATUS.md. Současné metriky označují k automatickému dokončení až rezervace 24 h po konci, nikoliv 24 h po začátku.

Všechny služby, nabídky, platby a rezervace vytvořené pouze klikacími testy byly odstraněny přes přesně zaznamenaná ID. API akceptační sada ruší své nabídky a zanechává zrušenou demo historii. SQL testy se vracejí rollbackem.

Lokální Docker integrační sada, fyzický iPhone/Safari, skutečná kamera, nové měření Lighthouse a nově požadovaný úplný UX audit všech rolí nejsou součástí tohoto dokončeného průchodu. Platby a vratky jsou stále ukázkové; skutečné peníze se nepřevádějí.

## Vratky podle stavu ve Stripe — 14. 9. 2026

- `tests/stripe-refunds.sql` na hostovaném PostgreSQL: PASS. Čekající a `requires_action` vratka nechá platbu `paid`, `succeeded` ji označí `refunded`, pozdní `failed` ji vrátí na `paid` s důvodem, mimo automatickou frontu a se záznamem `refund_failed`. Opakovaná nebo pozdní `succeeded` o selhané vratce nic nezmění, starší vratka nepřepíše novější, neznámý stav je odmítnut, `stripe_refund_done` neexistuje a `anon`/`authenticated` nemají na `stripe_refund_update` právo. Po transakci nezůstal žádný testovací řádek.
- `npm run test:acceptance`: **100/100**. Nová kontrola zaplatí testovací kartou `pm_card_refundFail`, zruší rezervaci a počká, až Stripe vratku zamítne: platba skončila `paid` s `refund_status = failed`, ne `refunded`.
- `private.stripe_events` za běh kontrol: 28× `refund.created`, 28× `refund.updated`, 28× `charge.refunded`, 1× `refund.failed`, 28× `payment_intent.succeeded`, všechny bez chyby.
- `npm run build` a `npm run test:unit` (84/84) prošly, `deno check` všech pěti Stripe funkcí prošel. Supabase security advisor nehlásí nic nového.

## Paleta „Noční ultramarín“ — 14. 9. 2026

- Kontrast výsledných tokenů (skript nad `src/styles.css`): 27 dvojic, všechny splňují WCAG AA. Nejnižší textová dvojice je `warning` na `warning-soft` 5,42 : 1, grafika `brand-bright` na ink 4,12 : 1.
- 57 snímků lokální verze přes Playwright a systémový Chrome na 375, 390 a 1280 px: intro, Objevit, mapa a náhled, detail, stránka podniku, přihlášení, rezervační sheet, profil, oblíbené, rezervace s živým kódem, QR, historie, partner (přehled, provozovna, rezervace, nabídky) a admin. Nikde horizontální přetečení ani chyba v konzoli.
- Hledání zbylých barev Mandarinky (`#f2703f`, `#17181c`, `#f6f5f3`, `#5e616b`, `#b4460f`, `#ffd9c6`, přechod promo bloku, `rgb(242 112 63)`) v `src`, `public`, `index.html`, šablonách a Edge Functions: nic nezůstalo.
- Snímky prošlo 5 nezávislých kontrolorů po skupinách obrazovek, každý nález ověřil další agent. Z 18 nálezů se potvrdilo 11. Opravené barevné: odznak „Platby aktivní“ u partnera měl vzhled značky místo zelené stavové barvy, další nesplněný krok v checklistu partnera měl kroužek s kontrastem 1,2 : 1 (teď `muted`, 6,9 : 1). Červené přeškrtnutí původní ceny zůstává, je to záměr (viz komentář v `Price.tsx`). Potvrzené chyby mapy, které s barvami nesouvisí (překrývání značek, náhled zakryje vybraný špendlík na 375 px, poloprůhledný čip u okraje nad mapou), a osiřelá tečka pod tlačítkem na desktopovém detailu jdou do samostatného úkolu.
- `npm run build` a `npm run test:unit` (84/84) prošly. E-mailové šablony v Supabase uložené a znovu načtené s novými barvami, `notification-delivery` nasazená.


## Potvrzování rezervací a WhatsApp — 15. 9. 2026

- `tests/manual-confirmation.sql` na hostovaném PostgreSQL po všech migracích: PASS. Hranice oken 120/30/15 minut a strop `start − 10 min` (kontrola pro 16–300 minut), demo přepínač a `confirmation_quote`, FLEK za 14 minut nejde rezervovat, hold bere jedno místo a opakovaný start ho nezdvojí, kód není vidět zákazníkovi ani podniku, druhý zákazník poslední držené místo nedostane, duplicitní autorizace je idempotentní a druhý PaymentIntent se uvolní, cizí podnik ani zákazník nerozhodnou, souběh Potvrdit × Potvrdit × Nemohu přijmout × zrušení zákazníkem, capture se správným snímkem (78 800 / 75 000 / 3 800), odmítnutí uvolní a nevrací, rozhodnutí po deadlinu i job vyprší, pozdní capture jde na vratku, zrušení žádosti vrátí místo jednou, kapacita 3 (tři holdy, čtvrtý neprojde, vypršení vrátí jedno místo), pozdní autorizace a neshoda částky uvolní, trvalé selhání capture vrátí místo a pozdější capture vrátí, opuštěný hold nezmrazí nabídku, limit holdů, zrušení nabídky během capture skončí jako zrušení podnikem, zrušení nabídky i pozastavení podniku ukončí žádosti, granty. Vše vráceno rollbackem (po běhu: přepínač `false`, žádný QA podnik ani V1 platba).
- `tests/whatsapp-notifications.sql` na hostované DB: PASS. Normalizace čísel, párování jen pro člena se souhlasem a jen když má FLEK číslo, kód jen jako hash, špatný kód i správný kód z jiného čísla neprojdou, opakované doručení od Meta se ignoruje, žádost založí právě jedno WhatsApp doručení s parametry šablony a tokenem, stav doručení, který přijde dřív než záznam o odeslání, se neztratí a nekrokuje zpět, cizí číslo / podvržený token / rozpor tokenu a textu / neznámá zpráva / neznámé tlačítko nerozhodnou, skutečné klepnutí rozhodne jednou přes `decide_booking` s kanálem `whatsapp`, klepnutí po rozhodnutí v aplikaci a po deadlinu vrátí skutečný stav, ukončená žádost se neodešle, nové spárování i odchod člena zneplatní staré zprávy, vypnutí, limit kódů, analytika bez čísel, granty a tabulky mimo dosah klientů.
- `npm run test:acceptance` v původním režimu (přepínač `false`) po migracích: **101/101**. Skript nově pozná režim podle `confirmation_quote` a v režimu potvrzování projde autorizaci přes `stripe-test-pay`, potvrzení podnikem, souběžné Potvrdit / Nemohu přijmout, osm souběžných potvrzení, souběh potvrzení se zrušením žádosti, odmítnutí bez vratky, zamítnutou kartu a selhanou vratku; ten režim zatím neběžel (čeká na nasazení funkcí).
- `npm run build`, `npm run test:unit` (102/102 včetně stavů zákaznické obrazovky, textů pro podnik, signatury a parseru webhooku WhatsApp) a typová kontrola všech Edge Functions (`tsc` s typy Supabase) prošly. Supabase security advisor: žádný nový druh nálezu (RLS bez politik jen u nových soukromých tabulek, `security definer` jen u členských RPC).
- Prohlížeč (lokální vývojový server, relace vložená do `localStorage`, odpovědi API podvržené v prohlížeči, databáze beze změny): partner na 390 px (banner žádosti s odpočtem a počtem v navigaci, sekce „Vyžadují potvrzení“ na Přehledu a v Rezervacích bez duplicitního banneru, Potvrdit se zpětnou vazbou a zablokovanými tlačítky, počet žádostí u nabídky, vysvětlení oken a párování WhatsApp až po „Zprávy chodí na…“) a 1280 px (žádosti ve dvou sloupcích), zákazník na 375 px (čekající žádost v Rezervacích, stránka po platbě s „Tenhle FLEK začíná brzy…“, Potvrzujeme FLEK…, 🔥 FLEK je tvůj!). Bez horizontálního přetečení a chyb v konzoli. Opraveno při průchodu: tlačítko „Nemohu přijmout“ se na telefonu lámalo do dvou řádků, telefonní čísla se lámala uprostřed, počet v nadpisu počítal i už potvrzené žádosti, banner opakoval žádost nad sekcí se žádostmi, tlačítka zůstala aktivní po odpovědi serveru.
- Neověřeno: skutečný průchod Checkoutem s manual capture (čeká na nasazení `stripe-checkout` a `stripe-webhook`), Apple Pay a Google Pay na telefonu, WhatsApp s účtem Meta, doručení registračního e-mailu přes SMTP.

## Víc časů, doporučení, obrázky a WhatsApp pro všechny — 15. 9. 2026

- Webhook Stripe nasazený pushem (GitHub integrace, `stripe-webhook` v26): `npm run test:acceptance` 101/101 v původním režimu, `private.stripe_events` bez chyb. `stripe-checkout` (v9) a `stripe-test-pay` (v8) nasazené přes MCP.
- Sonda potvrzování (14:46, přepínač na dvě minuty `demo`, nová nabídka demo podniku, zákazník `demo-6`, `stripe-test-pay`): Stripe vrátil `requires_capture`, ale za 45 s nepřišla žádná událost a rezervace zůstala `pending_payment`; nabídka zrušena, přepínač zpět `false`. Události `payment_intent.*` ve Stripe tedy chybí.
- `tests/whatsapp-notifications.sql` na hostované DB po obou nových migracích: PASS. Navíc proti předchozí verzi: číslo podniku předvyplněné z Provozovny a zákazníka z profilu, `mine` jen u člena, který číslo ověřil, párování zákazníka kódem vytvořeným aplikací (špatný formát odmítnut, kód jen jako hash), kód zákazníka z čísla podniku neprojde, jedna žádost pro podnik se šablonou a parametry, po potvrzení z WhatsAppu a stržení žádná zpráva podniku ani zákazníkovi bez čísla, zrušení zákazníkem jde podniku, ne zákazníkovi, odmítnutí podnikem nic nepošle, vypršení a stažená žádost jdou podniku, ověřený zákazník dostane potvrzení s kódem a zrušení podnikem, klepnutí na zprávu, která není žádostí, nic nerozhodne, vypnutá preference zastaví frontu i už založenou zprávu při odeslání, uložení se čtyřmi argumenty WhatsApp nezmění, vypnutá preference podniku nezaloží žádost, vypnutí zákazníka i podniku, granty. `tests/manual-confirmation.sql` po změně triggeru: PASS. Obojí dry run v transakci před aplikací migrace.
- `npm run build`, `npm run test:unit` (109 testů: seskupení časů a popisky dnů, doporučení, obrázky podle kategorie, šablony WhatsApp a jejich secrets, oslovení v odpovědi na párování, kód párování) a typová kontrola Edge Functions (nové chyby žádné; staré implicitní `any` ve Stripe funkcích). Security advisor: žádný nový druh nálezu.
- Prohlížeč (lokální server nad hostovanou DB, relace demo účtů vložená do `localStorage`) na 390 px: feed s řádkem „Další časy 17:00“; mapa: dvě karty v náhledu 321 px vysoké i se štítkem „2 volná místa“, karta se třemi časy (17:00, Zítra 13:00, 17. 9. 19:30 s jinou cenou), čipy 44 px přepnou čas i odkaz Detail; detail: „Vyber si čas“ přepne adresu, cenu (153 → 159 Kč), slevu i lhůtu zrušení a zachová pozici, karusel „Mohlo by se ti líbit“ se 4 kartami stejné výšky nad mobilní lištou, bez horizontálního přetečení. Na 1280 px detail s výběrem jen časů stejné služby (30min masáž bez 60min varianty) a karusel s 5 kartami a šipkami.
- WhatsApp v prohlížeči s dočasně nastaveným číslem FLEK (`+420000000000`, jinak nenastavené): Profil ukáže třetí sloupec WhatsApp zaškrtnutý a sekci s číslem z profilu; klepnutí (navigace na wa.me zablokovaná v testu) uloží kód a ukáže „Odešli ve WhatsAppu připravenou zprávu FLEK …“ s odpočtem; `whatsapp_pair` s tím kódem z čísla zákazníka stránku sama přepne na „Hotovo, WhatsApp je ověřený“; vypnutí WhatsAppu u zrušené rezervace se uložilo (`email true, push false, whatsapp false`); Vypnout → „Zprávy na WhatsApp jsou vypnuté“ a znovu tlačítko ověření. Provozovna partnera: bez čísla FLEK jen informace, s číslem vykání, telefon provozovny, souhlas s rozhodováním tlačítkem, „Změnit“ ukáže pole 44 px. Po testu smazané: kontakt, událost, preference demo zákazníka a nastavení čísla FLEK (bylo nastavené omylem déle, během pauzy; nikdo jiný ho nepoužil, kontaktů 0).
- Neověřeno: výzvy na obrazovce čekání a „🔥 FLEK je tvůj!“ (potřebují skutečnou platbu), WhatsApp s účtem Meta a otevření WhatsAppu jedním klepnutím na skutečném telefonu.

## Zapnutí potvrzování pro demo podniky — 15. 9. 2026

- `stripe-webhook-setup` (admin, `verify_jwt`, nasazená přes MCP): suchý běh našel v testovacím režimu endpoint `…/functions/v1/stripe-webhook` (enabled) a chybějící `payment_intent.amount_capturable_updated`, `payment_intent.canceled`, `payment_intent.payment_failed`; ostrý běh je přidal (celkem 10 událostí).
- Sonda s přepínačem `demo` (nová nabídka demo podniku, zákazník `demo-6`, `stripe-test-pay`): autorizace `requires_capture` → `pending_merchant` za 2 s; stažení žádosti → `cancelled_by_customer`, platba `failed`, autorizace `released` za 2 s.
- `npm run test:acceptance` v režimu potvrzování (skript to pozná podle `confirmation_quote`): **106/106**.
- Průchod v prohlížeči na produkční verzi (relace demo účtů vložená do `localStorage`, dvě skutečné žádosti autorizované testovací kartou na serveru): zákazník na 375 px „Čekáme na potvrzení podniku“ s odpočtem 9:27 a „Zablokováno 390 Kč“; podnik na 390 px „Vyžadují potvrzení 2“ s „Potvrďte do 09:00“, Potvrdit → rezervace `confirmed`, platba `paid`/`captured`, zákazník „🔥 FLEK je tvůj!“ s kódem, QR, „Zaplaceno 390 Kč“; Nemohu přijmout → `rejected`, platba `failed`/`released`, zákazník „Tentokrát to nevyšlo… blokaci částky na kartě uvolňujeme“. Upozornění v aplikaci vznikla oběma stranám. Testovací nabídky potom zrušené.
- Supabase Auth → SMTP (jen čtení): zapnuté, odesílatel `ucet@mail.app-flek.eu`, jméno FLEK, uživatel `resend`, port 465, interval 60 s.
- Neprovedeno: přepnutí na `true` (automatický režim zamítl), Stripe Checkout formulářem s kartou, Apple Pay a Google Pay (číslo karty agent do formuláře nezadává).
- Přepnutí na `true` (15. 9. 15:54, po Jakubově souhlasu): `private.manual_confirmation_for` vrací `true` pro všech 18 schválených podniků včetně Kubova (Stripe propojený) a Tenis kurt (Stripe nepropojený, rezervovat u něj nejde). Texty pro podniky upravené, build a 109 unit testů prošly.

## Právní minimum — 18. 9. 2026

- Migrace `20260915191534_legal_documents` a `20260915192546_legal_reports` aplikované přes MCP, soubory přejmenované na verze v databázi. Všechny čtyři texty mají verzi 1.0 bez účinnosti, `legal_acceptances` i `content_reports` prázdné.
- `tests/legal.sql` na hostované DB (transakce s rollbackem): PASS. Bez platné verze platba projde jako dřív; s platnou verzí `start_payment` bez verze nebo se starou verzí selže `TERMS_OUTDATED` a se správnou zapíše jeden souhlas; podnik bez souhlasu nezveřejní FLEK a po souhlasu ano, cizí podnik ani stará verze souhlas nezapíšou, plánovaná úloha nabídku vloží; datum narození jen u plnoleté fyzické osoby; schválení skutečného podniku bez IČO selže; `business_provider` vrací jen název, IČO a adresu a demo označí; nahlášení s validací, limitem 10 za den, frontou jen pro admina a auditem vyřízení; export jen vlastních dat; DAC7 bez testovacích plateb a jen pro admina; analytika bez identifikátoru relace; tabulka souhlasů mimo dosah klientů. `tests/manual-confirmation.sql` po změně `start_payment`: PASS.
- `npm run build` a `npm run test:unit`: 134 testů, nové `tests/legal.test.ts` (parser markdownu, zástupné znaky, odkazy jen na existující stránky, verze textů shodné s migracemi, zveřejnění jen s údaji provozovatele, CSV pro DAC7) a `tests/email.test.ts` (podrobnosti smlouvy v e-mailu, žádný kód u nepotvrzené žádosti, demo bez poskytovatele, escapování, patička provozovatele, kontrolní číslice IČO, čtení odpovědi ARES).
- Prohlížeč (lokální server nad hostovanou DB, relace demo účtů vložená do `localStorage`): nezveřejněný stav na 375 px — „Tento dokument právě připravujeme“, detail nabídky s „Platíš, až podnik potvrdí“ a „Zrušení zdarma 10 minut od potvrzení“, rezervační okno s větou o demo podniku a bez souhlasu, „Nahlásit“ pro nepřihlášeného s výzvou k přihlášení, Profil s „Tvoje data“ a potvrzením smazání, fakturační údaje podniku s ARES, typem podnikatele a státem, Administrace → Nahlášení a podklad DAC7. V `sessionStorage` nic, v `localStorage` jen příznaky intra. Zveřejněný stav s údaji provozovatele podvrženými jen v lokálním kódu (vráceno před commitem): všechny čtyři texty bez zbylých zástupných znaků a bez přetečení na 375, 390 a 1280 px, tabulka zásad posuvná uvnitř rámečku, patička „O FLEKu“, registrace s větou 18+ a odkazem na zásady, souhlas v rezervačním okně, banner souhlasu podniku. Bez chyb v konzoli. Opraveno při průchodu: tabulka šla posouvat jen myší (teď i klávesnicí), popisek exportu se na telefonu ořezával, text o zápisu provozovatele bez rodu.
- Po pushi (18. 9.): CI prošlo, Supabase nasadila `ares-lookup` (v1) a `notification-delivery` (v27). `ares-lookup` proti skutečnému ARES s účtem demo podniku: IČO 00006947 vrátí Ministerstvo financí se sídlem Letenská 525/15 a DIČ, 27082440 Alza.cz a.s., 00006948 odmítne kontrolní číslicí (`INVALID_ICO`), neexistující 99999994 vrátí `found: false`, bez přihlášení 401; nic se neuložilo (bez `business_id`). Security advisor bez nového druhu nálezu. Nasazení webu na Vercelu selhalo hned na startu („Resource provisioning failed“), opakování přes API zamítl automatický režim; produkce běží na verzi z 15. 9., která s novou databází funguje (`start_payment` bez verze, `record_event` s `session_id`, fakturační údaje bez nových polí).
- `npm run test:acceptance` po nasazení (18. 9., režim potvrzování, podmínky ještě neplatí): **106/106**. `notification-delivery` v27 se spustí a volání bez klíče pracovníka odmítne (401); skutečný e-mail přes novou verzi zatím neodešel, protože demo účty `@flek.test` e-maily ani push nedostávají (68 upozornění z akceptace bez jediného doručení).
- Neověřeno: skutečný e-mail s podrobnostmi smlouvy (čeká na migraci), `npm run test:acceptance` s platnou verzí podmínek (skript je připravený, podmínky ještě neplatí).

## Povinné zprávy, smazání účtu, přihlášení přes Google a Apple a zjednodušení textů — 18. 9. 2026

- Migrace `legal_notices` nejdřív nanečisto: celá migrace a celý rozšířený `tests/legal.sql` v jedné transakci s rollbackem (PASS), potom kontrola, že v databázi nic nezůstalo (žádný cron, omezení ani funkce z migrace, přepínač potvrzování `true`, klíč pracovníka na místě). Nanečisto odhalené chyby opravené před spuštěním: `notifications.booking_id` bylo povinné (zprávy o účtu by nešly uložit) a jméno v profilu je povinné (smazání účtu by selhalo, teď „Smazaný účet“). Stejně nanečisto `oauth_profile_names` (jméno z Google `full_name`, jediné jméno, prázdný Apple profil, e-mailová registrace beze změny) a `legal_simplify` (podnik s dřívějším souhlasem není novou verzí blokovaný, podnik bez souhlasu ano, `content_rules` pryč z `legal_info`).
- `tests/legal.sql` po všech třech migracích proti hostované DB: PASS. Nově: e-mail zákazníkovi o odmítnutí se zařadí i s vypnutou předvolbou a nese smlouvu (stav, žádný kód, poskytovatel, verze podmínek, provozovatel); e-mail podniku předvolbu respektuje; zprávy o pozastavení a schválení podniku s důvodem, zpráva oznamovateli, blokace bez důvodu odmítnutá a s důvodem auditovaná i oznámená, zpráva o odblokování; upozornění na rezervaci bez rezervace neprojde; smazání účtu odmítne člena podniku a nadcházející rezervaci, po smazání nezůstane přihlašovací identita, heslo, metadata ani oblíbené, rezervace a platba zůstanou a smazání je v auditu; `flek_retention` smaže 13 měsíců staré upozornění a nechá čerstvé, cron je naplánovaný; oprávnění nových funkcí; analytika bez starých identifikátorů relace.
- `npm run test:acceptance` po migraci `legal_notices`: **106/106**. Testy WhatsAppu a potvrzování počítají jen zprávy na WhatsApp a samotná upozornění a demo účty e-maily nedostávají, změna e-mailů je proto neovlivní.
- `npm run build` a `npm run test:unit` (131 testů; ubyly tři testy zrušeného dokumentu pravidel obsahu).
- Prohlížeč (lokální server nad hostovanou DB, relace demo účtů vložená do `localStorage`): zákazník na 375 px v Profilu vidí u potvrzené i zrušené rezervace „E-mail (vždy)“ zaškrtnuté a zamčené s vysvětlením; admin na 375 px po „Zablokovat rezervace“ dostane okno s povinným důvodem a vysvětlením, co zákazník dostane (neodesláno). Tlačítka „Pokračovat přes Apple“ a „Pokračovat přes Google“ s logy a větou o 18 letech ověřená s lokálně podvrženým nastavením poskytovatelů (vráceno): výška 52 px, bez přetečení na 375, 390 a 1280 px, bez chyb v konzoli. V produkci jsou Google i Apple v Supabase vypnuté (`/auth/v1/settings`), tlačítka se tam neukazují.
- Neověřeno: skutečné přihlášení přes Google a Apple (chybí klíče), skutečný e-mail s podrobnostmi smlouvy. Web v produkci viz další oddíl.

## Kontrola kvality textů, nasazení webu a Meta — 18.–19. 9. 2026

- `npm run build` a `npm run test:unit` před commitem 060491e i po úpravě „až hodinu“ (19. 9.).
- `stripe-checkout` v10 (tlačítko „Zaplatit“) nasazená přes MCP. Skript nad demo účtem založil platbu a nechal Stripe vytvořit testovací platební stránku; Stripe ji s novým `submit_type` přijal a podržení termínu se hned uvolnilo. Samotné tlačítko na stránce Stripe se kartou neproklikávalo (číslo karty agent do formuláře nezadává).
- Vercel: po odpojení uspané databáze od projektu (Storage → Projects → Remove Project Connection, Jakubův souhlas) hlásí GitHub status u commitu 060491e „Deployment has completed“. 19. 9. znovu ověřeno na www.app-flek.eu: načtený soubor `App-*.js` obsahuje novou větu „i když je to do 14 dnů“ z rezervačního okna.
- Meta (Jakubův souhlas): v aplikaci FLEK odsouhlasené Facebook Terms for WhatsApp Business a Meta Hosting Terms for Cloud API; přes hlášku „Onboarding failure“ vznikl testovací WhatsApp účet a testovací číslo (krok 1 „Completed“), ve WhatsApp Manageru jsou jen ukázkové šablony Meta.
- Neověřeno: šablony WhatsApp (WhatsApp Manager v Chromu po kliknutí opakovaně na minuty zamrzl, žádná šablona se neuložila), webhook a zprávy na telefon.

## Úvodní stránka v duchu move+ — 20. 9. 2026

- `npm run build` a `npm run test:unit`: 131 testů, bez chyb.
- Prohlížeč (lokální server nad hostovanou DB) na 375, 390 a desktopu: Objevit s lištou „Začíná brzy“ a mřížkami pod ní, detail nabídky s karuselem „Mohlo by se ti líbit“, stránka podniku (karta bez fotky), mapa beze změny, kostra při načítání ve tvaru karty. Bez horizontálního přetečení a bez chyb v konzoli.
- Promo blok pro nepřihlášené měří na `/oblibene` i `/rezervace` 320 px (měřeno v prohlížeči na 375 px i na desktopu).
- Neověřeno: přihlášená Oblíbená a Rezervace se skutečnými daty (karta je stejná jako na Objevit).

## Ikona oboru ve špendlíku, karty s časy a prověřené přihlášení — 20. 9. 2026

- `npm run build` a `npm run test:unit`: 136 testů v 18 souborech, bez chyb. Nový `tests/categoryGlyphs.test.ts` (5 testů) hlídá, že každá kategorie z `public.categories` má vlastní tvar, že se tvary navzájem liší, že neznámá kategorie spadne na značku FLEK a že vykreslovaný markup neobsahuje nic než tvary (do DOM jde beze změny).
- Špendlík po změně měří stejně jako dřív: dlaždice 48 × 48 px a celý špendlík 64 px na výšku (změřeno v Chromiu), takže výpočet kolizí shluků v `mapClusters.ts` a jeho test platí dál.
- Vykreslení v Chromiu na 375, 390 a 1280 px: šest špendlíků s ikonami oboru, vybraný špendlík s prstencem a značkovou cenovkou, špendlík s počtem termínů, záložní značka FLEK; karta času ve vybraném i nevybraném stavu s cenou, slevou, délkou a „poslední místo“, den jako nadpis a tlačítko „Další časy (3)“. Bez horizontálního přetečení v žádné šířce; karta času měří 105 px, tlačítko „Další časy“ 44 px.
- `tests/oauth-profile.sql` proti hostované databázi (celá transakce vrácena): Google „Jana Nováková Dvořáková“ → jméno „Jana“ a příjmení „Nováková Dvořáková“, `given_name`/`family_name` mají přednost před celým jménem, odpověď Apple bez jména → profil vznikne s prázdným jménem, samé mezery → prázdné jméno, jednoslovné jméno → bez příjmení, registrace e-mailem beze změny, jméno delší než 80 znaků se ořízne, nový účet nedostane podnik. Před testem i po něm 17 účtů a 17 profilů, žádný zbytek `qa-oauth-…`.
- Stav přihlášení v produkci (dotaz na `/auth/v1/settings` přes `net.http_get` z databáze, protože z prostředí agenta není přímá cesta ven): `google: false`, `apple: false`, `email: true`; v `auth.identities` je 17 účtů, všechny `email`. Živá funkce `public.handle_new_user` obsahuje větev pro `full_name`, `given_name` i rozdělení celého jména, tedy verzi z migrace `20260918145409`.
- `npm run check:oauth` ověřený proti mocku GoTrue ve třech stavech: poskytovatel vypnutý → „VYPNUTÝ v Supabase“; zapnutý s odmítnutou návratovou adresou → vypíše, co přidat do Redirect URLs, a odpověď Supabase; zapnutý s povolenou adresou → „zapnutý a návrat povolený“.
- Neověřeno: skutečné přihlášení přes Google a Apple (poskytovatelé jsou vypnutí a klíče zakládá člověk), a jak ikony a karty vypadají nad živými daty v aplikaci — kontrola proběhla nad vykresleným markupem se sestavenými styly, protože z tohoto prostředí není přístup na Supabase ani na web.

## Fotky demo služeb a víc demo FLEKů — 20. 9. 2026

- Před migrací mělo 11 služeb a 5 obálek jinou fotku, než jakou pro ně počítá katalog `src/lib/serviceIllustrations.ts` (porovnáno dotazem, který v SQL zopakoval pravidla katalogu: shoda podle názvu bez diakritiky, jinak podle kategorie). Po migraci `20260920170544` mají padelový kurt i individuální lekce v padelovém klubu `padel-prague.jpg`, tenisový kurt `tennis-prague.jpg` včetně obálky, „Sauna a odpočinek“ `sauna-prague.jpg`, masáže jednotný snímek kategorie. Migrace mění jen řádky s přesně původní seedovanou hodnotou, takže vlastní fotku podniku přepsat nemůže.
- Dvě služby („Pujčení kola“) zůstávají bez fotky záměrně: katalog pro ně nemá snímek a aplikace dopočítá obrázek kategorie.
- Demo nabídky před změnou: 29–30 publikovaných na den, ale dnes v 16:00 jen **3 rezervovatelné** — funkce `flek_demo_refresh` dělala jeden termín na službu a den. Po migraci `20260920170821` a jednom spuštění: **141 nových nabídek**, dnes 43 publikovaných a 17 rezervovatelných, zítra a pozítří po 93. Termíny jsou po půlhodinách mezi 8:00 a 20:00.
- Pravidla zůstala: jen demo podniky (`@flek.test`) se zapnutým Stripe, žádné dvě nabídky jedné provozovny se nepřekrývají, cenu a poplatek počítá `private.validate_flek`, jóga má 4 místa.
- Neověřeno: jak to vypadá v aplikaci nad živými daty — z prostředí agenta není přístup na web ani na Supabase z prohlížeče.

## Upozornění na novou provozovnu a kontrola e-mailů — 20. 9. 2026

- Fronta `private.notification_delivery` byla prázdná při 420 upozorněních. Příčina není porucha: e-mail se zařadí jen pro potvrzenou adresu, která není `@flek.test` (demo účty e-maily schválně nedostávají), a všechna upozornění patřila demo účtům. Účty jakub.hrncir24@gmail.com, jakub@app-flek.eu, jakub.hrncir@post.cz a sejmencz@post.cz měly shodně 0 upozornění, poslední rezervace v databázi je z 18. 9. a byla demo.
- Zkušební zpráva přes `private.account_notice` na jakub.hrncir24@gmail.com: řádek ve frontě má `status = sent`, `attempts = 1`, bez chyby. Resend i `notification-delivery` tedy fungují.
- Skutečná mezera: registrace provozovny neposílala nic. Migrace `20260920175100` přidává trigger na `business_members` (ne na `businesses` — `create_business` vkládá vlastníka až po provozovně), který pošle majiteli potvrzení a adminům „Nová provozovna ke schválení“. Admin, který si provozovnu zakládá sám, dostane jen zprávu majitele; demo podniky ze seedu jsou vynechané, aby při seedu nenaskákalo osmnáct zpráv.
- Neověřeno: skutečné doručení do schránky (Resend hlásí přijetí, ne otevření) a průchod registrací nové provozovny v prohlížeči — trigger je ověřený jen logikou a zkušební zprávou toutéž cestou.

## Administrace provozoven — 20. 9. 2026

- RPC `admin_businesses` nově posílá `billing` (IČO, DIČ, typ prodejce, souhlas s podmínkami, kontaktní osoba, co našel ARES) a `is_demo`. Číslo účtu ani datum narození se do administrace neposílají — ke schválení nejsou potřeba. Tvar odpovědi ověřený dotazem s podvrženým adminským JWT v transakci s rollbackem.
- `approvalChecklist` počítá totéž, na čem schválení odmítne server: skutečný podnik musí mít IČO, ukázkový ne. Pokryto pěti testy (`tests/approvalChecklist.test.ts`), celkem 141 unit testů.
- Vykresleno v Chromiu na 390 a 1280 px nad dvěma případy (podnik bez IČO a kompletní podnik): bez horizontálního přetečení, zakázané „Schválit“ má důvod hned nad sebou, řádky seznamu mají ikonu podle stavu (zelená hotovo, červená blokuje, žlutá jen upozorňuje).
- Neověřeno: průchod administrací nad živými daty v prohlížeči — z prostředí agenta není přístup na web.

## Matné sklo a logo v e-mailech — 20. 9. 2026

- Sklo změřené na nejhorším podkladu, jaký může nastat (čistě černá fotka): 86% bílá nad černou dává #DBDBDB, text `--color-muted` (#545970) na něm má kontrast 5,0 : 1 — nad AA 4,5 : 1 pro malý text. Pro porovnání: při 80 % je to 4,4 : 1, tedy pod normou. Proto ten strop.
- Vykresleno v Chromiu (400 px, 2× DPI) nad fotografií kurtu, nad čistě černým podkladem a nad barevným podkladem imitujícím mapu: panel s fakty, pilulka s časem i karta nad mapou zůstávají čitelné, fotka a mapa pod nimi prosvítají. Vypočtené hodnoty odpovídají tomu, co prohlížeč skutečně použil (`color(srgb 1 1 1 / 0.86)`, `blur(20px) saturate(1.65)`).
- Logo do e-mailů vyrenderované z tvaru, který kreslí `components/ui.tsx` (slovo „flek“ v Instrument Sans + špendlík s hodinami a třemi čárkami), do `public/images/email-logo.png` 540 × 216 px s průhledným pozadím; v e-mailu je vloženo na 135 × 54 px, tedy v poměru 2,5 : 1 bez deformace. Hlavička zkontrolovaná v náhledu potvrzovacího e-mailu.
- Neověřeno: jak se sklo a logo chovají ve skutečných poštovních klientech a na skutečném telefonu — z prostředí agenta není přístup na web ani do schránky.

## Zveřejnění zásad ochrany osobních údajů — 20. 9. 2026

- Migrace `20260920200932` zapsala provozovatele (`operator_name`, `operator_address`, `support_email`) a dala verzi 1.0 zásad účinnost. `legal_info()` v produkci vrací správce „Jakub Hrnčíř“, adresu „Sinkulova 25, 147 00 Praha 4“, kontakt `jakub@app-flek.eu` a účinné zásady; `customer_terms` i `merchant_terms` zůstávají prázdné, jak mají.
- Pět nových unit testů v `tests/legal.test.ts` (celkem 146): zásady se bez IČO zveřejní a obchodní podmínky ne; bez účinné verze se nezveřejní nic; chybějící adresa nebo e-mail zásady zastaví; věta o správci vynechá IČO, dokud žádné není; a v textu nezůstane „IČO —“.
- Neověřeno: jak stránka `/soukromi` a patička vypadají nad živými daty v prohlížeči — z prostředí agenta není přístup na web. Text zásad před ostrým provozem zkontroluje právník.

## Mapa, recenze, moderace a RLS — 21. 9. 2026

- `npm run build` prošel; zůstává pouze známé upozornění na velikost samostatného mapového balíčku. `npm run test:unit`: **152/152** v 19 souborech.
- Migrace `20260921132015`, `20260921132229` a `20260921132349` jsou v hostovaném Supabase. První přidala recenze, moderaci, WhatsApp readiness a RLS; druhá zachovala WhatsApp ve starém čtyřargumentovém volání preference; třetí doplnila indexy tří cizích klíčů, které po první migraci našel performance advisor.
- `tests/reviews-moderation.sql` proti hostované DB: PASS s rollbackem. Cizí a nedokončená rezervace neprojde, reminder je právě jeden a bez e-mailu/WhatsAppu, čekající text není veřejný, schválený text je veřejný anonymně, zamítnutí ponechá hvězdičky a skryje text, změna služby zachová poslední schválenou verzi i fotografii, admin zásah je v auditu, klient neobejde serverový zápis a RLS chrání `private.settings` i `private.stripe_events`.
- `tests/whatsapp-notifications.sql` po kompatibilitní opravě: PASS s rollbackem. `tests/manual-confirmation.sql`: PASS s rollbackem.
- Supabase security advisor po změně: obě dříve otevřené privátní tabulky mají RLS a klientské granty jsou odebrané. Zůstávají záměrná upozornění na privátní tabulky bez politik a dřívější upozornění na veřejné `security definer` RPC; nový test ověřuje jejich autorizaci. Performance advisor po indexové migraci nehlásí nové chybějící indexy moderace.
- `content-moderation` je nasazená jako ACTIVE v1. Technická sonda vložila bezpečný podklad, worker ho načetl a při HTTP 429 od OpenAI ho správně ponechal neveřejný pro opakování; testovací řádek byl potom odstraněn. Automatické schválení bezpečného obsahu proto není produkčně potvrzené a čeká na aktivaci/limit OpenAI projektu.
- Mapa nad živými demo daty v lokální aplikaci: 16 skutečných FLEK špendlíků při výchozím oddálení, žádný čtvercový shluk. Náhled vybraného místa má 136 px na 375, 390 i 1280 px, `scrollWidth` stránky odpovídá viewportu a vybraný bod zůstává nad kartou. Krátká klávesová akce posunula carousel z první na druhou službu (`scrollLeft 0 → 308`); dotyková cesta používá stejný přesný index po 32px vodorovném gestu. Bez framework overlay a bez relevantních chyb nebo varování v konzoli.
- WhatsApp zůstává bezpečně nedostupný: `whatsapp_enabled=false`, žádné zobrazované číslo, kontakty ani odeslané zprávy. V UI se nezobrazí, dokud není kanál skutečně aktivovaný a otestovaný.
- Commit `2781d58` je na `main`; GitHub stav Vercelu je `success` („Deployment has completed“) a `https://www.app-flek.eu/` odpovídá HTTP 200. Produkční mapa na 390 × 844 px ukázala skutečné FLEK špendlíky a po otevření místa kartu 342 × 136 px se třemi službami, bez horizontálního přetečení a bez chyb či varování v konzoli.

## Barevný panel nabídky — 21. 9. 2026

- `npm run build` a `npm run test:unit`: PASS, **152/152**.
- Lokální Objevování v prohlížeči na 375, 390 a 1280 px: jemně ultramarínový panel, brandová cena, ikony i čipy dalších časů; žádné horizontální přetečení ani chyba či varování v konzoli. Na 375 px měří karta 302 × 377 px a panel 282 × 104 px.

## Mapa, hláška hledání, karty a patička — 22. 9. 2026

- `npm run build` (včetně `tsc --noEmit`) a `npm run test:unit`: PASS, **156/156**, včetně dvou nových v `tests/map.test.ts` (rozmístění hlásí špendlík bez místa; stejné podniky jako body se vejdou bez překryvu a žádný nezmizí ani tam, kde se nevejde ani bod).
- Migrace `20260921212301_map_search_limit_300` nanečisto v transakci s `rollback`, pak aplikovaná přes MCP; soubor přejmenovaný na verzi, kterou databáze zapsala.
- Dotaz proti hostované databázi, výchozí filtr (do 5 km, `now()`, bez kategorie): při 50 řádcích dosáhne řazení „nejblíž“ na 3 podniky ze 16, „nejlevnější“ na 6, „doporučené“ na 14; při 300 řádcích dosáhnou všechna řazení na 16–17 podniků. Tělo funkce zůstalo slovo od slova stejné, mění se jediná mez ve validaci.
- Vykreslení v Chromiu (Playwright, 2× DPR) proti sestavenému CSS a skutečnému písmu: šestnáct podniků na jedné pražské obrazovce při 390 px — plné špendlíky nechají jeden bez volného místa a přetékají přes okraj, body se vejdou všechny a vybraný si drží cenu. Dotyková plocha bodu změřená na 44 × 44 px.
- Hláška o rozšířeném hledání a odznaky filtrů na 390 px: bez přetečení, nejdelší věta („Poblíž nic není, ukazujeme do 25 km a nejbližší dvě hodiny“) se zalomí uvnitř pilulky a kotouč zůstane u prvního řádku.
- Karta „Tvůj FLEK“ na 375 i 390 px: 228 px (dřív 204 px), pruh se součtem drží dva řádky, odznak nejlepšího úlovku se nezalomí do třetího.
- Patička „O FLEKu“: 368 px na 390 px (dřív 373 px) se třemi dlaždicemi ve tvaru 2 + 1, 255 px na 1280 px s jednou řadou pilulek; nikde vodorovné přetečení, dotyková plocha odkazů 44 px.
- Panel karty nabídky nad třemi skutečnými fotografiemi (salon, masáže, tenis) na 390 px: fotka pod sklem prosvítá, text drží kontrast, karta zůstala 358 px.
- Karta termínu na detailu nabídky na 390 px: 821 px místo 895 px, bez opakování vybraného času v seznamu.

## Kompaktní body oddálené mapy — 21. 9. 2026

> Tuhle podobu nahradila změna z 22. 9. (viz sekce výš): přepínání podle hustoty místo hranic přiblížení a 300 řádků místo 100. Důkazy níž platí pro implementaci, která už v kódu není.

- `npm run build`: PASS; zůstává jen známé upozornění na velikost samostatného mapového balíčku. `npm run test:unit`: PASS, **154/154** v 19 souborech. Nové testy hlídají přepnutí městský pohled / detail čtvrti a zachování každého bodu při těsnějším rozložení 44px dotykových ploch.
- Lokální mapa nad živými demo daty při 390 × 844 a 375 × 812 px: 15 samostatných kruhových bodů, žádný číselný čtvercový shluk, stránka má přesně šířku viewportu. Vybraný bod se rozbalil na ikonu s cenou a otevřel 136px kartu se třemi službami.
- Desktop 1280 × 720 px po trojím přiblížení: všech 15 markerů zůstává v DOM, kompaktních je 0 a každý má plnou cenu; horizontální přetečení 0 px. Informační stav „Na dnešek nic není, ukazujeme celý týden“ měří na mobilu 330 × 40 px, používá značkové barvy a zůstává celý viditelný. Bez aplikační chyby; vývojový server zachytil jen známá varování cizího stylu OpenFreeMap o filtrech a chybějících sprite ikonách.

## Mobilní detail služby — 22. 9. 2026

- `npm run build`: PASS; pouze známé upozornění na velikost mapového balíčku. `npm run test:unit`: PASS, **156/156** v 19 souborech po sloučení mapových kontrol.
- Lokální Chrome nad živými demo daty na 375 × 844 a 390 × 844 px: `scrollWidth` je shodný s viewportem, žádné chyby konzole. Pevná lišta obsahuje pouze cenu a hlavní akci, takže už nepřekrývá dvěma řádky vysvětlivek výběr časů.
- Přepnutí záložky z **Dnes** na **Zítra** zobrazilo panel „Zítra: dostupné časy“. Volba termínu 09:00 za 658 Kč převedla detail na odpovídající nabídku, souhrn ukázal **Zítra** a nový stav už nezůstal v načítání.
- Vybraný termín se zobrazuje právě jednou v souhrnu; mřížka „Jiný čas“ obsahuje jen skutečné alternativy.
- Desktop 1280 × 720 px zkontrolovaný v prohlížeči: karta zůstává v pravém sloupci, souhrn, dvě řady časů i hlavní akce jsou viditelné bez vlastního dlouhého seznamu.

## Skutečné fotografie a kompaktní detail — 23. 9. 2026

- Následný redesign vloženého rezervačního bloku: build a 154/154 unit testů PASS. Chrome 375/390 a 1280 px: vizuálně ověřen ultramarínový souhrn, podtržený výběr dne a jemné alternativy. Při 375 px blok měří 289 px, žádné horizontální přetečení ani tlačítko menší než 44 px. Přepnutí na 25. 9. a čas 11:00 změnilo nabídku na `ffbb0557-df8f-4af5-b826-95ca79d4eaa2` a cenu na 317 Kč. Konzole 0 chyb, jen známá varování mapového stylu. Mobbin neposkytl reference, protože připojení vyžaduje placený tarif; návrh proto není vydávaný za kopii konkrétní obrazovky z Mobbinu.

- Nasazení commitu `e9fd9cb` na `main`: Vercel **success**, GitHub „Typy, build, unit testy a závislosti“ **success**, „Supabase Preview“ **success**. Produkční detail půjčení kola na `www.app-flek.eu` ověřen na 375 i 390 × 844 px: fotografie načtená, výška 180 px, nulové vodorovné přetečení, hlavní akce 52 px a ultramarín `rgb(44, 38, 210)`. Notion „FLEK — přehled projektu“ synchronizován a následným čtením ověřen.

- `npm run build`: PASS včetně TypeScriptu; zůstává pouze známé upozornění na velikost mapového balíčku. `npm run test:unit`: PASS, **154/154** v 19 souborech. Dva testy starých generovaných derivátů byly odstraněny, nové testy ověřují všech 74 míst katalogu, evidenci skutečných fotografií, neutrální náhradu a přednost vlastní fotografie podniku.
- Pro 63 různých fotografií byla při výběru otevřena zdrojová stránka, zkontrolován autor a označení „Free to use under the Unsplash License“; malé CDN náhledy odpověděly jako obrázky. Vizuální kontaktní listy kontrolovaly soulad s aktivitou, ořez a nevhodné osoby/loga. Pět nejednoznačných variant dostalo neutrální značkový placeholder; dvě wellness fotografie byly po další kontrole vyměněny.
- Hostovaná DB eviduje migrace `20260923095229` a `20260923100358`. Po aplikaci: **0** starých lokálních URL v `service_photos`, `services` a `businesses`; jedna vlastní veřejná Storage fotografie služby zůstává. Primární fotografie půjčení kola v katalogu je skutečné kolo, nikoli rotoped.
- Lokální Chrome nad hostovanou DB: při 375 px stránka nepřetéká (`scrollWidth = 375`), úvodní fotografie má 180 px a rezervační panel 343 px místo přibližně 434 px. Na 390 × 844 px jsou služba, čas, cena a pevná akce čitelné; změna na 13:30 otevře správnou nabídku s novou cenou. Dlouhý název půjčení kola, expirující FLEK a pravý rezervační sloupec na 1280 × 720 px nepřetékají. Tlačítko má vypočtené pozadí `rgb(44, 38, 210)`.
- Mobilní mapa není před otevřením namontovaná; po klepnutí na „Zobrazit mapu“ se vykreslí bez vodorovného posunu. Po simulovaném výpadku `images.unsplash.com` ukázala hlavní fotografie `/images/flek-placeholder.svg`. Při běžném průchodu nebyla chyba aplikace v konzoli; externí styl mapy vydal známá MapLibre varování.
- Supabase security a performance advisories po migraci nenahlásily novou chybu vztahující se k fotografiím. Nadále uvádějí dřívější informační nálezy o tabulkách s RLS bez klientských politik a nepoužitých indexech, bezpečnostní varování pro úmyslné veřejné čtecí RPC a `pg_net` v `public`; odkazy a jejich stav jsou v Supabase dashboardu.

## Poloha na mapě a hlídač FLEKů — 24. 9. 2026

- `npm run build` (včetně `tsc`) a `npm run test:unit`: PASS, **160/160**, nově `tests/watches.test.ts` (poloměr zrcadlí `private.watch_radius`, popisky vzdálenosti, měřítko Web Mercator 512 px, velikost kruhu v pixelech) a test e-mailu s odkazem na FLEK nebo mapu.
- Migrace `20260924130650_flek_watches` aplikovaná přes MCP; funkční zkouška v transakci s `rollback`: po založení hlídače v centru (MHD 30 min) jeden průchod skenu vytvořil jedno souhrnné upozornění s odkazem `/mapa?hlidac=…`, druhý průchod nic (brzda 30 minut), místo uložené jako 50.088, 14.421.
- `tests/watches.sql` proti hostované DB: PASS s rollbackem — anonym nic neuloží, chybný dojezd, režim i kategorie vrací `VALIDATION_ERROR`, čtvrtý hlídač `WATCH_LIMIT`, cizí hlídač nejde vidět, upravit ani smazat, pozastavený nic neposílá, bez zapnutí nejde e-mail, přesun pod 300 m se ignoruje a nad 300 m hlídač přesune a znovu nastaví.
- Security advisor: nové tabulky jsou v `private` s RLS a bez klientských grantů; nové RPC nejsou spustitelné pro `anon`, pro `authenticated` stejně jako ostatní RPC aplikace.
- Vykreslení skutečných komponent v Chromiu (náhled s podvrženou session a daty): okno hlídače na 390 a 1280 px bez vodorovného přetečení, žádný ovládací prvek pod 44 px; seznam hlídačů v Profilu s přepínačem; mapa při přiblížení 14 ukazuje tečku 18 px s kruhem přesnosti 60 m = 39 px a okruh 750 m = 489 px, špendlíky nad nimi. Mapové dlaždice kontejner nestáhne (síť ven je blokovaná), takže podklad je prázdný.

## Revize hlídače, firemní špendlíky, Upozornění a prázdné Rezervace — 24. 9. 2026

- `npm run build` (včetně `tsc`) a `npm run test:unit`: PASS, **161/161**; nový test hlídá, že firemní špendlík oddálené mapy je jen statický tvar skrytý pro čtečku (`tests/categoryGlyphs.test.ts`).
- Migrace `20260924163302_flek_watches_review` aplikovaná přes MCP; verze v `supabase_migrations.schema_migrations` odpovídá názvu souboru.
- `tests/watches.sql` proti hostované DB v 18:50 pražského času: PASS s rollbackem — denní větev (jedno souhrnné upozornění, text s cenou, bez e-mailu bez zapnutí, druhý průchod do 15 minut nic), `watch_offer_line` se slevou „490 Kč (−38 %)“ i bez závorky při nulové slevě, a nově smazání účtu (`delete_my_account`) smaže i hlídač. Noční větev (22–7: sken vrátí 0, nic neoznačí jako ohlášené, nespustí brzdu) je v testu podmíněná časem a v tomto běhu se nevykonala. Po testu v databázi nezůstal testovací uživatel, hlídač ani upozornění a `worker_secret` je na místě.
- Vykreslení skutečných komponent v Chromiu (náhled s podvrženou session a daty, obrázky a dlaždice kontejner nestáhne): prázdné Rezervace na 390 a 1280 px (náhled rezervační karty, lišta „Volné FLEKy v okolí“, pozvánka k hlídači i stav „Hlídač běží“), Profil na 375 px se zavřeným řádkem „Upozornění“ a na 390 a 1280 px otevřený s tabulkou a WhatsAppem. Všude `scrollWidth = clientWidth` a žádný odkaz, tlačítko ani zaškrtávátko (měřeno i s obalujícím `label`) pod 44 px; bez chyb aplikace v konzoli.
- Oddálená mapa v náhledu (16 podniků, přiblížení 11,6): 15 firemních špendlíků `.map-pin--mark` s dotykovou plochou 44 × 44 px a jeden vybraný plný špendlík s cenou.

## Úvod pro zákazníky a podniky, běžná cena — 24. 9. 2026

- `npm run build` (včetně `tsc`) a `npm run test:unit`: PASS, **161/161**.
- Vykreslení skutečných komponent v Chromiu (náhled s podvrženými daty; fotografie z Unsplashe a dlaždice kontejner nestáhne): úvod na 375 × 667, 390 × 844 a 1280 × 900 px — všechny čtyři kroky, poslední tlačítko „Najít svůj FLEK“, bez vodorovného přetečení; tečky kroků mají nově dotykovou plochu 44 × 44 px (dřív 8 × 8). Stránka pro podniky na 375 a 1280 px, náhled na mapě a časy na detailu na 375 px, karta rezervace s přeškrtnutou běžnou cenou na 375 px: bez přetečení a bez odkazu či tlačítka pod 44 px (záložky dnů na detailu měly 40–42 px šířky, nově `min-w-11`). Bez chyb aplikace v konzoli.
- Fakta v textech ověřena proti databázi a podmínkám: `manual_confirmation_enabled = true`, WhatsApp číslo FLEKu zatím není nastavené (stránka pro podniky WhatsApp nezmiňuje), kód rezervace se tvoří jako `'FLEK-' || generate_reservation_code(6)`, lhůty a výplaty podle `podminky-podniky.md` čl. 4, 5 a 7.

## Průvodce pro podniky — 24. 9. 2026

- `npm run build` (včetně `tsc`) a `npm run test:unit`: PASS, **161/161**.
- Předpoklady zveřejnění ověřené v hostované DB: `publish_flek` vyhazuje `BUSINESS_NOT_APPROVED`, volá `private.require_payments_ready` (`STRIPE_NOT_CONNECTED` bez účtu Stripe s `stripe_charges_enabled`) a odmítne neaktivní službu; propojení se Stripe (`stripe-connect`, `onboard`) schválení nevyžaduje.
- Náhled skutečných stránek s podvrženými daty pro tři podniky (nový schválený, čekající na schválení, zaběhnutý se službami a FLEKy) na 390 a 1280 px: nový a čekající vidí průvodce s rozbaleným jediným krokem, zaběhnutý ho nevidí; Nabídky nového podniku bez tlačítka a záložek, s větou o chybějícím kroku; `?sekce=fakturace` odroluje na fakturační údaje (horní hrana 96 px, pod lepivou hlavičkou); `?nova=1` otevře formulář služby; nabídka „Další“ s nápovědou, zákaznickou částí a odhlášením; nápověda se otevře z nabídky. Bez vodorovného přetečení a bez ovládacího prvku pod 44 px; v konzoli jen chyby dlaždic mapy (kontejner je nestáhne).

## WhatsApp: stav a dokončení z administrace — 24. 9. 2026

- Stav před změnou z databáze a logů: `whatsapp_display_number` prázdné, žádný kontakt ani zpráva; `whatsapp-templates-setup` ve 12:31 UTC 503 (chyběly klíče), v 19:31 UTC dvakrát 200 (bez chyb šablon); `whatsapp-webhook` za posledních 24 h Meta nevolala.
- Sonda z databáze přes `pg_net`: nepodepsaný POST na webhook → 401 „Invalid signature“ (tedy `WHATSAPP_APP_SECRET` je nastavený; bez něj 503), GET s cizím ověřovacím tokenem → 403.
- Migrace `20260924202246_admin_whatsapp_number` nanečisto v transakci: neadmin dostane `FORBIDDEN`, krátké číslo `VALIDATION_ERROR`, „+1 555 010 9999“ se uloží jako `+15550109999`, `admin_whatsapp_state` ho vrátí, audit `whatsapp_number_changed` vznikne; po rollbacku zůstalo číslo prázdné. Pak aplikována přes MCP, soubor přejmenován na zapsanou verzi.
- Upravená funkce se sestaví (rolldown, bez chyb syntaxe); proti Metě ji odsud spustit nejde (volá ji jen přihlášený admin), výsledek ukáže panel po „Zkontrolovat stav“.
- Panel WhatsApp vykreslený s ukázkovou odpovědí na 390 a 1280 px bez přetečení; build a 161 unit testů PASS.
- 22:34 SEČ: volání `whatsapp-templates-setup` z databáze (`net.http_post` s tajným klíčem workeru, `dry_run`) prošlo ověřením funkce a skončilo na prvním dotazu k Metě: 502 `META_REQUEST_FAILED`, Meta 401 „Error validating access token: The session is invalid because the user logged out.“ — token v Supabase je dočasný a neplatí. Administrace teď místo obecné chyby řekne, že je potřeba trvalý token systémového uživatele.
- Funkce `whatsapp-templates-setup` spuštěná v Node s podvrženým `Deno` a `fetch` (Supabase i Graph API): předletový dotaz z www.app-flek.eu 200 s `Access-Control-Allow-Origin` pro FLEK, cizí původ dostane adresu FLEKu (prohlížeč odmítne), špatný klíč workeru 403, bez hlavičky 401; s klíčem workeru a akcemi `subscribe`, `webhook`, `picture`, `profile` jdou volání v pořadí odběr → čtení odběru (ID aplikace) → `/{app}/subscriptions` tokenem aplikace → stažení loga → sezení `/{app}/uploads` → soubor na `upload:…` s `Authorization: OAuth` a `file_offset: 0` → handle do `whatsapp_business_profile` → texty profilu; bez přihlášené aplikace vrátí webhook i fotka `APP_ID` a k Metě nic neodejde. Typová kontrola funkce přes `tsc` s náhradními deklaracemi Dena bez chyb.
- Panel WhatsApp v administraci v obou stavech (bez odběru a s odběrem) na 390 a 1280 px: bez přetečení, žádný ovládací prvek pod 44 px, ruční návod k webhooku sbalený; build a 161 unit testů PASS.
- Po nasazení (verze 22, 22:48 SEČ): volání z databáze s klíčem workeru → 502 `META_REQUEST_FAILED`, Meta 401 „The session is invalid because the user logged out“, odpověď už nese `access-control-allow-origin: https://www.app-flek.eu` (předchozí verze hlavičku neměla). CI na `753051d` zelené, Vercel produkce READY.
- 23:18–23:31 SEČ, volání z databáze s klíčem workeru: s novým tokenem 200; `token_app` = FLEK (`/app` funguje i s tokenem systémového uživatele); `subscribe`, `profile`, `picture` → `ok`, profil vrací texty FLEKu, `jakub@app-flek.eu` a `has_picture: true`; odběr účtu má teď FLEK i „WA DevX Webhook Events 1P App“. Šablony: 4× PENDING, `flek_business_confirmed` REJECTED `INCORRECT_CATEGORY` → nové znění nasazené a `resubmit` → `resubmitted`, PENDING. `WHATSAPP_VERIFY_TOKEN` v Supabase chybí, webhook zatím nenastaven. Číslo `+15551567838` uložené do `private.settings` s auditem `whatsapp_number_changed` (actor prázdný, důvod „Agent (Claude)…“).
- 23:33 SEČ: po doplnění `WHATSAPP_VERIFY_TOKEN` akce `webhook` → `ok`; Meta ověřila `whatsapp-webhook` (GET s ověřovacím tokenem) a číslo teď hlásí `webhook_configuration.application` = `…/functions/v1/whatsapp-webhook`, odběr aplikace `whatsapp_business_account` aktivní s polem `messages`. `flek_business_confirmed` Meta zamítla podruhé (`INCORRECT_CATEGORY`); třetí znění bez věty o ověření kódu nasazené (verze funkce 29) a ve 23:37 znovu odeslané → PENDING. `manual_confirmation_enabled` = `true`, takže se tahle šablona teď neposílá (za 7 dní žádná rezervace potvrzená bez rozhodnutí podniku).
- 25. 9. 00:07 SEČ (naplánovaná kontrola): všech pět šablon PENDING, třetí znění `flek_business_confirmed` ani po 30 minutách zamítnuté není (druhé Meta zamítla do dvou minut); webhook dál míří na `whatsapp-webhook`, odběr aplikace aktivní (`messages`), `WHATSAPP_VERIFY_TOKEN` vyplněný. `whatsapp_enabled` zůstává `false`.
- 25. 9. 9:40 pražského času (ranní naplánovaná kontrola spuštěná v 8:11, `whatsapp-templates-setup` z databáze s klíčem workeru, `dry_run`, HTTP 200): všech pět šablon pořád PENDING, žádná zamítnutá (`rejected_reason` prázdné), takže nic k přepsání ani k novému odeslání; webhook čísla i odběr aplikace dál míří na `…/functions/v1/whatsapp-webhook` (pole `messages`, aktivní), aplikace FLEK přihlášená k odběru účtu; číslo `name_status` AVAILABLE_WITHOUT_REVIEW, kvalita zatím UNKNOWN. `whatsapp_enabled` zůstává vypnuté. Další kontrola naplánovaná na 14:10.

## Zvonění žádosti a upozornění — 25. 9. 2026

- Náhled partnerské části s čekající žádostí na 375 a 1280 px: bez klepnutí lišta „Nová žádost o rezervaci čeká na potvrzení · Zvuk je vypnutý · Zapnout zvuk“; po klepnutí na nadpis zvuk odemčen, lišta „Ztlumit“, titulek karty střídá „🔔 Nová žádost o rezervaci“ a „(1) FLEK Partner“; po „Ztlumit“ lišta zmizí a titulek zůstane „(1) FLEK Partner“. Bez vodorovného přetečení. Provozovna: „Vyzkoušet zvonění“ zahraje (bez hlášky o blokaci), obě tlačítka 44 px.
- Profil → Upozornění v náhledu: políčko „Potvrzená rezervace · Telefon“ zaškrtnuté 60 ms po klepnutí, druhé políčko klikatelné hned, obě po uložení drží; když registrace zařízení selže, hláška „Nastavení je uložené, ale oznámení se na tomhle zařízení nezapnula. …“ česky, bez neošetřené chyby v konzoli.
- `public/sw.js` projde `node --check`; `notification-delivery` se sestaví. Build a 163 unit testů PASS (nový `tests/ringer.test.ts`).
- **Důkladné ověření (25. 9. v noci).** Jednotkové testy v CI: `tests/ringer.test.ts` (Web Audio napodobené: bez odemčení nic nehraje, smyčka se nezdvojí, zastavení i vibrace, zkušební zazvonění bez smyčky, ztlumení jen daných žádostí, zvuk dvou tónů s pauzou a bez přebuzení), `tests/devicePush.test.ts` (nejdřív povolení, znovupoužití registrace se stejným klíčem, zahození registrace s jiným klíčem, druhý pokus po „could not retrieve the public key“, srozumitelná česká hláška a vykání, nic bez povolení) a `tests/serviceWorker.test.ts` (žádost pro podnik zůstane na obrazovce s vibrací, ostatní beze změny, zákaznické oznámení nikdy jako žádost, jen adresy FLEKu, žádné detaily rezervace). Každý test ověřen i schválně rozbitým kódem (vypnutá smyčka, bez druhého pokusu, bez `requireInteraction`, ztlumení bez účinku): pokaždé selhal. Celkem 179 testů PASS.
- Scénáře v Chromiu se sledovaným Web Audio (23/23 PASS): bez klepnutí ticho a „Zapnout zvuk“; klepnutí → smyčka a vibrace, po 6 s pořád jeden zvuk; Ztlumit → ticho i po dalším načtení; druhá žádost zase zvoní; vyřízená žádost ztichne sama; žádost s krátkým časem ztichne 3 s po vypršení; titulek bliká jen při zvonění; „Zapnout zvuk“ zahraje jedno zazvonění bez smyčky; Provozovna: zkušební zazvonění, zámek obrazovky zapnout i uvolnit. Test našel chybu, že stisk „Zapnout zvuk“ nejdřív odemkl zvuk globálně, tlačítko se pod prstem změnilo na „Ztlumit“ a zvonění se hned ztlumilo; opraveno (`data-ring-unlock`, ztlumení před odemčením).
- Scénáře nastavení upozornění v Chromiu s napodobenou registrací (14/14 PASS): „Zapnout“ zaregistruje zařízení a zaškrtne Telefon u všech událostí; jedna chyba prohlížeče → druhý pokus uspěje; opakovaná chyba → volba uložená a česká rada; odmítnutí serverem → políčko se vrátí a řekne proč; dvě rychlá klepnutí na jeden řádek se obě uloží; partnerská část vyká.
- `notification-delivery` spuštěná proti napodobené databázi a push službě: žádost pro podnik nese `kind: request`, zákaznické oznámení a zrušení pro podnik ne, payload jen `url`, `id` a `kind`, všechna doručení uzavřena jako `sent`.
- Databáze v transakci, která se vrátila: u demo podniku se zapnutým Telefonem pro „Nová žádost“ vytvoří přechod rezervace do `pending_merchant` jedno upozornění a jedno doručení na push zařízení (e-mail ne, demo adresy `@flek.test`). Po testu nezůstalo nic: testovací zařízení neexistuje, rezervace má původní stav.

## Nová žádost přes celou obrazovku — 25. 9. 2026

- Build (`tsc` + Vite) a 190 unit testů PASS; nové `tests/incomingRequest.test.ts` (fronta, „Později“ a „Zobrazit“, dokončená žádost se nevrátí, ubývání odpočtu, výsledky ze serveru, žádost ukončená jinde, vykání, české tvary počtu). Produkční CSS obsahuje varianty `short` a `flat` uvnitř `@media`.
- Scénáře v Chromiu nad náhledem partnerské části se sledovaným Web Audio a napodobeným `respond_to_booking` (71/71 PASS): dialog přes celou obrazovku s `role="alertdialog"` a fokusem na nadpisu, karta se službou, časem, zákazníkem a částkou, odpočet; bez klepnutí ticho, klepnutí na pozadí zvuk neodemkne, stránka pod dialogem není klikatelná, dotykové plochy ≥ 44 px, bez vodorovného posunu; „Zapnout zvuk“ → smyčka, vibrace a blikající titulek, „Ztlumit“/„Ztlumeno“ tam a zpět; potvrzení hned ztiší, pošle `accept: true`, ukáže fajfku a čárky a do 5 s se zavře, po dalším načtení dat se nevrátí; klepnutí v prvních 0,7 s se nepočítá; odmítnutí se ptá, „Zpět“ vrátí tlačítka, odmítnutí pošle `accept: false`; chyba serveru česky, žádost zase zvoní a druhý pokus projde; „Později“ a Esc žádost odloží (zvoní dál, lišta se „Zobrazit“ a „Ztlumit“), nová žádost obrazovku převezme; dvě žádosti za sebou přes „Další žádost“; potvrzení z jiného zařízení a vypršení se ukážou a počkají, nová žádost je vystřídá; poslední minuta jantarově; při omezeném pohybu neběží žádná animace; vlnění má periodu 2,6 s; Tab zůstává v dialogu.
- Původní scénáře zvonění upravené na novou obrazovku 25/25 PASS (smyčka se nezdvojí, ztlumená žádost nezazvoní ani po dalším načtení dat, vyřízená a vypršelá přestane zvonit, titulek, jednorázové zazvonění v liště, zkušební zvonění a rozsvícený displej v Provozovně).
- Snímky na 320×568, 360×600, 375×667, 390×844, 844×390, 768×1024, 1024×768, 1280×720 a 1280×800: tlačítko „Potvrdit rezervaci“ je vidět bez posouvání všude; na 320×568 se obsah nad ním posouvá a tlačítka zůstávají přilepená dole.

## Nový vzhled žádosti přes celou obrazovku — 25. 9. 2026

- Build a 191 unit testů PASS (nový test `startsIn`: „za 18 min“, „za 3 hodiny“, „za 3 dny“). Produkční CSS má variantu `split` ve dvou `@media` (tablet a počítač; telefon na šířku), ne jen v první.
- Scénáře celé obrazovky 71/71 a zvonění 25/25 PASS i s novým rozvržením (stejné kontroly jako výše: fokus, neaktivní stránka pod dialogem, 44px plochy, zvuk, ztlumení, potvrzení a odmítnutí, chyba serveru, „Později“ a Esc, dvě žádosti, žádost vyřízená jinde a vypršelá, omezený pohyb, Tab).
- Snímky na 320×568, 360×640, 375×667, 390×844, 844×390, 1024×768 a 1280×800 ve stavech zvoní, dotaz na odmítnutí a potvrzeno: bez vodorovného posunu; „Potvrdit rezervaci“ vidět bez posouvání všude, na 320×568 je panel o 16 px vyšší než displej a tlačítka zůstávají přilepená dole; na telefonu na šířku jsou tlačítka nahoře jen nad modrou půlkou, na tabletu a počítači nad bílou ve světlých barvách.

## WhatsApp: proč šablony čekají — 25. 9. 2026

- 11:06 (Praha), `whatsapp-templates-setup` z databáze s klíčem workeru, `dry_run`, HTTP 200, nová diagnostika: WhatsApp účet `account_review_status` APPROVED, `business_verification_status` pending_submission, vlastník SELF; `health_status` účtu BLOCKED — WABA 141006 (chyba platební metody, blokuje zprávy začínané firmou), BUSINESS 141010 (firma neověřená) a 131000 (profil firmy bez právního názvu, země a webu; „before integrity checks can proceed“), aplikace FLEK AVAILABLE. Číslo +1 555-156-7838 „Test Number“: CONNECTED, LIVE, Cloud API, TIER_250; na úrovni čísla AVAILABLE (jen volání přes SIP blokované, FLEK ho nepoužívá). Šablony dál všech pět PENDING.
- `tests/whatsappHealth.test.ts` nad skutečnou odpovědí Mety: tři blokace česky a jednou (profil, platba, ověření), volání přes SIP vynechané, neznámá chyba slovy Mety, posílání jen při AVAILABLE účtu i čísla, poznání testovacího čísla. Build a 195 unit testů PASS.
- Panel WhatsApp v administraci s blokovaným účtem vykreslený na 390 a 1280 px: bez přetečení, řádek „Účet u Mety“ nahoře, u čísla upozornění na testovací číslo, „Zpřístupnit WhatsApp“ zamčené.
- 14:41 (Praha, odpolední naplánovaná kontrola spuštěná ve 14:11, `dry_run`, HTTP 200): **beze změny.** Všech pět šablon PENDING, žádná zamítnutá (nic k přepsání ani k novému odeslání); účet dál BLOCKED se stejnými kódy 141006, 141010 a 131000, `business_verification_status` pending_submission; číslo CONNECTED, LIVE, TIER_250; odběr aplikace FLEK aktivní a webhook dál na `…/functions/v1/whatsapp-webhook` (pole `messages`); všech 11 klíčů `WHATSAPP_*` v secrets. `whatsapp_enabled` zůstává `false`. Další kontrola 26. 9. ráno.

## UX/UI audit — 25. 9. 2026

- **Jak.** Chromium (Playwright) nad www.app-flek.eu a po opravách nad produkčním buildem s hostovanými daty: 14 stránek (Objevit, Mapa, detail nabídky, stránka podniku, Oblíbené, Rezervace, Profil, Přihlášení, Pro podniky, obojí podmínky, zásady, neexistující stránka, pozvánka) na 320, 375, 768 a 1280 px. Na každé axe-core (WCAG 2.1 A/AA a best practices), vodorovné přetečení, dotykové plochy pod 44 px, rozbité obrázky, chyby v konzoli a selhané požadavky; snímky prošlé očima. Partnerská část a administrace v náhledu s podvrženými daty (Přehled, Nabídky, Služby, Provozovna, Rezervace, Metriky, WhatsApp).
- **Bez nálezu:** chyby v konzoli, selhané požadavky, rozbité obrázky, kontrast.
- **Nalezeno a opraveno:**
  - Tablet 768 px: hlavička o 15 px širší než displej na 11 stránkách (pět položek s ikonami, logo a „Pro podniky“). Menu je na tabletu jen slovy, ikony se vrátí od 1024 px; odznak nových míst v Oblíbených stojí za slovem.
  - Dotykové plochy: odkaz na podnik a na hodnocení v detailu nabídky (32 px), „Zpět na nabídky“ na neexistující stránce a u chybějící nabídky (20 px), „Přiblížit“ a „Oddálit“ na mapě (29 px, pravidlo prohrávalo se styly MapLibre načtenými později), zaškrtávátko souhlasu s podmínkami v Provozovně. „Zdroje mapy“ zůstávají vidět ve 24 px, ale klepnout jde do 44 px (ověřeno `elementFromPoint` 8 px od okraje na všech čtyřech stranách).
  - axe: hvězdičky hodnocení s `aria-label` bez role na stránce podniku a v Rezervacích a špendlík, který v detailu nabídky nejde vybrat, dostaly `role="img"`; poznámka v Metrikách byla `<p>` uvnitř `<dl>`, je `<dd>`.
  - Štítek „ilustrační foto“ byl na světlé fotce skoro neviditelný (bílý text se stínem), je v malé tmavé průsvitné pilulce.
  - Detail nabídky, kterou už nejde rezervovat: na počítači karta vpravo dál ukazovala modré „Tvůj termín ✓“ a důvod byl pod ohybem. Karta je teď šedá s „Tenhle čas už nejde rezervovat“ a pod ní důvod s odkazem „Co teď?“ na náhradu; po klepnutí stojí nadpis náhrady 96 px od horního okraje, pod lepicí hlavičkou (69 px) nezmizí (ověřeno klepnutím na 375 a 1280 px).
  - Termín, který právě běží, se hlásil jako „Tenhle FLEK už proběhl… je minulostí“. Nově „Tenhle FLEK už začal“; „proběhl“ až po konci (`unavailableReason` vrací `ended`, nový test).
- **Po opravách** stejný běh nad produkčním buildem s hostovanými daty: 56 kombinací stránka × šířka, přetečení 0, axe 0 porušení, pod 44 px jen skrytý odkaz „Přeskočit na obsah“ (ukáže se při fokusu) a na mapě dva špendlíky zachycené během animace (v klidu přesně 44 × 44 px). Odznak v navigaci ověřen na 375, 768, 1024 a 1280 px. Build a 196 unit testů PASS; scénáře celé obrazovky 71/71 a zvonění 25/25 PASS.
