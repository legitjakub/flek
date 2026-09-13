# FLEK — přehled projektu

> Aktualizováno 13. 9. 2026. Zdroj pravdy je repozitář (`docs/NOTION.md`). Stránku aktualizuje Claude na požádání; ruční úpravy tady se při další aktualizaci přepíšou.

## Ve zkratce

FLEK je český marketplace pro volná místa na poslední chvíli. Podnik (kadeřnictví, masáže, jóga, sport, wellness) zveřejní termín, který by jinak propadl, a zákazník si ho se slevou rezervuje, zaplatí v aplikaci a v podniku ukáže kód.

| Co | Stav |
| --- | --- |
| Fáze | Fáze 1 — demo pilot (běží veřejně, peníze jsou jen ukázkové) |
| Web | https://flek-nine.vercel.app |
| Kód | https://github.com/legitjakub/flek (větev `main`) |
| Poslední nasazení | 13. 9. 2026, commit `a98b633` |
| Testy | 81 unit testů, 100 API akceptačních kontrol, build prochází |

## Todolist

### Nutné před ostrým pilotem

- [ ] Napojit skutečnou platební bránu (dnes `provider=demo`, nic se nestrhává)
- [ ] Skutečné vracení peněz přes API brány (dnes jen změna stavu v databázi)
- [ ] Výplaty podnikům a účetní doklady
- [ ] Obchodní podmínky a zásady ochrany osobních údajů (texty + stránky v aplikaci)
- [ ] Oddělit reálná data od demo seedu a demo účtů `demo-*@flek.test`
- [ ] Zapnout v Supabase ochranu proti prolomeným heslům (hlásí advisor)
- [ ] Zkontrolovat Storage politiky pro fotky před ostrým provozem
- [ ] Nastavit skutečný e-mail podpory (`VITE_SUPPORT_EMAIL` ve Vercelu) — řádek Podpora v profilu se pak objeví sám
- [ ] Vlastní doména místo `flek-nine.vercel.app`

### Důležité

- [ ] Otestovat na fyzickém iPhonu v Safari, včetně skenování QR kódu kamerou
- [ ] Upozornění podniku při zavřené aplikaci (web push, SMS nebo e-mail) — dnes jen v otevřené aplikaci
- [ ] Google hodnocení: API klíč s billingem, nasadit funkci `google-place-rating`, doplnit Place ID podnikům
- [ ] Zmenšit balíček mapy (Vite hlásí chunk nad 500 kB) a změřit Lighthouse
- [ ] Nahrávání vlastních fotek podnikem
- [ ] Rozjet lokální integrační testy (`npm test` potřebuje Docker se Supabase)

### Později

- [ ] Pozvánky personálu a týmová oprávnění v podniku
- [ ] Kredit za doporučení (dnes se jen měří)
- [ ] Doplnit Playwright kontrolu nového vzhledu na 430 px

### Hotovo nedávno

- [x] Nový vzhled zákaznické appky: profil v barevných blocích, celoobrazovková mapa s fotkami ve špendlících, plovoucí navigace (13. 9.)
- [x] „Volné FLEKy“ místo „volné termíny“, ikona lístku u Rezervací, kompaktní tlačítka rezervace (13. 9.)
- [x] Cenový model v1 se servisním poplatkem, bezpečné opakování plateb, automatické dokončování rezervací (13. 9.)
- [x] Upozornění podniku na novou rezervaci přes Realtime (13. 9.)
- [x] Intro pro první návštěvu, galerie fotek podle aktivity (9.–10. 9.)

## Fáze projektu

| Fáze | Obsah | Stav |
| --- | --- | --- |
| 0 — Základ | Zákaznický, partnerský a admin tok, rezervace s QR, vyhledávání podle polohy, zabezpečení dat (RLS) | hotovo 7.–8. 9. |
| 1 — Demo pilot | Cenový model, spolehlivé rezervace, upozornění podniku, nový vzhled, veřejné nasazení | běží teď |
| 2 — Ostrý pilot v Praze | Skutečné platby a výplaty, právní texty, reálné podniky, test na telefonech | čeká na todolist „Nutné“ |
| 3 — Růst | Push upozornění, Google hodnocení, doporučení s kreditem, další města | později |

## Jak FLEK funguje

### Zákazník

1. Otevře Objevit nebo Mapu a vidí volné FLEKy v okolí (výchozí okruh 5 km; když nic není, hledání se samo rozšíří až na 25 km a řekne to).
2. Filtruje podle času (Teď, Do 2 h, Dnes, Odpoledne, Večer, Zítra), kategorie, slevy a ceny.
3. Na detailu vidí konečnou cenu včetně poplatku a úsporu proti běžné ceně.
4. Rezervuje a zaplatí v aplikaci (v pilotu ukázková platba).
5. Dostane rezervační kód a QR, najde je v Rezervacích.
6. Zdarma může zrušit do lhůty, pak už ne. Oblíbené podniky může sledovat a vidí u nich nové FLEKy.

### Podnik (`/partner`)

1. Registruje provozovnu, admin ji schválí.
2. Přidá služby z připravených šablon podle kategorie nebo vlastní.
3. Zveřejní FLEK: čas, kapacita a částka, kterou chce dostat.
4. Dostane upozornění na novou rezervaci, u pultu ověří kód zákazníka, případně označí „Nedorazil“.
5. Vidí metriky: rezervace, výplaty a naplněnost.

