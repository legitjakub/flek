# FLEK — přehled projektu

> Aktualizováno 13. 9. 2026. Zdroj pravdy je repozitář (`docs/NOTION.md`). Stránku aktualizuje Claude na požádání; ruční úpravy tady se při další aktualizaci přepíšou.

## Ve zkratce

FLEK je český marketplace pro volná místa na poslední chvíli. Podnik (kadeřnictví, masáže, jóga, sport, wellness) zveřejní termín, který by jinak propadl, a zákazník si ho se slevou rezervuje, zaplatí v aplikaci a v podniku ukáže kód.

| Co | Stav |
| --- | --- |
| Fáze | Fáze 1 — demo pilot (běží veřejně, platby přes Stripe v testovacím režimu) |
| Web | https://www.app-flek.eu (původní https://flek-nine.vercel.app funguje dál) |
| Kód | https://github.com/legitjakub/flek (větev `main`) |
| Poslední nasazení | 13. 9. 2026 (vždy poslední commit ve větvi `main`) |
| Testy | unit testy a build v CI při každém pushi, akceptační kontroly proti hostované databázi (13. 9.: 99/99 s upozorněními a Stripe) |
| Data v produkci (13. 9.) | 18 schválených podniků, 330 nabídek, 321 rezervací, 16 účtů (12 demo, 4 ostatní), od 13. 9. platby jen přes Stripe (test), 16 demo podniků s testovacím Stripe účtem |
| Pro AI agenty | `AGENTS.md` v kořeni repozitáře (Claude Code ho načítá přes `CLAUDE.md`) |

## Na tahu je Jakub

Úkoly, které AI agent udělat nesmí nebo nemůže, protože jde o klíče, hesla nebo platbu kartou. Hotové odškrtni.

- [x] **Doplnit klíče pro upozornění v Supabase.** `NOTIFICATION_FROM` a `VAPID_PUBLIC_KEY` doplnil Claude, `VAPID_PRIVATE_KEY` Jakub (13. 9.). Otisk klíče sedí se souborem a doručovací funkce s ním běží.
- [ ] **Vyměnit klíč Resendu.**
  1. V resend.com otevři API keys → Create API key. Název „FLEK“, oprávnění Sending access, doména `mail.app-flek.eu`.
  2. Nový klíč vlož v Supabase na dvě místa: Edge Functions → Secrets jako `RESEND_API_KEY` a Authentication → Emails → SMTP Settings → Password.
  3. Potom v Resendu smaž oba staré klíče („FLEK production“ a „FLEK production rotated“). Objevily se v záznamu Codexu.
- [x] **Vyzkoušet e-maily.** Claude 13. 9. poslal na jakub.hrncir24@gmail.com „Obnova hesla — FLEK“ a „Zkušební upozornění — FLEK“, Resend oba hlásí Delivered. Zkontroluj, že nepadly do spamu. Odkaz z obnovy hesla použít nemusíš.
- [ ] **Vyzkoušet platbu a upozornění.**
  1. Rezervuj FLEK u demo podniku a zaplať testovací kartou 4242 4242 4242 4242 (libovolné budoucí datum a CVC).
  2. Zkontroluj kód rezervace, zvonek v aplikaci a e-mail „Tvůj FLEK je rezervovaný“.
  3. Rezervaci zruš a ověř vratku a e-mail o zrušení.
- [ ] **Uložit VAPID klíče do správce hesel.** Jde o řádky `VAPID_PUBLIC_KEY` a `VAPID_PRIVATE_KEY` z uvedeného souboru. Soubor `/private/tmp/flek-notification-secrets.env` pak smaž.
- [ ] **Propojit podnik „Kubova“ se Stripe.** Partner → Provozovna → „Propojit se Stripe“ (v testovacím režimu stačí testovací údaje). Bez propojení podnik nemůže zveřejnit FLEK.
- [x] **Odhlásit se z Endory.** Přihlášení už vypršelo (13. 9.), DNS záznamy pro Resend jsou uložené a ověřené.

## Todolist

