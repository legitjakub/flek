# FLEK — živý přehled projektu

> Poslední kontrola: 18. 9. 2026
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

Job `flek-maintenance` je aktivní a běží každých 15 minut: dokončí rezervace 24 hodin po konci. Jeho druhá část vrací staré demo platby bez rezervace; od 13. 9. jdou platby jen přes Stripe, takže už nemá co dělat. Zaplacené Stripe platby bez rezervace řeší `flek-stripe-maintenance`.

Podnik dostává upozornění přes Realtime a záložní dotaz každých 15 sekund. Upozornění i odznak jsou oddělené podle přihlášeného uživatele a provozovny; odhlášení je vymaže. Otevření rezervací odznak zhasne. Při zavřené aplikaci chodí upozornění e-mailem a push podle nastavení (od 13. 9.) a na WhatsApp, jakmile bude účet Meta (výchozí zapnuto, podnik i zákazník, viz níže). SMS nejsou.

### Potvrzování rezervací podnikem

Implementované a nasazené v databázi i Edge Functions, **zapnuté pro všechny podniky**: přepínač `private.settings.manual_confirmation_enabled` je od 15. 9. 15:54 `true` (od 15:27 předtím `demo`). Chybějící události `payment_intent.amount_capturable_updated`, `payment_intent.canceled` a `payment_intent.payment_failed` doplnila do testovacího webhooku admin funkce `stripe-webhook-setup`; akceptace v režimu potvrzování 106/106 a průchod se skutečnými testovacími platbami prošly. Na `true` agent přepnul po Jakubově výslovném souhlasu (první pokus automatický režim zamítl). Hodnota `demo` zapne tok jen pro podniky, jejichž všichni členové mají `@flek.test`; `true` pro všechny. Rozběhnuté žádosti po vypnutí dokončí worker.

- **Hold před Checkoutem.** `start_payment` rovnou drží místo (`bookings.status = pending_payment`, 3 minuty, nejvýš do 15 minut před začátkem). Poslední místo tak dostane, kdo začal první, a nikdo neplatí za místo, které neexistuje. Opuštění Checkoutu vrátí místo hned (`cancel_pending_booking`), jinak po vypršení; 5 opuštěných holdů za hodinu zablokuje další (`HOLD_RATE_LIMITED`).
- **Autorizace, ne platba.** Checkout vytvoří PaymentIntent s `capture_method: manual`. Webhook si vždy načte čerstvý PaymentIntent a `requires_capture` otevře podniku okno (`pending_merchant`). Neshoda částky, měny nebo session autorizaci uvolní, nikdy nerezervuje.
- **Okno podniku ze serverového času.** Víc než 120 minut do začátku → 10 minut, 30–120 → 5 minut, 15–30 → 3 minuty, méně než 15 minut rezervovat nejde; deadline vždy nejpozději 10 minut před začátkem (`private.confirmation_deadline`).
- **Jediné rozhodnutí.** `private.decide_booking` rozhoduje pro aplikaci (`respond_to_booking`) i WhatsApp (`whatsapp_decide`). Bere stejné zámky jako vypršení a zrušení zákazníkem (profil → podnik → nabídka → platba → rezervace), vyhraje první potvrzený přechod a rozhodnutí po deadlinu žádost rovnou vyprší. Zapíše kdo, kdy a kterým kanálem (`merchant_decided_by/at`, `decision_channel`).
- **Capture až po potvrzení.** Worker `booking-confirmation` strhne platbu (idempotency klíč s číslem pokusu) a rezervace dostane kód a stav `confirmed`. Trvalá chyba capture vrátí místo, zruší autorizaci a oběma stranám řekne „nepodařilo se dokončit“. Capture, který dorazí po vypršení, se vrátí vratkou.
- **Odmítnutí, vypršení, zrušení žádosti** vrátí místo přesně jednou (`capacity_released_at`) a autorizaci uvolní (`cancel`), nikdy nevrací peníze. Zrušení nabídky podnikem a pozastavení podniku adminem žádosti ukončí taky.
- **Kód až po potvrzení.** Pohledy `customer_booking_details`, `merchant_booking_rows` i `my_payment_state` kód čekající žádosti nevrací. Úpravu nabídky blokuje běžící žádost (`OFFER_HAS_PENDING_BOOKINGS`), zmrazí ji jen skutečná rezervace.
- **Zákazník** vidí Ověřujeme platbu → Čekáme na potvrzení podniku (odpočet, „Tenhle FLEK začíná brzy…“, Zrušit žádost) → Potvrzujeme FLEK… → 🔥 FLEK je tvůj!, nebo Tentokrát to nevyšlo / Podnik nepotvrdil včas / Podnik potvrdil, ale platbu se nepodařilo dokončit. O vratce mluví jen u skutečně stržených peněz.
- **Podnik** má nahoře na Přehledu a v Rezervacích sekci „Vyžadují potvrzení“ (Potvrďte do 04:18, „🔥 Začíná za 18 minut“, Potvrdit / Nemohu přijmout s výsledkem ze serveru), banner se zvukem a počtem v titulku na ostatních stránkách, u nabídek počet čekajících žádostí a v Provozovně vysvětlení oken.
- Analytika: `payment_authorized`, `confirmation_requested`, `merchant_confirmation_accepted/rejected/expired` s `confirmation_duration_ms`, `payment_capture_started/succeeded/failed`, `authorization_released`, `booking_created`.

