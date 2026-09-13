# FLEK — přehled projektu

> Aktualizováno 13. 9. 2026. Zdroj pravdy je repozitář (`docs/NOTION.md`). Stránku aktualizuje Claude na požádání; ruční úpravy tady se při další aktualizaci přepíšou.

## Ve zkratce

FLEK je český marketplace pro volná místa na poslední chvíli. Podnik (kadeřnictví, masáže, jóga, sport, wellness) zveřejní termín, který by jinak propadl, a zákazník si ho se slevou rezervuje, zaplatí v aplikaci a v podniku ukáže kód.

| Co | Stav |
| --- | --- |
| Fáze | Fáze 1 — demo pilot (běží veřejně, peníze jsou jen ukázkové) |
| Web | https://flek-nine.vercel.app |
| Kód | https://github.com/legitjakub/flek (větev `main`) |
| Poslední nasazení | 13. 9. 2026 (vždy poslední commit ve větvi `main`) |
| Testy | 81 unit testů, 100 API akceptačních kontrol, build prochází |
| Data v produkci (13. 9.) | 18 schválených podniků, 330 nabídek, 321 rezervací, 16 účtů (12 demo, 4 ostatní), platby jen `demo` |
| Pro AI agenty | `AGENTS.md` v kořeni repozitáře (Claude Code ho načítá přes `CLAUDE.md`) |

## Todolist

### Nutné před ostrým pilotem

- [ ] Napojit skutečnou platební bránu (dnes `provider=demo`, nic se nestrhává)
- [ ] Odebrat nebo zamknout `demo_confirm_payment` (dnes ho může zavolat každý přihlášený a „zaplatit“ bez peněz)
- [ ] Skutečné vracení peněz přes API brány (dnes jen změna stavu v databázi)
- [ ] Výplaty podnikům a účetní doklady
- [ ] Obchodní podmínky a zásady ochrany osobních údajů (texty + stránky v aplikaci)
- [ ] Oddělit reálná data od demo seedu a demo účtů `demo-*@flek.test` (v produkční DB jsou dnes pomíchané: 12 demo a 4 ostatní účty)
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

- [x] Přehled v Notionu a `AGENTS.md` pro předávání práce mezi AI agenty (13. 9.)
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

1. Otevře Objevit nebo Mapu a vidí volné FLEKy v okolí (výchozí okruh 5 km a dnešek; když nic není, hledání se samo rozšíří až na 25 km a na celý týden a řekne to).
2. Filtruje podle času (Vše, Teď, Do 2 h, Dnes, Zítra), denní doby (Ráno, Odpoledne, Večer), kategorie, minimální slevy a maximální ceny; řadí podle doporučení, vzdálenosti, slevy, ceny nebo začátku.
3. Na detailu vidí konečnou cenu včetně poplatku a úsporu proti běžné ceně.
4. Rezervuje a zaplatí v aplikaci (v pilotu ukázková platba). Bez účtu může prohlížet, k rezervaci se musí přihlásit.
5. Dostane rezervační kód a QR, najde je v Rezervacích.
6. Zdarma může zrušit do 60 minut před začátkem (podnik si lhůtu může změnit) nebo do 10 minut od rezervace, podle toho, co nastane později.
7. Oblíbené podniky může sledovat a vidí u nich nové FLEKy; může pozvat kamaráda odkazem `/r/kód` a nainstalovat si appku na plochu.

### Podnik (`/partner`)

1. Registruje provozovnu, admin ji schválí.
2. Přidá služby z připravených šablon podle kategorie nebo vlastní.
3. Zveřejní FLEK: čas, kapacita a částka, kterou chce dostat. Sleva pro zákazníka musí být aspoň 10 % a cena aspoň 15 % běžné ceny; server hlídá i kolize termínů.
4. Dostane upozornění na novou rezervaci, u pultu ověří kód zákazníka, případně označí „Nedorazil“.
5. Vidí metriky: rezervace, výplaty a naplněnost.

### Admin (`/admin`)

Schvaluje provozovny, kontroluje nabídky a rezervace, spravuje uživatele, vidí metriky pilotu a výnos FLEKu.

### Peníze