### Admin (`/admin`)

Schvaluje provozovny, kontroluje nabídky a rezervace, spravuje uživatele, vidí metriky pilotu a výnos FLEKu.

### Peníze

- Podnik zadá, kolik chce dostat. Server připočte servisní poplatek 5 % (zaokrouhleno na koruny, minimálně 25 Kč, maximálně 149 Kč).
- Příklad: běžně 1 000 Kč → podnik 750 Kč → poplatek 38 Kč → zákazník platí 788 Kč a ušetří 21 %.
- Každá rezervace si uloží neměnný finanční snímek; pozdější změna ceny ji neovlivní.
- Když zákazník nedorazí, podnik o svou částku nepřijde.

### Pravidla, která se nesmí obejít

- Kapacitu mění jen serverové funkce; aplikace ji nikdy nezapisuje sama.
- Stejná platba odeslaná dvakrát vytvoří jednu rezervaci a vezme jedno místo.
- Dostupnost („vyprodáno“, „prošlé“) se vždy počítá z databáze, neukládá se.
- Všechny částky jsou v haléřích, čas rozhoduje databázový `now()` v zóně Europe/Prague.

## Kde co běží

| Část | Služba | Poznámka |
| --- | --- | --- |
| Web aplikace | Vercel | automatické nasazení z `main` na GitHubu; nastavení ve `vercel.json` |
| Databáze, přihlašování, soubory | Supabase (projekt `yupkrntknbkvmlajwlph`) | PostgreSQL + PostGIS, Auth, Storage, zabezpečení RLS |
| Realtime upozornění | Supabase Realtime | záložně se aplikace ptá každých 30 s |
| Pravidelná údržba | Supabase `pg_cron`, job `flek-maintenance` | každých 15 min dokončí rezervace 24 h po konci a vrátí osiřelé platby starší 30 min |
| Google hodnocení | Supabase Edge Function `google-place-rating` | v kódu hotové, v produkci nenasazené |
| Mapové podklady | OpenFreeMap (styl `bright`) nad OpenStreetMap | zdarma, bez klíče |
| Ilustrační fotky | složka `public/images/services` + Unsplash | náhledy pro špendlíky v `thumbs/` |
| Kód | GitHub `legitjakub/flek` | — |
| Instalace na telefon | PWA (`public/sw.js`, manifest) | přidání na plochu z profilu |

### Technologie

React 19 + TypeScript + Vite, Tailwind v4, TanStack Query, React Hook Form + Zod, MapLibre GL, Supabase JS. Testy: Vitest, Playwright, akceptační skript proti hostované databázi.

### Proměnné prostředí

| Proměnná | Kde | K čemu |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Vercel, `.env.local` | adresa Supabase projektu (musí být při sestavení) |
| `VITE_SUPABASE_ANON_KEY` | Vercel, `.env.local` | veřejný klíč Supabase |
| `VITE_SUPPORT_EMAIL` | Vercel | volitelné, zobrazí Podporu v profilu |
| `GOOGLE_MAPS_API_KEY` | Supabase secrets | zatím nenastaveno, pro Google hodnocení |

Service-role klíč nikdy nepatří do aplikace ani do repozitáře. Hesla demo účtů nejsou v repozitáři.

## Účty a přístupy

| Účet | Role |
| --- | --- |
| `demo-customer@flek.test` | zákazník s historií rezervací |
| `demo-merchant@flek.test` | partner se schválenou provozovnou |
| `demo-merchant2@flek.test` | partner čekající na schválení |
| `demo-admin@flek.test` | administrace (vlastní heslo) |

## Jak s projektem pracovat

| Příkaz | Co dělá |
| --- | --- |
| `npm run dev` | lokální vývoj |
| `npm run build` | kontrola typů a produkční build |
| `npm run test:unit` | unit testy |
| `npm run test:acceptance` | 100 kontrol proti hostované databázi (mění demo data) |

Podrobnosti: `README.md`, `docs/PROJECT_STATUS.md`, `LIMITATIONS.md`, `VERIFICATION.md`, `DECISIONS.md`.

## Historie změn

| Datum | Změna |
| --- | --- |
| 13. 9. 2026 | Volné FLEKy, ikona lístku, jeden řádek o rozšíření hledání, tlačítka rezervace v řadě |
| 13. 9. 2026 | Nový vzhled zákaznické appky inspirovaný Cuppkou: barevný profil, mapa s fotkami, plovoucí navigace |
| 13. 9. 2026 | Audit rolí, sladění migrací s hostovanou databází |
| 13. 9. 2026 | Cenový model v1, spolehlivé platby a vratky, automatické dokončení, upozornění podniku |
| 11. 9. 2026 | Oddělené zobrazení ceny zákazníka, výplaty podniku a výnosu FLEKu |
| 9.–10. 9. 2026 | Intro, carousel na mapě, galerie podle aktivity, Google hodnocení v kódu |
| 7.–8. 9. 2026 | Základní toky, rezervace s QR, RLS, vyhledávání podle polohy, platby a storno |