Rozdělení vychází z auditu 13. 9. 2026 (bezpečnostní audit ChatGPT ověřený proti kódu a produkční databázi a doplněný o chybějící oblasti).

### Fáze A — demo pilot (hotovo 13. 9.)

- [x] Denní obnova demo FLEKů na 3 dny dopředu (jen demo podniky `@flek.test`)
- [x] Veřejná data jen přes čtecí RPC; anon už nečte tabulky podniků, služeb a nabídek
- [x] Bezpečnostní hlavičky: CSP, nosniff, Referrer-Policy, Permissions-Policy, zákaz vložení do rámu
- [x] Audit log admin změn (neměnný) a záložka Administrace → Audit
- [x] Zapomenuté heslo (odkaz e-mailem a nastavení nového hesla)
- [x] Chyba jedné stránky neshodí aplikaci; po nasazení se stará záložka sama obnoví
- [x] Analytika: poloha jen na ~1 km, limit velikosti, mazání po 180 dnech
- [x] Limity délek textů a allowlist adres fotek v databázi; interní funkce bez práv pro klienty
- [x] CI na GitHubu (build, unit testy, audit závislostí), secret scanning, Dependabot
- [x] Oprava popisu webu („zaplatíš v aplikaci“), náhled odkazu při sdílení, vysvětlení řazení „Doporučené“
- [x] Nový vzhled zákaznické appky, volné FLEKy, přehled v Notionu a `AGENTS.md` (13. 9.)

### Fáze B — nutné před ostrým pilotem

Podrobný rozpis (co musí udělat člověk, co zvládne AI agent, postup spuštění) je v `docs/PRED_SPUSTENIM.md`.

- [x] Supabase Auth: Site URL `https://www.app-flek.eu` a návratové adresy pro potvrzení účtu a obnovu hesla (13. 9.)
- [ ] Oddělit prostředí: nový produkční Supabase projekt, současný zůstane jako demo/staging s akceptačními testy
- [ ] Produkce na Supabase Pro (zálohy, bez uspávání, ochrana proti prolomeným heslům)
- [ ] Převést Supabase projekt na firemní účet s 2FA a druhým vlastníkem
- [x] Vlastní SMTP přes Resend z `mail.app-flek.eu`, české šablony potvrzení účtu a obnovy hesla (13. 9.; DNS záznamy v Endoře, doména v Resendu ověřená)
- [x] Upozornění na potvrzenou a zrušenou rezervaci pro zákazníka i podnik: v aplikaci, e-mailem a push, nastavitelné (13. 9.)
- [ ] Připomínka před termínem a e-mail o vratce
- [x] Platby přes Stripe Connect: Checkout, poplatek FLEKu jako application fee, výplaty a KYC podniků přes Stripe, ověřený webhook, vratky přes refund API (13. 9., testovací režim)
- [x] Odebrat demo platby (`start_payment` jen Stripe, `demo_confirm_payment` zrušená) (13. 9.)
- [ ] Ostrý Stripe: živé klíče a webhook, `stripe_test_mode=false`, potvrdit odpovědnost platformy v Connect nastavení, vypnout `stripe-test-pay`
- [ ] Poslouchat události Accounts v2 (`v2.core.account[...]`) nebo Connect webhook `account.updated`, ať se stav účtu podniku mění i bez otevření aplikace
- [ ] Skrýt ve feedu FLEKy podniků, kterým Stripe omezil platby; formulář „Výplatní údaje“ sladit se Stripe (číslo účtu už zadává podnik u Stripe)
- [ ] Fakturace servisního poplatku podnikům a účetní export plateb
- [ ] Povinné MFA (TOTP) pro administrátory, CAPTCHA (Turnstile) u registrace, `secure_password_change`, přísnější limity
- [ ] Obchodní podmínky pro zákazníky (vč. výjimky z odstoupení u služeb s termínem a pravidel nedostavení) a pro podniky (P2B: řazení, pozastavení, stížnosti)
- [ ] Zásady ochrany osobních údajů, seznam zpracovatelů, rozhodnutí o souhlasu s analytikou
- [ ] Verze a hash dokumentu u souhlasu podniku s podmínkami
- [ ] Smazání účtu (anonymizace, finanční záznamy zůstanou) a export dat
- [ ] Admin nástroj na ruční vratku a storno (se zápisem do audit logu)
- [x] Vratky podle skutečného stavu ve Stripe: vráceno až po potvrzení, selhaná vratka jde člověku (14. 9., P0 z auditu)
- [ ] Přehled a upozornění pro admina na vratky, které Stripe zamítl nebo které 8× selhaly
- [ ] Sentry pro chyby v aplikaci, upozornění při selhání cronu nebo webhooku, jednou vyzkoušené obnovení ze zálohy
- [ ] Mapy a hledání adres: licencovaný poskytovatel nebo vlastní limity (ArcGIS záloha a veřejné Photon API nejsou na komerční provoz)
- [ ] Nastavit skutečný e-mail podpory (`VITE_SUPPORT_EMAIL`); doména www.app-flek.eu už běží
- [ ] Otestovat na fyzickém iPhonu v Safari včetně skenování QR kamerou
- [ ] Zvážit soukromý repozitář a ochranu větve `main` (povinné zelené CI)