### Víc časů jedné služby, doporučení a obrázky (15. 9. 2026)

- **Jedna karta na službu s časy.** Každý čas je dál samostatná nabídka, ale feed, mapa, stránka podniku, oblíbené i náhrada za neobsaditelný FLEK je seskupí podle podniku a služby (`src/features/discovery/slots.ts`). Karta ukáže nejbližší čas a řádek „Další časy“ (nejvýš 3 čipy a „+N“, den jen při změně dne, jiná cena u čipu). Hledání bere 50 řádků a rozšiřování počítá karty.
- **Mapa:** v náhledu po klepnutí na špendlík jsou karty v jednom karuselu stejně vysoké. Čipy časů jsou tlačítka, přepnou čas, cenu, místa i odkaz Detail; počítadlo „1 / 2“ počítá služby.
- **Detail:** v kartě rezervace „Vyber si čas“ z `business_offers` stejné služby. Když má některý den víc časů, jsou pod nadpisy dnů, jinak v jedné řadě („Dnes 17:00“, „Zítra 13:00“). Klepnutí přednačte nabídku a přepne adresu, takže cena, lhůta zrušení, rezervace i návrat ze Stripe sedí na zvolený čas. U neobsaditelného času nabídne „Jiné časy téhle služby“.
- **„Mohlo by se ti líbit“** pod sekcí Zrušení: jiné služby podniku, pak stejná kategorie do 5 km, pak cokoli v okolí, nejvýš 8 karet s časy, jen když jsou aspoň dvě (`pickRecommendations.ts`). Klik měří `similar_offers_clicked` se `source: venue | detail_carousel`.
- **Obrázek služby bez fotky:** vlastní fotka → ilustrace podle názvu (rozšířená slova, jóga a sauna) → fotka kategorie → nový obrázek FLEK (`public/images/flek-placeholder.svg`, ultramarín se špendlíkem) místo bledé dlaždice s plusem.

### WhatsApp pro podniky a zákazníky

Implementované v databázi a kódu (14.–15. 9. 2026), **bez účtu Meta neaktivní**: dokud chybí číslo FLEK (`private.settings.whatsapp_display_number`), zákazník WhatsApp nevidí a Provozovna ukazuje jen, že upozornění nejsou aktivní.

