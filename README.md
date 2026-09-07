# FLEK

FLEK je český marketplace pro **volnou kapacitu služeb na poslední chvíli**. Termín za 650 Kč v 18:30 má v 18:31 hodnotu nula. FLEK dovolí podniku proměnit tuhle mizející kapacitu na tržbu — se slevou, ale zaplacenou.

Pilot běží v Praze, jazyk je čeština, měna CZK, časová zóna Europe/Prague. Město je ale vždy jen data, nikde není zadrátované v kódu ani ve schématu.

Aplikace ověřuje jedinou hypotézu: **budou podniky opakovaně zveřejňovat zlevněné termíny na poslední chvíli a budou si je zákazníci rezervovat a doopravdy dorazí?**

## Dva hlavní toky

- **Zákazník:** otevře aplikaci → uvidí výhodný termín poblíž, který brzy začíná → rezervuje do minuty → dostane kód.
- **Podnik:** „mám prázdnou 18:30" → zveřejněno do 30 sekund na telefonu, pěti klepnutími a jedním zadáním ceny.

## Stack

React 19 + TypeScript + Vite · Tailwind v4 · TanStack Query · React Hook Form + Zod · MapLibre GL nad OpenStreetMap · Supabase (PostgreSQL, Auth, Storage, RLS, PostGIS) · Temporal polyfill pro práci s časem · instalovatelná PWA.

## Nastavení

Potřebujete Node.js ≥ 22.12 a Docker (kvůli lokálnímu Supabase).

```sh
npm ci
npm run db:start   # spustí lokální Supabase a zapíše veřejné klíče do .env.local
npm run db:types   # vygeneruje src/types/database.ts ze živé databáze
npm run dev
```

`npm run db:reset` přestaví lokální databázi a znovu ji naplní seedem. Skripty jsou v `scripts/local.mjs`.

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

`supabase/seed.sql` je **jen pro lokální vývoj**: 15 fiktivních pražských provozoven, 30 služeb a 38 termínů generovaných relativně k `now()`, takže demo je živé i příští týden. Rezervace pokrývají všechny stavy včetně dokončené i nedostavené.

### Demo účty

Všechny mají **pouze pro lokální vývoj** heslo `FlekDemo2026!`. Seed ani hesla nikdy nenasazujte do produkce.

| E-mail | Role |
| --- | --- |
| `demo-customer@flek.test` | zákazník s historií rezervací |
| `demo-merchant@flek.test` | partner se schválenou provozovnou |
| `demo-merchant2@flek.test` | partner s provozovnou čekající na schválení |
| `demo-admin@flek.test` | administrace |

## Testy

```sh
npm run test:unit         # čas, letní čas, peníze — bez databáze
npm test                  # integrační testy proti běžícímu lokálnímu Supabase
```

Integrační testy se přihlašují **skutečnými JWT**, ne service-role klíčem, takže ověřují i RLS. Pokrývají souběžné rezervace (10 zákazníků na jedno místo), oversell, dvojité klepnutí, autorizaci mezi podniky, kapacitu, storna, nedostavení, kolize kódů a determinismus vyhledávání.

## Hlavní obrazovky

**Zákazník** — Objevit (`/`), Mapa (`/mapa`), detail nabídky (`/nabidka/:id`), Rezervace (`/rezervace`), Profil (`/profil`).

**FLEK Partner** (`/partner`) — přehled, zveřejnění termínu, nabídky, rezervace s vyhledáním podle kódu, služby, provozovna, metriky.

**Administrace** (`/admin`) — fronta ke schválení, nabídky, rezervace, uživatelé, metriky pilotu.

## Jak se rozhoduje o dostupnosti

`sold_out` ani `expired` nejsou uložené stavy. `offer_status` nese jen administrativní záměr; dostupnost se **vždy odvozuje v dotazu** funkcí `offer_is_bookable(...)`, kterou používá vyhledávání, detail i rezervační RPC. Neexistuje druhá definice v TypeScriptu. Žádný cron není potřeba ke správnosti.

Kapacitu mění výhradně `security definer` funkce jediným podmíněným `UPDATE`. Klient nemá právo zapisovat do `offers.capacity_remaining`. Částečný unikátní index `bookings_one_active_per_customer_offer` dělá z dvojitého klepnutí, obnovení stránky i dvou panelů neškodnou operaci.

Peníze jsou celočíselné haléře od databáze až po formátování. Čas je vždy `timestamptz` a všechna rozhodnutí o způsobilosti používají `now()` v PostgreSQL — hodiny v zařízení nejsou nikdy autoritativní.

## Omezení V1 a další kroky

Aktuální stav ověření a to, co ještě není hotové, je v [VERIFICATION.md](VERIFICATION.md) a [LIMITATIONS.md](LIMITATIONS.md). Rozhodnutí učiněná při stavbě jsou v [DECISIONS.md](DECISIONS.md).

V1 vědomě neobsahuje platby, předplatné, věrnostní programy, recenze, chat, notifikace push a SMS, dynamické ceny ani integrace na rezervační systémy.

Rozšíření jsou připravená na čtyřech místech: `bookings.price_cents` plus budoucí sloupec s platebním záměrem umožní zálohy; `publish_offer` je místo, kam se zapojí automatické pravidlo („tři hodiny před začátkem stále prázdné → zveřejnit se slevou 25 %"); `analytics_events` jsou vstup pro dynamické ceny; notifikace mají být rozhraní s in-app implementací.