### Fáze C — růst

- [ ] Role v podniku: vlastník → manažer → recepce (recepce jen ověřuje kódy)
- [ ] Nahrávání vlastních fotek podnikem s přepočtem, odstraněním EXIF a limitem rozměrů
- [ ] Google hodnocení s cache, rate limitem a hlídáním rozpočtu (dnes nenasazené)
- [x] Web push upozornění pro podnik i zákazníka (13. 9.)
- [ ] Kredit za doporučení
- [ ] Menší balík aplikace (mapa 979 kB, Temporal 325 kB) a měření Lighthouse
- [ ] Napojení na rezervační systémy podniků, další města

## Fáze projektu

| Fáze | Obsah | Stav |
| --- | --- | --- |
| 0 — Základ | Zákaznický, partnerský a admin tok, rezervace s QR, vyhledávání podle polohy, zabezpečení dat (RLS) | hotovo 7.–8. 9. |
| 1 — Demo pilot | Cenový model, spolehlivé rezervace, upozornění podniku, nový vzhled, veřejné nasazení, zabezpečení z auditu (fáze A) | běží teď |
| 2 — Ostrý pilot v Praze | Oddělená produkce, skutečné platby a výplaty, e-maily, MFA, právní texty, reálné podniky | čeká na todolist fáze B |
| 3 — Růst | Google hodnocení, doporučení s kreditem, role v podniku, další města | později |

## Jak FLEK funguje

### Zákazník

1. Otevře Objevit nebo Mapu a vidí volné FLEKy v okolí (výchozí okruh 5 km a dnešek; když nic není, hledání se samo rozšíří až na 25 km a na celý týden a řekne to).
2. Filtruje podle času (Vše, Teď, Do 2 h, Dnes, Zítra), denní doby (Ráno, Odpoledne, Večer), kategorie, minimální slevy a maximální ceny; řadí podle doporučení, vzdálenosti, slevy, ceny nebo začátku.
3. Na detailu vidí konečnou cenu včetně poplatku a úsporu proti běžné ceně.
4. Rezervuje a zaplatí kartou, Apple Pay nebo Google Pay na stránce Stripe Checkout (v pilotu testovací karta 4242 4242 4242 4242). Místo obsadí webhook Stripe, zákazník se vrátí na kód rezervace. Bez účtu může prohlížet, k rezervaci se musí přihlásit. Zapomenuté heslo si obnoví odkazem z e-mailu.
5. Dostane rezervační kód a QR, najde je v Rezervacích. O potvrzení a zrušení ví ze zvonku v aplikaci, e-mailem a (když si zapne) oznámením na telefonu.
6. Zdarma může zrušit do 60 minut před začátkem (podnik si lhůtu může změnit) nebo do 10 minut od rezervace, podle toho, co nastane později.
7. Oblíbené podniky může sledovat a vidí u nich nové FLEKy; může pozvat kamaráda odkazem `/r/kód` a nainstalovat si appku na plochu.