- **Výchozí zapnuto, vypínatelné jako e-mail a push.** `notification_preferences.whatsapp` je `true`; v nastavení upozornění (Profil, Provozovna) má každá událost třetí sloupec WhatsApp a sekce WhatsApp umí vše vypnout. Zprávy ale chodí jen na **ověřené** číslo.
- **Ověření jedním klepnutím.** Číslo je předvyplněné (podnik: telefon z Provozovny, zákazník: telefon z profilu). Tlačítko „Ověřit ve WhatsAppu“ je odkaz na `wa.me` se zprávou „FLEK 123456“; kód vytvoří aplikace a totéž klepnutí uloží jeho hash a souhlas (`whatsapp_start_pairing` s `p_code`). Zpráva z toho čísla číslo ověří a stránka se přepne sama. Kód platí 15 minut, 5 pokusů z jiného čísla ho spálí, nový kód nejvýš 5× za hodinu. Výzvy: krok v checklistu nového podniku, karta na čekání na potvrzení a na „🔥 FLEK je tvůj!“.
- **Co chodí:** podnik žádost s tlačítky Potvrdit / Nemohu přijmout, potvrzenou rezervaci (jen když ji nepotvrdil sám) a zrušení, vypršení nebo selhání platby (ne vlastní odmítnutí či zrušení); zákazník potvrzený FLEK s rezervačním kódem a zrušení (ne vlastní). Jedna zpráva na podnik u člena, který číslo ověřil, podle jeho nastavení.
- **Worker** (`notification-delivery`) dostane z `claim_whatsapp_deliveries` šablonu a parametry, preference i stav rezervace ověří ještě při odeslání a šablonu vezme ze secretu (`WHATSAPP_TEMPLATE_BOOKING_REQUEST`, `…_BUSINESS_CONFIRMED`, `…_BUSINESS_CANCELLED`, `…_CUSTOMER_CONFIRMED`, `…_CUSTOMER_CANCELLED`). Chybějící šablona zprávu přeskočí (`WHATSAPP_TEMPLATE_MISSING`), e-mail a push běží dál.
- `whatsapp-webhook` přijme jen POST s platným `X-Hub-Signature-256` (HMAC SHA-256 surového těla s App Secret, porovnání v konstantním čase); GET jen odpoví na ověření `hub.verify_token`. Klepnutí rozhodne přes `private.decide_booking`, jen když jde o žádost pro podnik a sedí zpráva (`context.id` nebo jednorázový token), číslo, ověřený kontakt a členství toho, kdo ho ověřil. Každá zpráva rozhodne jednou, opakované doručení od Meta se ignoruje, odpověď přijde textem v 24h okně (podniku vykání, zákazníkovi tykání).
- Stavy doručení (`sent`, `delivered`, `read`, `failed`) se zapisují i tehdy, když přijdou dřív než záznam o odeslání. Analytika `whatsapp_*` nenese telefonní čísla.

### Právní minimum (18. 9. 2026)

Texty verze 1.0 napsal agent podle skutečného chování aplikace; **zveřejní se, až budou v `private.settings` údaje provozovatele** (`operator_name`, `operator_ico`, `operator_address`, `support_email`) a verze dostanou účinnost (`legal_documents.effective_at`). Do té doby aplikace ukazuje totéž co dřív a právní stránky jen „Tento dokument právě připravujeme“. Před ostrým provozem je zkontroluje právník (kontrolní seznam v `docs/PRED_SPUSTENIM.md`).

