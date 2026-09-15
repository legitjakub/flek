# FLEK

FLEK je český marketplace pro **volnou kapacitu služeb na poslední chvíli**. Termín za 650 Kč v 18:30 má v 18:31 hodnotu nula. FLEK dovolí podniku proměnit tuhle mizející kapacitu na tržbu — se slevou, ale zaplacenou.

Pilot běží v Praze, jazyk je čeština, měna CZK, časová zóna Europe/Prague. Město je ale vždy jen data, nikde není zadrátované v kódu ani ve schématu.

Aplikace ověřuje jedinou hypotézu: **budou podniky opakovaně zveřejňovat zlevněné termíny na poslední chvíli a budou si je zákazníci rezervovat a doopravdy dorazí?**

## Dva hlavní toky

- **Zákazník:** otevře aplikaci → uvidí výhodný termín poblíž, který brzy začíná → rezervuje do minuty → dostane kód.
- **Podnik:** „mám prázdnou 18:30" → zveřejněno do 30 sekund na telefonu, pěti klepnutími a jedním zadáním ceny.

## Stack

React 19 + TypeScript + Vite · Tailwind v4 · TanStack Query · React Hook Form + Zod · MapLibre GL nad OpenStreetMap · Supabase (PostgreSQL, Auth, Storage, RLS, PostGIS) · Temporal polyfill pro práci s časem · instalovatelná PWA.

## Nasazená ukázka

<https://www.app-flek.eu> (dřív <https://flek-nine.vercel.app>, funguje dál) — produkční build nad hostovaným Supabase, nasazovaný automaticky z větve `main`. Konfiguraci řídí `vercel.json`; klíčový je přepis `/(.*) → /index.html`, bez kterého by obnovení stránky na detailu nabídky skončilo chybou 404. Proměnné `VITE_SUPABASE_URL` a `VITE_SUPABASE_ANON_KEY` musí být dostupné **při sestavení**, jinak se aplikace nespustí.

## Nastavení

Potřebujete Node.js ≥ 22.12.

**S Dockerem — lokální Supabase:**

```sh
npm ci
npm run db:start   # spustí lokální Supabase a zapíše veřejné klíče do .env.local
npm run dev
```

`npm run db:reset` přestaví lokální databázi a znovu ji naplní seedem. Skripty jsou v `scripts/local.mjs`.

**Bez Dockeru — hostovaný projekt Supabase:** aplikujte migrace ze `supabase/migrations/` v pořadí názvů, nahrajte `supabase/seed.sql` (jen pro vývoj) a do `.env.local` zapište URL projektu a jeho **publishable/anon** klíč:

```sh
VITE_SUPABASE_URL=https://<projekt>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon klíč>
```

`.env.example` obsahuje jen veřejné položky. Service-role klíč nikdy nepatří do prohlížeče — klient v `src/lib/supabase.ts` ho aktivně odmítá.

## Migrace a seed

Migrace v `supabase/migrations/` se aplikují v pořadí názvů:

| Soubor | Obsah |
| --- | --- |
| `…0001_schema.sql` | tabulky, omezení, indexy, RLS a bezpečnostní pomocné funkce |
| `…0002_booking.sql` | `create_booking`, `cancel_booking`, obchodnická a admin rozhodnutí |
| `…0003_merchant.sql` | provozovny, služby, zveřejnění a úprava nabídky |
| `…0004_queries.sql` | PostGIS vyhledávání, detail nabídky, čtecí modely |
| `…0005_storage.sql` | Storage buckety a pravidla přístupu |
| `…0006_metrics.sql` | čtecí modely a metriky pro partnera a administraci |
| `…0009_ratings.sql` | hodnocení z dokončených rezervací |
| `…0011_payments.sql` | platba předem, vratky a stav platby ve čtecích modelech |
| `…0012_cancellation_window.sql` | vlastní lhůta pro bezplatné zrušení u každé provozovny |
| `…0014_favorites.sql` | oblíbená místa a odvozená novinka u nich |
| `…0018_google_place_ratings.sql` | bezpečné propojení provozovny s Google Place ID |

`supabase/seed.sql` je **jen pro lokální vývoj**: 15 fiktivních pražských provozoven, 30 služeb a 38 termínů generovaných relativně k `now()`, takže demo je živé i příští týden. Rezervace pokrývají všechny stavy včetně dokončené i nedostavené.

### Demo účty

Seed nastavuje **pouze pro lokální vývoj** heslo `FlekDemo2026!`. Nasazená ukázka má vlastní vygenerovaná hesla, která v repozitáři nejsou — vyžádejte si je u správce. Demo seed ani jeho hesla nikdy nenasazujte do produkce.

