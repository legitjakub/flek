# Ověření FLEK

Stav k 7. 9. 2026. Každý řádek říká, čím je doložený. Kde důkaz chybí, je to napsané — ne obejité.

**Zásadní omezení:** na tomto počítači není Docker ani PostgreSQL, takže lokální Supabase nešlo spustit. Migrace ani integrační testy proto **nikdy neběžely proti skutečné databázi**. Vše, co vyžaduje běžící backend, je níže označené jako neověřené. Podrobnosti v [LIMITATIONS.md](LIMITATIONS.md).

## Co je skutečně ověřené

| Kontrola | Výsledek |
| --- | --- |
| `npm run test:unit` | **6/6 prošlo.** Praha přes půlnoc, nezávislost na UTC dni, neexistující březnová 02:30, dvojí říjnová 02:30, 23‑ a 25hodinový den, celočíselné peníze. |
| `npx tsc --noEmit` | Bez chyb, celý `src` i `tests`. |
| `npx vite build` | Projde. MapLibre je vydělený a načítá se až na obrazovkách s mapou. |
| Service-role klíč v balíčku | `grep -ril service_role dist/` najde **jedinou** shodu: naši vlastní pojistku v `src/lib/supabase.ts`, která takový klíč odmítne. Žádný klíč v balíčku není. |
| Vykreslení tras v prohlížeči | `/`, `/prihlaseni`, `/rezervace`, `/partner`, `/admin` a neznámá cesta se vykreslí bez chyby v konzoli. Jediné chyby jsou očekávané `ERR_CONNECTION_REFUSED` na neběžící Supabase. |
| Vodorovný posun na 375 px | `document.body.scrollWidth === window.innerWidth === 375`. Žádný posun. |
| Odlišnost partnerské části | Partner i administrace mají vlastní rám, navigaci a značku; zákaznická část má spodní navigaci o čtyřech položkách. |

Během tohoto ověření se našly a opravily dvě skutečné chyby:

1. Cache dotazů se mazala při každé události přihlášení včetně úvodní, což zahodilo probíhající dotazy a nechalo obrazovku navždy v načítání.
2. TanStack Query ve výchozím režimu výpadek sítě jen pozastaví. Zákazník by při ztrátě spojení viděl nekonečný skeleton a zaseknuté tlačítko „Potvrdit rezervaci" místo čitelné chyby. Nastaveno `networkMode: 'always'`.

Poznámka k metodice: prohlížeč v tomto prostředí běží na skryté kartě a TanStack Query v takovém stavu záměrně pozastavuje opakování dotazů. Chybové a prázdné stavy proto v prohlížeči nešlo vyvolat; ověřená je skořápka, ne stavy s daty.

## Akceptační kritéria ze sekce 17

Průchod 1–12 vyžaduje běžící backend a dva prohlížeče. **Neproveden.** U každého kroku je uvedené, co je hotové a čím je to podložené v kódu.

| # | Kritérium | Stav | Kde to je |
| --- | --- | --- | --- |
| 1 | Registrace partnera → provozovna čeká na schválení | kód hotový, e2e neověřeno | `create_business`, `MerchantShell` hlásí „Vaši provozovnu kontrolujeme. Ozveme se do 24 hodin." |
| 2 | Admin schválí, stav partnera se změní | kód hotový, e2e neověřeno | `admin_set_business_status`, `AdminBusinessesPage` |
| 3 | Vytvoření služby | kód hotový, e2e neověřeno | `save_service`, `MerchantServicesPage` |
| 4 | Zveřejnění pod 30 sekund | kód hotový, **nezměřeno** | `CreateOfferSheet`: jedna obrazovka, služba a čas jako chipy, slevová tlačítka −20/−30/−40 %, kapacita a uzávěrka schované |
| 5 | Zákazník vidí nabídku se vzdáleností a slevou | kód hotový, e2e neověřeno | `search_offers` (PostGIS, `ST_DWithin`), `OfferCard` |
| 6 | Registrace, telefon, rezervace, kód `FLEK-XXXXXX` | kód hotový, e2e neověřeno | `BookingSheet` sbírá telefon v toku, `create_booking`, obrazovka s kódem |
| 7 | Nabídka okamžitě přestane být rezervovatelná | kód hotový, test napsaný **nespuštěný** | `offer_is_bookable` v dotazu; test „capacity=1, 10 parallel users" |
| 8 | Partner najde rezervaci podle kódu a označí docházku | kód hotový, e2e neověřeno | `merchant_lookup_booking`, `ResolveButtons` (aktivní až po začátku) |
| 9 | Zákazník vidí rezervaci v historii jako dokončenou | kód hotový, e2e neověřeno | `my_bookings`, `MyBookingsPage` |
| 10 | Získaná tržba partnera a naplněnost v administraci | kód hotový, e2e neověřeno | `merchant_metrics.recovered_cents`, `admin_metrics` |
| 11 | Kapacita 2: dva zákazníci projdou, třetí ne | test napsaný **nespuštěný** | „capacity=2 accepts two different customers and refuses a third" |
| 12 | Zrušení vrátí kapacitu a nabídku do vyhledávání | test napsaný **nespuštěný** | „eligible cancellation restores capacity and discovery immediately" |

### Technická kritéria

| Kritérium | Stav |
| --- | --- |
| `npm run build` a `tsc --noEmit` čisté | **Ověřeno.** |
| Žádné chyby v konzoli na P0 trasách | **Ověřeno** pro vykreslení bez backendu. |
| Všechny automatické testy projdou | Jednotkové **ano**; integrační **nespuštěné** (chybí databáze). |
| RLS zapnuté na každé tabulce | Politiky napsané; test `every application table has RLS enabled` je napsaný, ale **nespuštěný**. |
| Žádný service key v balíčku | **Ověřeno** grepem. |
| Lighthouse výkon ≥ 80, přístupnost ≥ 90 | **Nezměřeno.** |

### Produktová kritéria

| Kritérium | Stav |
| --- | --- |
| Použitelnost jednou rukou na 375 px, bez vodorovného posunu | **Ověřeno** pro vykreslené obrazovky. |
| Žádná mrtvá navigace, žádný zástupný text, žádné lorem ipsum | **Ověřeno** čtením kódu; každá trasa v `ROUTES` má obrazovku, neznámá cesta má vlastní stav. |
| Každý seznam má navržený prázdný, načítací a chybový stav | **Ověřeno** v kódu: `LoadingList`, `EmptyState`, `ErrorState` na objevování, mapě, rezervacích, nabídkách partnera, službách i administraci. |
| Žádný anglický řetězec na uživatelské ploše | **Ověřeno** čtením; anglicky jsou jen komentáře v kódu. |
| Zákazník tyká, partner vyká | **Ověřeno** čtením všech obrazovek. |

## Jak ověření dokončit

Na počítači s Dockerem:

```sh
npm ci && npm run db:start && npm run db:types && npm test
npm run dev   # pak projít kroky 1–12 výše ve dvou prohlížečích
```

Teprve po zeleném `npm test` má smysl měřit Lighthouse a doplnit sem skutečná čísla.