- **Texty** v `src/content/pravni`: podmínky pro zákazníky (zprostředkování, poplatek, řazení s vahami, vznik smlouvy potvrzením, storno, nedostavení, výjimka z odstoupení, reklamace, ADR u ČOI), pro podniky (P2B: ověření, pravidla nabídky, peníze, řazení, pozastavení a ukončení, změny 15 dní předem, DAC7), zásady ochrany osobních údajů (tabulka údajů, právních základů a dob uchování, zpracovatelé, úložiště prohlížeče) a pravidla obsahu (DSA: nahlášení, lhůty, odůvodnění, odvolání). Vykresluje je `src/features/legal/markdown.tsx` do React prvků bez HTML.
- **Provozovatel a poskytovatel:** patička „O FLEKu“ v Profilu, na stránce pro podniky a na právních stránkách (`legal_info`); věta „Službu poskytuje … FLEK rezervaci zprostředkovává“ v rezervaci a na stránce podniku (`business_provider`), u demo podniků věta o ukázce. E-maily končí řádkem o provozovateli.
- **Souhlasy s verzí** (`private.legal_acceptances`, zapisuje jen server): zákazník každou platbou (`start_payment(p_offer_id, p_terms_version)` odmítne chybějící nebo starou verzi `TERMS_OUTDATED`), podnik ve fakturačních údajích nebo v banneru nové verze (`accept_merchant_terms`); bez souhlasu s platnou verzí podnik nezveřejní FLEK (trigger nad `offers`, cron výjimka). Registrace: prohlášení 18+ a odkaz na zásady.
- **Podnik:** fakturační údaje s typem podnikatele, datem narození (OSVČ, DAC7) a státem, tlačítko „Načíst údaje z ARES“ (Edge Function `ares-lookup`, uloží oficiální název a sídlo), schválení skutečného podniku jen s IČO (`PROVIDER_DETAILS_REQUIRED`).
- **DSA a DAC7:** „Nahlásit“ na detailu nabídky a stránce podniku (`report_content`, 10 za den), fronta v Administraci → Nahlášení; podklad DAC7 v Administraci → Metriky (CSV, ostré platby po čtvrtletích).
- **Data:** „Tvoje data“ v Profilu: stažení (`export_my_data`) a smazání účtu (dokud chybí `delete_my_account`, nabídne e-mail podpory). Analytika bez identifikátoru v prohlížeči (`record_event` bez `session_id`), hledání se zaznamená jednou za skutečné hledání.
- **Režim potvrzování:** „Platíš, až podnik potvrdí“ a „Zrušení zdarma 10 minut od potvrzení“ tam, kde podnik rezervace potvrzuje.
- **Čeká na souhlas s migrací** (automatický režim ji odmítl jako změnu sdílených dat): povinné potvrzení rezervace e-mailem s podrobnostmi smlouvy, zprávy podniku o schválení a pozastavení, důvod blokace zákazníka, `delete_my_account` s anonymizací v přihlašování, zpráva nahlašovateli o vyřízení a denní mazání (`flek-retention`). Návrh je hotový, texty toto chování už popisují.

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
| `20260914074359_stripe_refund_states.sql`, `…075058_stripe_refund_done_removed.sql`, `…075622_stripe_refund_failure_to_person.sql` | stav vratky `payments.refund_status` a RPC `stripe_refund_update`: vráceno jen po `succeeded`, čekající vratka zůstává ve frontě, selhaná jde člověku; zrušené `stripe_refund_done` |
| `20260914080051_payment_state_refund_status.sql` | `my_payment_state` vrací i `refund_status` |
| `20260914194131_manual_confirmation_types.sql`, `…194208_manual_confirmation.sql`, `…194608_manual_confirmation_hardening.sql`, `…194849_confirmation_notifications.sql` | první verze potvrzování rezervací od ChatGPT (Codex): nové stavy rezervace, hold, okna, worker, upozornění `requested` |
| `20260914204208_manual_confirmation_fixes.sql` | opravy před zapnutím: maskovaný kód, `private.decide_booking` s auditem rozhodnutí, cesta „capture selhal“, neshoda bez výjimky, `confirmation_quote`, sekvence pro `inventory_version`, limit holdů, přepínač `false`/`demo`/`true`, cron 30 s |
| `20260914204649_confirmation_offer_cancel_during_capture.sql` | nabídka zrušená během capture skončí jako zrušení podnikem, ne jako selhaná platba |
| `20260914211826_whatsapp_notifications.sql` | WhatsApp: párování čísla, zprávy s jednorázovým tokenem, deduplikace webhooku, kanál `whatsapp` ve frontě doručení, `business_payments_status.manual_confirmation` |
| `20260914213426_replace_wellness_catalog_photo.sql` | wellness katalog bez resortové fotografie |
| `20260915090733_whatsapp_contacts.sql` | WhatsApp pro podniky i zákazníky: `private.whatsapp_contacts`, preference `whatsapp` (výchozí `true`) a `save_notification_preference(..., p_whatsapp)`, pět šablon v `claim_whatsapp_deliveries`, žádné zprávy o vlastní akci, rozhodnutí jen ze žádosti pro podnik |
| `20260915091629_whatsapp_one_tap_code.sql` | `whatsapp_start_pairing(..., p_code)`: kód vytvoří aplikace, aby tlačítko mohlo být přímo odkaz do WhatsAppu |
| `20260915191534_legal_documents.sql` | `legal_documents` (verze a účinnost), `legal_info`, `private.legal_acceptances`, souhlas podniku (`accept_merchant_terms`, trigger nad `offers`), `start_payment(p_offer_id, p_terms_version)`, DAC7 údaje v `business_billing`, `business_provider`, schválení jen s IČO |
| `20260915192546_legal_reports.sql` | `content_reports` a `report_content`, admin fronta nahlášení, `export_my_data`, `admin_dac7_report`, `record_event` bez identifikátoru relace |