- Podnik zadá, kolik chce dostat. Server připočte servisní poplatek 5 % (zaokrouhleno na koruny, minimálně 25 Kč, maximálně 149 Kč).
- Příklad: běžně 1 000 Kč → podnik 750 Kč → poplatek 38 Kč → zákazník platí 788 Kč a ušetří 21 %.
- Každá rezervace si uloží neměnný finanční snímek; pozdější změna ceny ji neovlivní.
- Když zákazník nedorazí, podnik o svou částku nepřijde.
- Výnos FLEKu je servisní poplatek; podnik dostane přesně částku, kterou zadal.

### Pravidla, která se nesmí obejít

- Kapacitu mění jen serverové funkce; aplikace ji nikdy nezapisuje sama.
- Stejná platba odeslaná dvakrát vytvoří jednu rezervaci a vezme jedno místo.
- Zákazník může mít najednou nejvýš 3 nadcházející rezervace; po 2 nedostaveních za 60 dní se mu rezervace zablokují (admin může výjimku).
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
| Mapové podklady | OpenFreeMap (styl `bright`) nad OpenStreetMap; záložní dlaždice ArcGIS World Street Map | zdarma, bez klíče |
| Hledání adresy | Photon (komoot) nad OpenStreetMap | výběr místa a adresa provozovny |
| Navigace | odkaz do Google Map | tlačítko Navigovat, bez API klíče |
| Analytika | vlastní tabulka přes RPC `record_event` | vyhledávání, zobrazení, rezervace, oblíbené, sdílení, pozvánky |
| Ilustrační fotky | složka `public/images/services` + Unsplash | náhledy pro špendlíky v `thumbs/` |
| Kód | GitHub `legitjakub/flek` | — |
| Instalace na telefon | PWA (`public/sw.js`, manifest) | cachuje jen skořápku aplikace, nabídky nikdy |
| Notion | stránka „FLEK — přehled projektu“ | kopie `docs/NOTION.md` |

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

## Obrazovky

| Role | Adresy |
| --- | --- |
| Zákazník | `/` Objevit, `/mapa`, `/nabidka/:id`, `/podnik/:id`, `/oblibene`, `/rezervace`, `/profil`, `/prihlaseni`, `/potvrzeni`, `/r/:kód` |
| Podnik | `/partner`, `/partner/nabidky`, `/partner/rezervace`, `/partner/sluzby`, `/partner/provozovna`, `/partner/metriky`, `/partner/registrace` |
| Admin | `/admin`, `/admin/nabidky`, `/admin/rezervace`, `/admin/uzivatele`, `/admin/metriky` |

## Pro AI agenty a předávání práce

- Každý agent začíná souborem `AGENTS.md`: mapa kódu, pravidla, postup nasazení a migrací, co nespouštět.
- Zákaznická část tyká, partnerská vyká; zákazníkovi se termínu říká „FLEK“.
- Po každé změně agent zapíše: řádek do historie v `docs/PROJECT_STATUS.md`, úkol a historii sem do `docs/NOTION.md`, a přepíše Notion stránku.
- Nespouštět `npm run db:types`; akceptační testy mění demo data; hesla se nikdy necommitují.

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
| 13. 9. 2026 | Notion přehled ověřený proti kódu a produkční DB, `AGENTS.md` + `CLAUDE.md` pro AI agenty |
| 13. 9. 2026 | Volné FLEKy, ikona lístku, jeden řádek o rozšíření hledání, tlačítka rezervace v řadě |
| 13. 9. 2026 | Nový vzhled zákaznické appky inspirovaný Cuppkou: barevný profil, mapa s fotkami, plovoucí navigace |
| 13. 9. 2026 | Audit rolí, sladění migrací s hostovanou databází |
| 13. 9. 2026 | Cenový model v1, spolehlivé platby a vratky, automatické dokončení, upozornění podniku |
| 11. 9. 2026 | Oddělené zobrazení ceny zákazníka, výplaty podniku a výnosu FLEKu |
| 9.–10. 9. 2026 | Intro, carousel na mapě, galerie podle aktivity, Google hodnocení v kódu |
| 7.–8. 9. 2026 | Základní toky, rezervace s QR, RLS, vyhledávání podle polohy, platby a storno |