| E-mail | Role |
| --- | --- |
| `demo-customer@flek.test` | zákazník s historií rezervací |
| `demo-merchant@flek.test` | partner se schválenou provozovnou |
| `demo-merchant2@flek.test` | partner s provozovnou čekající na schválení |
| `demo-admin@flek.test` | administrace — na nasazené ukázce má **vlastní** heslo, nesdílené s ostatními |

Přímé vstupy do jednotlivých částí jsou `/prihlaseni?returnTo=%2Fprofil` pro zákazníka,
`/prihlaseni?role=merchant&returnTo=%2Fpartner` pro partnera a `/prihlaseni?returnTo=%2Fadmin`
pro administrátora. Zákazník se odhlašuje v Profilu; partner a administrátor mají odhlášení
přímo v hlavičce své správy. Po odhlášení se smaže i klientská cache předchozího účtu.

## Testy

```sh
npm run test:unit         # čas, letní čas, peníze — bez databáze
npm test                  # integrační testy proti běžícímu lokálnímu Supabase (Docker)
npm run test:acceptance   # akceptační průchod proti libovolné instanci, jen s anon klíčem
```

`npm run test:acceptance` potřebuje `SUPABASE_URL` a `SUPABASE_ANON_KEY` a nasazený demo seed. Přihlašuje se jako demo účty přes veřejné API, takže prochází skutečnou RLS. Sám si zveřejní nabídky a na konci je zruší, takže se dá pouštět opakovaně:

```sh
SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run test:acceptance
```

Integrační testy se přihlašují **skutečnými JWT**, ne service-role klíčem, takže ověřují i RLS. Pokrývají souběžné rezervace (10 zákazníků na jedno místo), oversell, dvojité klepnutí, autorizaci mezi podniky, kapacitu, storna, nedostavení, kolize kódů a determinismus vyhledávání.

## Hodnocení z Google Maps

Veřejné karty a detail používají pouze aktuální hodnocení z Google Places. Databáze ukládá jen stabilní `google_place_id`; průměr, počet hodnocení a odkaz se načítají přes Edge Function s hlavičkou `no-store`. API klíč proto nikdy není součástí frontendového balíčku.

Pro zapnutí integrace povolte **Places API (New)** a billing v Google Cloud, potom nasaďte migraci a funkci:

```sh
supabase db push
supabase secrets set GOOGLE_MAPS_API_KEY=<serverový-api-klíč>
supabase functions deploy google-place-rating
```

V administraci u každé reálné provozovny doplňte její Google Place ID. Dokud propojení chybí nebo API není dostupné, aplikace žádné náhradní ani demo hodnocení nezobrazuje.

## Hlavní obrazovky

**Zákazník** — Objevit (`/`), Mapa (`/mapa`), Oblíbené (`/oblibene`), detail nabídky (`/nabidka/:id`), Rezervace (`/rezervace`), Profil (`/profil`). Platí se při rezervaci; zákazník dostane voucher s kódem a QR, podnik ho ověří načtením.

**FLEK Partner** (`/partner`) — přehled, zveřejnění termínu, nabídky, rezervace s vyhledáním podle kódu, služby, provozovna, metriky.

**Administrace** (`/admin`) — fronta ke schválení, nabídky, rezervace, uživatelé, metriky pilotu.

## Jak se rozhoduje o dostupnosti

`sold_out` ani `expired` nejsou uložené stavy. `offer_status` nese jen administrativní záměr; dostupnost se **vždy odvozuje v dotazu** funkcí `offer_is_bookable(...)`, kterou používá vyhledávání, detail i rezervační RPC. Neexistuje druhá definice v TypeScriptu. Cron není potřeba k odvození dostupnosti; samostatný job ale dokončuje staré rezervace a vrací osiřelé demo platby.

Kapacitu mění výhradně `security definer` funkce jediným podmíněným `UPDATE`. Klient nemá právo zapisovat do `offers.capacity_remaining`. Částečný unikátní index `bookings_one_active_per_customer_offer` dělá z dvojitého klepnutí, obnovení stránky i dvou panelů neškodnou operaci.

Peníze jsou celočíselné haléře od databáze až po formátování. Čas je vždy `timestamptz` a všechna rozhodnutí o způsobilosti používají `now()` v PostgreSQL — hodiny v zařízení nejsou nikdy autoritativní.

## Omezení V1 a další kroky

Aktuální stav ověření a to, co ještě není hotové, je v [VERIFICATION.md](VERIFICATION.md) a [LIMITATIONS.md](LIMITATIONS.md). Rozhodnutí učiněná při stavbě jsou v [DECISIONS.md](DECISIONS.md).