## Ověření a otevřené body

- Jednotkové testy a build s TypeScriptem běží v GitHub Actions (`.github/workflows/ci.yml`) při každém pushi; aktuální počet ukazuje CI. Vite upozorňuje na velikost mapového balíčku.
- Bezpečnostní hlavičky (CSP, nosniff, Referrer-Policy, Permissions-Policy, zákaz rámů) jsou ve `vercel.json`. Průchod feedu, detailu, mapy, zapomenutého hesla, Realtime podniku, skeneru QR, hledání adresy a auditu v administraci proběhl s CSP bez jediného porušení (13. 9. 2026).
- Produkční build prošel klikacím testem v systémovém Chrome při 375, 390, 430 a 1365 px: služba → nabídka → feed/mapa/detail → platba → potvrzení/historie a upozornění podniku ve druhém okně. Žádné horizontální přetečení ani chyby JavaScriptu; Realtime 881 ms a polling bez WebSocketu 29 013 ms.
- 100 akceptačních kontrol proti reálným JWT a hostované databázi prošlo, včetně posledního místa, opakování stejné platby, výpočtu poplatku a Realtime pouze pro vlastní podnik.
- `tests/pilot-maintenance.sql` prošel proti hostované databázi: hranice 24 hodin / 30 minut, neměnný finanční snímek, zachování výplaty při nedostavení, staré ceny a oprávnění. Testovací transakce se celá vrací zpět.
- `tests/stripe-refunds.sql` prošel proti hostované databázi (14. 9. 2026): čekající vratka není vrácená, selhání po zdánlivém úspěchu vrátí platbu na `paid` a mimo frontu, staré ani opakované zprávy nic nepřepíšou, klient stav vratky změnit nemůže. Transakce se vrací zpět.
- Lokální integrační sada potřebuje běžící Docker/Supabase; v tomto prostředí neběžela. Typy aplikace jsou ručně spravované, nevyměňovat je přímo za generovaný soubor.
- Názvy souborů v `supabase/migrations/` odpovídají verzím v hostované tabulce `supabase_migrations.schema_migrations` (sladěno 13. 9. 2026 podle názvu, včetně pořadí `photo_matches_activity` před `google_place_ratings`, jak se skutečně aplikovaly). `supabase db push` proto již aplikované migrace nespustí znovu. Novou migraci po aplikaci přes MCP pojmenujte podle verze, kterou databáze zapsala.
- Platby jdou přes Stripe Connect v testovacím režimu (Edge Functions v `supabase/functions`, klíče v Supabase secrets). Ostrý režim, události Accounts v2 a účetní doklady jsou otevřené, viz `LIMITATIONS.md`. Integrační sada nově potvrzuje platbu přes `stripe_payment_succeeded` (náhrada webhooku), lokálně zatím neběžela.
- Potvrzování rezervací (15. 9. 2026): `tests/manual-confirmation.sql` a `tests/whatsapp-notifications.sql` prošly proti hostované databázi (rollback), akceptace v původním režimu 101/101 a v režimu potvrzování 106/106, průchod zákazník + podnik se skutečnými testovacími platbami, build a typová kontrola Edge Functions. Push do `main` nasazuje funkce z `supabase/config.toml` (GitHub integrace), `stripe-checkout` (v9), `stripe-test-pay` (v8) a `stripe-webhook-setup` (v1) jdou přes MCP. Přepínač je od 15:54 `true` a texty pro podniky jsou upravené. **Otevřené:** ruční test Checkoutu s kartou, Apple Pay a Google Pay na telefonu.
- WhatsApp: **IMPLEMENTOVÁNO, ALE VYŽADUJE RUČNÍ EXTERNÍ OVĚŘENÍ** — účet Meta (pro pilot stačí testovací číslo), pět schválených šablon, secrets, ověření jedním klepnutím na skutečném iPhonu a Androidu a skutečné klepnutí na tlačítko. Oficiální dokumentace Meta ukazuje v `button.payload` text tlačítka; vlastní payload ze šablony podle integrací třetích stran chodí zpět, proto webhook bere i text tlačítka spolu s `context.id` odeslané zprávy.