### Podnik (`/partner`)

1. Registruje provozovnu, admin ji schválí.
2. Přidá služby z připravených šablon podle kategorie nebo vlastní.
3. Zveřejní FLEK: čas, kapacita a částka, kterou chce dostat. Sleva pro zákazníka musí být aspoň 10 % a cena aspoň 15 % běžné ceny; server hlídá i kolize termínů.
4. Dostane upozornění na novou rezervaci a storno (v aplikaci vždy, e-mail a push podle nastavení v Provozovně), u pultu ověří kód zákazníka, případně označí „Nedorazil“.
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
- Veřejná data (nabídky, podniky) jdou jen přes čtecí funkce; přímo z tabulek je čte jen člen podniku a admin.
- Každá změna v administraci se zapíše do neměnného audit logu.
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
| Obnova demo nabídek | `pg_cron`, job `flek-demo-refresh` (každé ráno) | doplní demo FLEKy na 3 dny dopředu; před ostrým provozem vypnout |
| Mazání staré analytiky | `pg_cron`, job `flek-analytics-retention` (každé ráno) | smaže události starší 180 dní |
| Kontrola kódu | GitHub Actions (`.github/workflows/ci.yml`) | build, unit testy a audit závislostí při každém pushi; secret scanning a Dependabot |
| Bezpečnostní hlavičky | Vercel (`vercel.json`) | CSP s allowlistem domén; nová služba se musí přidat |
| Platby | Stripe Connect (testovací režim, sandbox FLEK) | Checkout, destination charges, účty podniků přes Accounts v2; klíče v Supabase secrets |
| Platební Edge Functions | Supabase: `stripe-checkout`, `stripe-webhook`, `stripe-connect`, `stripe-refunds`, `stripe-test-pay` | webhook: `https://yupkrntknbkvmlajwlph.supabase.co/functions/v1/stripe-webhook` |
| Údržba plateb | `pg_cron`, job `flek-stripe-maintenance` (každých 5 min) | vrátí zaplacené platby bez rezervace po 60 min, uzavře opuštěné pokusy, dožene frontu vratek |
| Doména | www.app-flek.eu: DNS v Endoře (freehosting), web na Vercelu | kořenová doména a e-mailové schránky zůstávají u Seznamu |
| E-maily | Resend, odesílací subdoména `mail.app-flek.eu` | SMTP pro Supabase Auth (ověření účtu, obnova hesla) i upozornění na rezervace |
| Upozornění na rezervace | trigger `booking_notification`, fronta `private.notification_delivery`, Edge Function `notification-delivery`, cron `flek-notification-delivery` (každou minutu, jen když je co doručit) | zvonek v aplikaci, e-mail, Web Push (VAPID) |
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
| `VITE_NOTIFICATIONS_ENABLED` | Vercel | `true` zapne zvonek a nastavení upozornění |
| `VITE_VAPID_PUBLIC_KEY` | Vercel | veřejný klíč pro Web Push |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Supabase secrets | platby přes Stripe |
| `RESEND_API_KEY`, `NOTIFICATION_FROM` | Supabase secrets | e-mailová upozornění (odesílatel `FLEK <rezervace@mail.app-flek.eu>`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Supabase secrets | odesílání Web Push |
| `GOOGLE_MAPS_API_KEY` | Supabase secrets | zatím nenastaveno, pro Google hodnocení |

Service-role klíč nikdy nepatří do aplikace ani do repozitáře. Hesla demo účtů nejsou v repozitáři.

## Obrazovky

| Role | Adresy |
| --- | --- |
| Zákazník | `/` Objevit, `/mapa`, `/nabidka/:id`, `/podnik/:id`, `/oblibene`, `/rezervace`, `/profil`, `/prihlaseni`, `/potvrzeni`, `/r/:kód` |
| Podnik | `/partner`, `/partner/nabidky`, `/partner/rezervace`, `/partner/sluzby`, `/partner/provozovna`, `/partner/metriky`, `/partner/registrace` |
| Admin | `/admin`, `/admin/nabidky`, `/admin/rezervace`, `/admin/uzivatele`, `/admin/metriky`, `/admin/audit` |

## Pro AI agenty a předávání práce

- Každý agent začíná souborem `AGENTS.md`: mapa kódu, pravidla, postup nasazení a migrací, co nespouštět.
- Zákaznická část tyká, partnerská vyká; zákazníkovi se termínu říká „FLEK“.
- Po každé změně agent zapíše: řádek do historie v `docs/PROJECT_STATUS.md`, úkol a historii sem do `docs/NOTION.md`, a přepíše Notion stránku.
- Nespouštět `npm run db:types`; akceptační testy mění demo data; hesla se nikdy necommitují.
- Nová externí doména musí do CSP ve `vercel.json`; nová admin akce zapisuje `private.audit(...)`; veřejná data jen přes RPC.

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
| `npm run test:acceptance` | ~100 kontrol proti hostované databázi (mění demo data) |

Podrobnosti: `README.md`, `docs/PROJECT_STATUS.md`, `LIMITATIONS.md`, `VERIFICATION.md`, `DECISIONS.md`.

## Historie změn

| Datum | Změna |
| --- | --- |
| 14. 9. 2026 | Oprava vratek z auditu: platba je vrácená, až když to Stripe potvrdí; vratka, která selže i dodatečně, se vrátí na zaplaceno a vyřeší ji člověk; zákazník vidí „Vracíme peníze“ |
| 13. 9. 2026 | Push upozornění připravená: `VAPID_PRIVATE_KEY` v Edge Function secrets |
| 13. 9. 2026 | E-mailová upozornění zapnutá (`NOTIFICATION_FROM`, `VAPID_PUBLIC_KEY`), zkušební e-maily obnovy hesla a upozornění doručené |
| 13. 9. 2026 | Nová paleta „Mandarinka“: téměř černá, mandarinková a neutrální pozadí v aplikaci, logu, ikonách, mapě a e-mailech |
| 13. 9. 2026 | Sekce „Na tahu je Jakub“: klíče pro upozornění, výměna klíče Resendu, zkouška e-mailů a platby, propojení podniku se Stripe |
| 13. 9. 2026 | Dokončení práce ChatGPT: olivová paleta a logo, univerzální obrázek služby, kompaktní náhled na mapě, e-maily přes Resend na www.app-flek.eu, upozornění na rezervace v aplikaci, e-mailem a push; opravené doručování (dřív každé volání 401) |
| 13. 9. 2026 | Stripe Connect: platby jen přes Stripe Checkout, webhook obsazuje místo a vrací peníze, účty podniků přes Accounts v2, testovací účty pro 16 demo podniků, sekce „Platby a výplaty“ u partnera |
| 13. 9. 2026 | Audit: ověření auditu ChatGPT a fáze A — obnova demo FLEKů, čtecí RPC místo tabulek, CSP, audit log, zapomenuté heslo, CI, analytika bez přesné polohy |
| 13. 9. 2026 | Notion přehled ověřený proti kódu a produkční DB, `AGENTS.md` + `CLAUDE.md` pro AI agenty |
| 13. 9. 2026 | Volné FLEKy, ikona lístku, jeden řádek o rozšíření hledání, tlačítka rezervace v řadě |
| 13. 9. 2026 | Nový vzhled zákaznické appky inspirovaný Cuppkou: barevný profil, mapa s fotkami, plovoucí navigace |
| 13. 9. 2026 | Audit rolí, sladění migrací s hostovanou databází |
| 13. 9. 2026 | Cenový model v1, spolehlivé platby a vratky, automatické dokončení, upozornění podniku |
| 11. 9. 2026 | Oddělené zobrazení ceny zákazníka, výplaty podniku a výnosu FLEKu |
| 9.–10. 9. 2026 | Intro, carousel na mapě, galerie podle aktivity, Google hodnocení v kódu |
| 7.–8. 9. 2026 | Základní toky, rezervace s QR, RLS, vyhledávání podle polohy, platby a storno |