### Bezpečnost a provoz

- **CI:** `.github/workflows/ci.yml` spouští build s TypeScriptem, unit testy a `npm audit` při každém pushi a PR. Na GitHubu je zapnutý secret scanning s ochranou proti pushnutí tajných údajů a Dependabot upozornění.
- **Hlavičky:** CSP a další bezpečnostní hlavičky jsou ve `vercel.json`. Přidáváte-li externí službu (dlaždice, obrázky, API), doplňte její doménu do CSP.
- **E-maily a obnova hesla:** Supabase Auth posílá přes SMTP Resend z `mail.app-flek.eu`; Site URL je `https://www.app-flek.eu` a v Redirect URLs jsou `/potvrzeni` a `/prihlaseni**` (lokálně v `supabase/config.toml`). Šablony jsou v `supabase/templates`.
- **Upozornění na rezervace:** zvonek a nastavení zapíná `VITE_NOTIFICATIONS_ENABLED=true`, Web Push potřebuje `VITE_VAPID_PUBLIC_KEY`. Funkce `notification-delivery` potřebuje v Supabase secrets `RESEND_API_KEY`, `NOTIFICATION_FROM`, `VAPID_PUBLIC_KEY` a `VAPID_PRIVATE_KEY`; frontu kontroluje `select status, count(*) from private.notification_delivery group by 1`.
- **Demo data:** job `flek-demo-refresh` každé ráno doplní demo FLEKy. Před ostrým provozem na této databázi: `select cron.unschedule('flek-demo-refresh');`.
- **Audit:** každá admin změna je v záložce Administrace → Audit; záznamy nejde upravit ani smazat.

### Živý přehled pro tým a Notion

Souhrnný stav produktu, rolí, doménových pravidel, posledních migrací a otevřených bodů je v [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md). Přehled pro Notion (todolist, fáze, jak to funguje, kde co běží) je v [docs/NOTION.md](docs/NOTION.md); v Notionu je jako stránka „FLEK — přehled projektu“ ve workspace Jacob's Notion.

Automatická synchronizace přes Notion API je volitelná: vytvořte interní integraci, připojte ji ke stránce, zapište `NOTION_TOKEN` a `NOTION_PAGE_ID` do `.env.local` a spusťte `npm run notion` (nebo nejdřív `NOTION_DRY_RUN=1 npm run notion`). Skript archivuje veškerý obsah cílové stránky.

### Cena a rezervace v pilotu

Podnik zadává svou částku. Server přidá 5 % zaokrouhlených na celé koruny (min. 25 Kč, max. 149 Kč). Zákazník od první karty vidí konečnou cenu, ze které se počítá minimální úspora 10 %. Běžně 1 000 Kč / podnik 750 Kč → poplatek 38 Kč → zákazník 788 Kč / úspora 21 %.

`publish_flek` nahradil klientské `publish_offer`. Rezervace ukládá neměnný finanční snímek; opakování stejné platby vrací stejný kód. Job `flek-maintenance` každých 15 minut dokončí rezervace 24 hodin po konci. Podnik pouze případně označí „Nedorazil“; i tehdy se jeho sjednaná částka zachová.

Připravené (přepínač `manual_confirmation_enabled`, zatím `false`) je potvrzování rezervací podnikem: místo se drží už před Checkoutem, peníze se jen autorizují, podnik žádost do 10, 5 nebo 3 minut potvrdí v aplikaci nebo na WhatsAppu a teprve potom se platba strhne. Popis je v [přehledu projektu](docs/PROJECT_STATUS.md), postup zapnutí v [docs/PRED_SPUSTENIM.md](docs/PRED_SPUSTENIM.md).

Ověření: `npm run test:unit`, `npm run build`, `npm run test:acceptance`. Poslední příkaz používá pouze veřejný klíč a demo účty a mění demo data; nespouštět proti skutečným účtům. `tests/pilot-maintenance.sql`, `tests/stripe-refunds.sql`, `tests/manual-confirmation.sql` a `tests/whatsapp-notifications.sql` vyžadují privilegovaný přístup, běží v transakci a své změny vracejí zpět. Akceptační skript sám pozná, jestli demo podnik potvrzuje rezervace, a projde odpovídající tok. Historie nasazených migrací a omezení ověření jsou v [přehledu projektu](docs/PROJECT_STATUS.md).

`src/types/database.ts` obsahuje ručně spravované aplikační typy. Výstup generátoru Supabase má jinou strukturu; nesmí je bez úpravy importů přepsat. Příkaz `db:types` je starý pomocný skript, nikoli povinný krok pro spuštění aplikace.