- Právní minimum (18. 9. 2026): `tests/legal.sql` a `tests/manual-confirmation.sql` prošly proti hostované databázi (rollback), 134 unit testů (nové `legal.test.ts` a `email.test.ts`), build, průchod na 375/390/1280 px v nezveřejněném stavu i s lokálně podvrženými údaji provozovatele. `ares-lookup` ověřený proti skutečnému ARES po nasazení. **Otevřené:** zopakovat nasazení webu na Vercelu (18. 9. selhalo na straně Vercelu), údaje provozovatele, souhlas s migrací povinných e-mailů a mazání, kontrola právníkem.

Podrobné důkazy jsou v [VERIFICATION.md](../VERIFICATION.md), omezení v [LIMITATIONS.md](../LIMITATIONS.md), technická rozhodnutí v [DECISIONS.md](../DECISIONS.md) a historické předání v [HANDOFF.md](../HANDOFF.md).

## Historie posledních změn

| Datum | Změna | Stav |
| --- | --- | --- |
| 18. 9. 2026 | Právní minimum podle analýzy z 15. 9.: texty verze 1.0 (podmínky pro zákazníky a pro podniky, zásady ochrany osobních údajů, pravidla obsahu) na `/podminky`, `/podminky-podniky`, `/soukromi`, `/pravidla`, patička „O FLEKu“, souhlas s verzí při platbě a u podniku, kdo službu poskytuje, IČO z ARES a schválení jen s IČO, nahlášení obsahu s frontou v administraci, export dat, podklad DAC7, analytika bez ukládání do prohlížeče, texty v režimu potvrzování, e-maily s podrobnostmi smlouvy a provozovatelem. Texty se zveřejní s údaji provozovatele; migrace povinných e-mailů, smazání účtu a mazání starých dat čeká na souhlas. | migrace `20260915191534`, `20260915192546` a Edge Functions (`ares-lookup` v1, `notification-delivery` v27) v produkci, web čeká na opakované nasazení na Vercelu; `tests/legal.sql` a `tests/manual-confirmation.sql` PASS, akceptace 106/106, 134 unit testů, build, CI, ARES naživo, prohlížeč 375/390/1280 px |
| 15. 9. 2026 | VAPID klíče uložené ve správci hesel (Jakub) a dočasný soubor s klíči smazaný. Postup pro WhatsApp v `PRED_SPUSTENIM.md`: `WHATSAPP_VERIFY_TOKEN` a `WHATSAPP_APP_SECRET` do Supabase secrets před ověřením webhooku u Meta. | soubor ověřeně neexistuje; `NOTIFICATION_WORKER_SECRET` z něj je uložený v `private.notification_config` |
| 15. 9. 2026 | Potvrzování zapnuté pro všechny podniky (`manual_confirmation_enabled = 'true'` v 15:54, po Jakubově souhlasu); text na stránce pro podniky („…rezervaci během pár minut potvrdíte…“) a nápověda lhůty zrušení v Provozovně („10 minut od potvrzení rezervace“). Všech 18 schválených podniků potvrzuje; Kubova má Stripe propojený od 14. 9., Tenis kurt ne. | přepínač `true`; build, 109 unit testů |
| 15. 9. 2026 | Potvrzování zapnuté pro demo podniky: admin funkce `stripe-webhook-setup` doplnila do testovacího webhooku tři události `payment_intent.*`, sonda s přepínačem `demo` prošla (autorizace → žádost za 2 s, stažení → uvolnění za 2 s), akceptace v režimu potvrzování 106/106, průchod se skutečnými testovacími platbami (podnik na 390 px potvrdil → zákazník 🔥 FLEK je tvůj! s kódem a stržením, odmítl → Tentokrát to nevyšlo a uvolněná blokace). Přepnutí na `true` zamítl automatický režim. Kontrola SMTP v Supabase Auth. Neuložené kopie Codexu v hlavní složce přesunuté do lokální větve `zaloha/codex-neulozene-2026-09-15`. | přepínač `demo`; `stripe-webhook-setup` v1 (MCP); Meta, klíč Resendu, VAPID a Stripe u podniku Kubova zůstávají na Jakubovi |
| 15. 9. 2026 | Víc časů jedné služby: jedna karta s řádkem „Další časy“ ve feedu, na mapě, u podniku, v oblíbených a v náhradě; na mapě stejně vysoké karty s čipy, které přepnou čas; na detailu „Vyber si čas“ (přepne adresu, cenu i rezervaci). Karusel „Mohlo by se ti líbit“ na detailu. Obrázek služby bez fotky: fotka kategorie a nový obrázek FLEK. WhatsApp pro podniky i zákazníky: výchozí zapnutý, třetí sloupec v nastavení upozornění, ověření čísla jedním klepnutím (kód vytvoří aplikace), výzvy v checklistu podniku a u zákazníka po rezervaci, pět šablon, žádné zprávy o vlastní akci. Nasazené `stripe-checkout` a `stripe-test-pay`; sonda potvrzování ukázala chybějící události Stripe. | migrace `20260915090733`, `20260915091629` v produkci; SQL testy WhatsAppu a potvrzování PASS na hostované DB; 109 unit testů, build, typová kontrola funkcí; prohlížeč 390 a 1280 px (feed, mapa, detail, karusel, Profil a Provozovna s WhatsAppem včetně ověření a vypnutí, testovací data smazaná); Meta a události Stripe čekají na Jakuba |
| 15. 9. 2026 | Potvrzování rezervací podnikem dokončené po ChatGPT: hold před Checkoutem, autorizace a stržení až po potvrzení, okna 10/5/3 minuty ze serverového času, jediné rozhodnutí `private.decide_booking` pro aplikaci i WhatsApp, 15 oprav nasazené verze (maskovaný kód, capture u deadlinu, idempotency a strop pokusů, neshoda bez výjimky, otevřená Checkout Session, zmrazení nabídky, zámek inventáře, pozastavení podniku, údržba plateb, limit holdů, audit a analytika rozhodnutí, kolize kódu, cron). Partner: sekce „Vyžadují potvrzení“, banner a zvuk, počet žádostí u nabídek. Zákazník: čekání s odpočtem, 🔥 FLEK je tvůj!, odmítnutí a vypršení bez řeči o vratce. WhatsApp přes Meta Cloud API s párováním kódem a podepsaným webhookem. Registrace existujícího e-mailu už nehlásí odeslaný odkaz. | migrace v produkci, přepínač `false`; nasazená `booking-confirmation`, ostatní funkce čekají na souhlas s nasazením; SQL testy obou toků PASS na hostované DB, akceptace 101/101 (původní režim), 102 unit testů, build; partner na 390 a 1280 px a zákazník na 375 px s podvrženými odpověďmi API bez přetečení; WhatsApp vyžaduje účet Meta |
| 14. 9. 2026 | Wellness katalog: odstraněna nevhodná resortová fotografie `photo-1596178065887-1198b6148b2b`; vířivka, parní lázeň a odpočinková procedura používají neutrální spa snímek a jednorázová migrace opravuje i existující služby a obálky | migrace v produkci od 15. 9. (verze `20260914213426`, 2 položky katalogu); původní URL zůstává pouze jako podmínka v opravné migraci |
| 14. 9. 2026 | Mapa: vrácený plný náhled po klepnutí na špendlík (fotka, sleva, přeškrtnutá původní cena, podnik, čtvrť a vzdálenost, délka, Navigovat a Detail) místo kompaktního řádku; kamera po změření karty posune vybraný špendlík nad ni | build, 84 unit testů; na 375/390/1280 px vybraný špendlík nad kartou, bez přetečení a chyb v konzoli |
| 14. 9. 2026 | Opravy z vizuální revize: shluky na mapě počítají se skutečnou výškou značek (špendlík 64 px, shluk s prstencem 86 px), takže cenovka už nepřekrývá prstenec sousedního shluku; náhled termínu na telefonu posune mapu, až se karta změří (dřív se posun počítal s prázdným slotem a špendlík zůstal pod kartou); lišta časů se zastaví na celých pilulkách a mizí jen na okraji, za kterým něco je; v kartě rezervace na detailu už nevisí tečka mezi „Zaplatíš rovnou“ a „Zrušení zdarma“ | build, 85 unit testů (nový test kolize špendlíku a shluku), prohlížeč na 375/390/1280 px: žádné překryvy značek, vybraný špendlík nad kartou (375: 363–427 px, karta od 588 px), bez přetečení |
| 14. 9. 2026 | Nová paleta „Noční ultramarín“ místo Mandarinky (vybraná ze tří variant ukázaných na skutečné aplikaci): tokeny včetně rolí značky na tmavém a na mapě, logo, ikony aplikace (SVG i PNG), mapa, obrázek služby bez fotky, manifest, e-mailové šablony (repozitář i Supabase) a e-maily upozornění | build, 84 unit testů, všechny textové dvojice tokenů WCAG AA, 57 snímků na 375/390/1280 px bez přetečení a chyb, vizuální kontrola snímků |
| 14. 9. 2026 | Oprava vratek (P0 z auditu ChatGPT): platba je vrácená, až když Stripe vratku potvrdí; čekající vratky se sledují dál, selhané (i dodatečně) se vrátí na zaplaceno a jdou člověku; webhook poslouchá `refund.created/updated/failed` a stav si načte ze Stripe; zákazník vidí „Vracíme peníze“ | migrace a funkce v produkci, události přidané do webhooku v sandboxu; build, 84 unit testů, 100/100 akceptačních kontrol včetně nové kontroly s kartou `pm_card_refundFail`, `tests/stripe-refunds.sql` |
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
