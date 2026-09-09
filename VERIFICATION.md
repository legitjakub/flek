# Ověření FLEK

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
