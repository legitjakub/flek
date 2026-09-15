# FLEK — co zbývá před spuštěním

Stav k 15. 9. 2026. Seznam všeho, co je potřeba dodělat, než FLEK začne brát skutečné peníze od skutečných zákazníků. Úkoly jsou rozdělené podle toho, **kdo je musí udělat**:

- **Část 1: Musí udělat člověk.** Úkoly vyžadují účty, podpisy, peníze, osobní údaje, přihlašovací klíče nebo právníka. AI agent je udělat nesmí, nebo nemůže.
- **Část 2: Zvládne AI agent v kódu.** Stačí mu zadat úkol, nic dalšího nepotřebuje.
- **Část 3: Postup spuštění.** Pořadí kroků v den přepnutí na ostrý provoz.

Hotový úkol odškrtni tady i v `docs/NOTION.md` (todolist fáze B). Úkoly na teď pro Jakuba jsou v Notionu v sekci „Na tahu je Jakub“.

## Kde jsme teď

- Aplikace běží veřejně na https://www.app-flek.eu jako demo pilot (původní https://flek-nine.vercel.app funguje dál).
- E-maily jdou přes Resend z `mail.app-flek.eu`. Upozornění na rezervace fungují v aplikaci, e-mailem i jako push (všechny klíče jsou v Supabase secrets).
- Platby jdou **jen přes Stripe Connect v testovacím režimu**:
  - zákazník platí na stránce Stripe Checkout,
  - FLEK si ponechá servisní poplatek, zbytek jde podniku,
  - vratky i obsazení místa řeší webhook.
  - Skutečné peníze se nestrhávají.
- 16 demo podniků má testovací účet Stripe. Demo FLEKy se každé ráno doplní na 3 dny dopředu.
- **Potvrzování rezervací podnikem** (hold před Checkoutem, autorizace, potvrzení do 10/5/3 minut, stržení až potom) je v databázi, ale vypnuté (`manual_confirmation_enabled = false`). Zapne se po nasazení funkcí a přidání událostí ve Stripe, nejdřív pro demo podniky.
- **WhatsApp upozornění** pro podniky jsou v kódu a databázi, čekají na účet Meta a schválenou šablonu.
- Ověřeno: 101/101 akceptačních kontrol se skutečnými testovacími platbami Stripe (původní režim), SQL testy potvrzování a WhatsAppu, build a unit testy v CI.

---

## Část 1: Musí udělat člověk

### Stripe

- [ ] **Ruční testovací platba.** Otevřít FLEK u demo podniku, rezervovat a zaplatit kartou `4242 4242 4242 4242` (libovolné budoucí datum a CVC). Ověřit, že se objeví rezervační kód, a pak rezervaci zrušit a zkontrolovat vratku v Stripe Dashboardu (sandbox).
- [ ] **Projít onboarding skutečného podniku.** V partnerské části „Kubova“ → Provozovna → „Propojit se Stripe“. V testovacím režimu jde použít testovací údaje. Totéž platí pro „Tenis kurt“ (sejmencz@post.cz): dokud Stripe nepropojí, podnik nemůže zveřejnit FLEK.
- [ ] **Aktivovat ostrý účet Stripe** pro firmu FLEK (IČO, bankovní účet, ověření totožnosti jednatele).
- [ ] **V ostrém režimu dokončit nastavení Connect.** Týká se to profilu platformy, země Česko, Express dashboardu pro podniky a potvrzení, že poplatky a ztráty nese platforma (`losses_collector = application`). Bez toho Stripe nedovolí zakládat účty podniků.
- [ ] **Vytvořit ostrý webhook** na `https://<projekt>.supabase.co/functions/v1/stripe-webhook`:
  - Události platformy: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`. Bez událostí `refund.*` se o vratce, která selže až dodatečně, FLEK nedozví. Testovací webhook je má od 14. 9.
  - Zvlášť Connect webhook (události připojených účtů) s `account.updated`.
- [ ] **Vložit ostré klíče do Supabase → Edge Functions → Secrets:** `STRIPE_SECRET_KEY` (`sk_live_…`) a `STRIPE_WEBHOOK_SECRET` (`whsec_…`). Klíče nikdy do chatu, repozitáře ani `.env` v gitu.
- [ ] **Nastavit vzhled Checkoutu a výpis na kartě.** V Stripe nahrát logo a barvy a nastavit text výpisu (statement descriptor), např. `FLEK`.

### Potvrzování rezervací a WhatsApp

- [ ] **Schválit nasazení Edge Functions** `stripe-webhook`, `stripe-checkout`, `stripe-test-pay`, `notification-delivery` a `whatsapp-webhook` (s `verify_jwt = false`). Automatický režim agenta nasazení platebního webhooku sám odmítl, takže ho agent udělá až se souhlasem. `booking-confirmation` už běží.
- [ ] **Stripe webhook (testovací i ostrý):** přidat události `payment_intent.amount_capturable_updated`, `payment_intent.canceled` a `payment_intent.payment_failed` k dosavadním. Bez nich se autorizace z Checkoutu ke žádosti nedostane a zákazník čeká, dokud hold nevyprší.
- [ ] **Ruční test na telefonu** po zapnutí pro demo podniky: zaplatit Apple Pay nebo Google Pay a kartou 4242, zkontrolovat, že banka ukáže jen blokaci, potvrdit v partnerské části druhým účtem a ověřit kód; podruhé zvolit Nemohu přijmout a ověřit, že blokace zmizí.
- [ ] **Meta — WhatsApp Business Platform:**
  1. Business portfolio a ověření firmy (Business Verification).
  2. WhatsApp Business Account a telefonní číslo pro FLEK (nesmí být zároveň v aplikaci WhatsApp), zobrazované jméno „FLEK“.
  3. Aplikace v Meta for Developers s produktem WhatsApp. System user s trvalým tokenem a oprávněními `whatsapp_business_messaging` a `whatsapp_business_management`. Zkopírovat App Secret a Phone number ID.
  4. Webhook: callback `https://yupkrntknbkvmlajwlph.supabase.co/functions/v1/whatsapp-webhook`, verify token náhodný řetězec aspoň 16 znaků, odebírat pole `messages`.
  5. Šablona kategorie **Utility**, jazyk čeština (`cs`), název `flek_booking_request`. Tělo přesně:
     ```
     Nová rezervace čeká na potvrzení.
     Termín: {{1}}
     Služba: {{2}}
     Vy dostanete: {{3}}
     Potvrďte do {{4}}, jinak žádost vyprší a zákazník nic nezaplatí.
     ```
     Ukázkové hodnoty pro schválení: `dnes 14:30`, `Pánský střih (45 min)`, `750 Kč`, `14:08`. Tlačítka: dvě rychlé odpovědi s texty přesně **Potvrdit** a **Nemohu přijmout** (webhook je čte jako zálohu).
  6. Supabase → Edge Functions → Secrets: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TEMPLATE_BOOKING_REQUEST` (`flek_booking_request`), `WHATSAPP_TEMPLATE_LANGUAGE` (`cs`), volitelně `WHATSAPP_GRAPH_VERSION` (výchozí `v25.0`). Nikdy do chatu ani repozitáře.
  7. Říct agentovi zobrazované číslo FLEK; zapíše ho do `private.settings` (`whatsapp_display_number`) a tím se v Provozovně objeví párování.
  8. Propojit číslo jednoho demo podniku, nechat přijít žádost a vyzkoušet obě tlačítka i opakované klepnutí.
- [ ] **E-mail při registraci:** v Supabase → Authentication → SMTP zkontrolovat odesílatele `…@mail.app-flek.eu` a uživatele `resend` (uložení minule spadlo na časový limit), pak zaregistrovat novou adresu, otevřít odkaz v jiném prohlížeči a ověřit přihlášení.

### Supabase a infrastruktura

- [ ] **Rozhodnout o produkčním prostředí.** Doporučení je nový Supabase projekt pro ostrý provoz; současný `yupkrntknbkvmlajwlph` zůstane jako demo/staging pro akceptační testy.
- [ ] **Produkční projekt přepnout na Supabase Pro** (placené). Přináší zálohy, projekt se neuspává a zapne se ochrana proti prolomeným heslům.
- [ ] **Převést vlastnictví Supabase na firemní účet.** Dnes je projekt v organizaci jiného účtu. Zapnout 2FA a přidat druhého vlastníka.
- [x] **Redirect URLs a Site URL** v Supabase → Authentication → URL Configuration: `https://www.app-flek.eu` (13. 9.).
- [x] **Doména app-flek.eu:** DNS v Endoře a doména ve Vercelu (13. 9.).
- [x] **E-maily:** účet Resend, doména `mail.app-flek.eu` (DKIM a dva CNAME v Endoře), SMTP v Supabase Auth (13. 9.). Resend doménu ověřil (Verified).
- [x] **`NOTIFICATION_FROM` a `VAPID_PUBLIC_KEY`** v Supabase → Edge Functions → Secrets (13. 9.). E-mailová upozornění fungují.
- [x] **`VAPID_PRIVATE_KEY`** v Supabase → Edge Functions → Secrets (13. 9., otisk ověřený proti souboru).
- [ ] **Resend klíč:** vytvořit nový API klíč (Sending access, doména `mail.app-flek.eu`), vložit ho jako `RESEND_API_KEY` do Edge Function secrets i jako heslo SMTP v Supabase Auth a smazat oba staré klíče („FLEK production“ a „FLEK production rotated“), které se objevily v záznamu Codexu.
- [ ] **VAPID klíče** uložit do správce hesel a soubor `/private/tmp/flek-notification-secrets.env` smazat.
- [x] **Skutečné e-maily:** obnova hesla a upozornění doručené na jakub.hrncir24@gmail.com (Resend: Delivered, 13. 9.). Zbývá zkouška s rezervací kartou 4242 a push.
- [ ] **Monitoring chyb:** účet Sentry (nebo podobné služby) a předání DSN do Vercelu jako `VITE_SENTRY_DSN`.
- [ ] **Vercel:** proměnné `VITE_*` pro produkci, včetně skutečného `VITE_SUPPORT_EMAIL`.

### Právo, účetnictví a firma

- [ ] **Obchodní podmínky pro zákazníky** (s právníkem):
  - výjimka z 14denního odstoupení u služeb s pevným termínem,
  - storno pravidla a nedostavení,
  - vratky,
  - role FLEKu jako zprostředkovatele.
- [ ] **Podmínky pro podniky** podle nařízení P2B: parametry řazení „Doporučené“ (vzdálenost 45 %, čas 35 %, sleva 20 %), pozastavení účtu, vyřizování stížností a výše poplatku.
- [ ] **Zásady ochrany osobních údajů a seznam zpracovatelů** (Supabase, Vercel, Stripe, e-mailová služba, mapy). Rozhodnout, zda analytika potřebuje souhlas.
- [ ] **Daně:** s daňovým poradcem ujasnit DPH ze servisního poplatku a to, kdo komu vystavuje doklad (FLEK → podnik za poplatek, podnik → zákazník za službu).
- [ ] **Fakturační nástroj** pro poplatky podnikům, například Fakturoid (rozhodnutí a účet).
- [ ] **Na webu uvést údaje o provozovateli** (firma, IČO, sídlo) a funkční e-mail podpory.

### Rozhodnutí a ruční testy

- [ ] **Poskytovatel map a hledání adres pro komerční provoz.** Záložní dlaždice ArcGIS a veřejné Photon API nejsou na komerční provoz, varianty jsou placená licence nebo vlastní limity.
- [ ] **Repozitář:** přepnout na soukromý? Zapnout ochranu větve `main` s povinným zeleným CI? Ochrana zablokuje přímé pushe.
- [ ] **Otestovat na fyzickém iPhonu v Safari** včetně skenování QR kamerou a platby přes Apple Pay v Checkoutu.
- [ ] **Pozvat první skutečné podniky**, projít s nimi registraci a propojení se Stripe a sebrat připomínky.

---

## Část 2: Zvládne AI agent v kódu

Každý bod je samostatný úkol. Po dokončení agent aktualizuje dokumentaci podle `AGENTS.md`.

### Platby (navazuje na Stripe z 13. 9.)

- [ ] **Stav účtu podniku bez otevření aplikace.** Obsloužit události Accounts v2 (`v2.core.account[configuration.recipient].capability_status_updated`, `v2.core.account[requirements].updated`) nebo Connect `account.updated`, aby se `stripe_charges_enabled` měnil sám. Dnes se stav obnoví jen při návratu z onboardingu nebo po otevření sekce „Platby a výplaty“.
- [ ] **Skrýt ve feedu, na mapě a na stránce podniku FLEKy podniků**, kterým Stripe omezil platby. Dnes se zobrazí a rezervace skončí hláškou `PAYMENTS_NOT_READY`.
- [ ] **Sladit formulář „Výplatní a fakturační údaje“ se Stripe.** Číslo účtu pro výplaty už zadává podnik u Stripe, formulář má nechat jen fakturační údaje a souhlas s podmínkami.
- [ ] **Migrace pro ostrý režim.** Nastavit `stripe_test_mode = 'false'` v `private.settings`, aby zmizela hláška o testovací kartě. Spustit až spolu s ostrými klíči.
- [x] **Stripe funkce `stripe-checkout` a `stripe-connect` znovu nasazené s doménou app-flek.eu** (CORS ověřen 13. 9.).
- [x] V `stripe-connect` záložní návratová adresa a `business_url` na `https://www.app-flek.eu` (13. 9.).
- [ ] **Z ostrého nasazení vynechat `stripe-test-pay`.** S ostrým klíčem sama odmítá, ale je čistší ji nenasadit.
- [ ] **Admin nástroj na ruční vratku a storno** se zápisem do `admin_audit_log`, pro řešení sporů.
- [x] **Vratky podle skutečného stavu ve Stripe** (P0 z auditu ChatGPT, 14. 9.): vráceno až po `succeeded`, čekající vratky se sledují, webhook poslouchá `refund.*`.
- [ ] **Přehled vratek, které potřebují člověka.** V administraci ukázat platby se selhanou nebo zrušenou vratkou (`refund_status in ('failed','canceled')`) a platby s 8 neúspěšnými pokusy a poslat adminovi upozornění. Dnes je najde jen SQL dotaz z `LIMITATIONS.md`.
- [ ] **Přehled plateb pro admina a účetní export (CSV):** platby, vratky, poplatky FLEKu a převody podnikům spárované se Stripe ID.
- [x] **Úklid `scripts/acceptance.mjs`:** mrtvé větve demo plateb odstraněné (13. 9.).
- [ ] **Spustit `npm run test:integration` s Dockerem.** Po přechodu na Stripe neběžel; helper `book()` teď potvrzuje platbu přes `stripe_payment_succeeded`.

### Potvrzování rezervací

- [ ] Po nasazení funkcí a přidání událostí ve Stripe: `update private.settings set value = 'demo' where key = 'manual_confirmation_enabled'`, spustit `tests/manual-confirmation.sql`, `npm run test:acceptance` (projde režim potvrzování) a klikací průchod zákazník + podnik na 375/390/1280 px se skutečnou testovací platbou.
- [ ] Když je `demo` zelené, přepnout na `'true'` (Jakub souhlasil předem) a ve stejné změně upravit text na stránce pro podniky („Když si ho někdo rezervuje…“) a nápovědu k lhůtě zrušení v Provozovně („10 minut od zaplacení“ → od potvrzení).
- [x] Opravy nasazené verze ChatGPT, oba SQL testy, akceptační skript pro oba režimy, unit testy stavů (15. 9.).
- [x] WhatsApp v kódu: párování, šablona, webhook s ověřením podpisu, rozhodnutí přes `decide_booking` (15. 9.).

### E-maily a upozornění

- [x] Potvrzení a zrušení rezervace zákazníkovi e-mailem, v aplikaci a push (13. 9.). Doplnit do e-mailu kód rezervace a storno lhůtu, ať splní potvrzení „na trvalém nosiči“.
- [ ] Připomínka před termínem.
- [x] E-mail, push a upozornění v aplikaci podniku o nové rezervaci a o stornu, nastavitelné v Provozovně (13. 9.).
- [ ] E-mail o vratce.

### Přihlášení a zabezpečení

- [ ] Povinné MFA (TOTP) pro administrátory: `is_admin()` vyžaduje `aal2` a v `/admin` se MFA nastavuje.
- [ ] CAPTCHA (Cloudflare Turnstile) u registrace a obnovy hesla. Klíče založí člověk.
- [ ] `secure_password_change`, požadavky na heslo a rozumné limity pokusů v `supabase/config.toml` i v dashboardu.

### GDPR a souhlasy

- [ ] Smazání účtu: anonymizace osobních údajů a zablokování přihlášení, finanční záznamy zůstanou.
- [ ] Export dat uživatele.
- [ ] Verze a hash dokumentu u souhlasu podniku s podmínkami (`business_billing`) a u zákazníka při první rezervaci.
- [ ] Souhlas s analytikou, pokud tak rozhodne právník.

### Provoz a spolehlivost

- [ ] Zapojit Sentry do aplikace (až bude DSN).
- [ ] Hlídání selhání: kontrola `cron.job_run_details`, chyb v `private.stripe_events` a vratek s `refund_attempts >= 8`, s upozorněním adminovi.
- [ ] Popsat a jednou vyzkoušet obnovu ze zálohy.

### Úklid dema před ostrým provozem

- [ ] Vypnout denní obnovu demo nabídek: `select cron.unschedule('flek-demo-refresh');`.
- [ ] V ostré databázi nesmí zůstat demo platby se selhanou vratkou z akceptačních kontrol (`pm_card_refundFail`); vznikají jen na účtech `@flek.test`.
- [ ] V produkčním projektu nesmí zůstat demo podniky ani účty `@flek.test`. Admin akce `demo_accounts` funguje jen s testovacím klíčem.
- [ ] Přepsat Notion stránku „FLEK — přehled projektu“ obsahem `docs/NOTION.md`.

### Výkon (není nutné ke spuštění)

- [ ] Zmenšit balík aplikace: mapa má 979 kB, Temporal 325 kB. Změřit Lighthouse na mobilu.

---

## Část 3: Postup spuštění

1. Hotové jsou úkoly Stripe, Supabase a právo z části 1 a sekce Platby, E-maily a Úklid dema z části 2.
2. Produkční Supabase: aplikovat migrace (`supabase db push`), zkontrolovat advisor a vytvořit admin účet s MFA.
3. Nasadit Edge Functions bez `stripe-test-pay` (včetně `booking-confirmation`, `notification-delivery` a `whatsapp-webhook`) a vložit ostré secrets Stripe a Meta.
4. Vytvořit ostré webhooky Stripe se všemi událostmi včetně `payment_intent.amount_capturable_updated`, `payment_intent.canceled` a `payment_intent.payment_failed` a ověřit, že testovací událost dojde (`stripe_events` v databázi).
5. Nastavit přepínač `manual_confirmation_enabled` pro produkci (ve stagingu ověřený `true`).
6. Spustit migraci `stripe_test_mode = false`.
7. Vercel: produkční proměnné na nový projekt, doména app-flek.eu, Redirect URLs v Supabase.
8. První podnik projde onboardingem Stripe a zveřejní FLEK.
9. **Kontrolní platba skutečnou kartou** na malou částku: podnik ji potvrdí, potom storno a ověření vratky na účtu.
10. Sledovat první dny: Sentry, `private.stripe_events`, `private.confirmation_jobs`, vratky a cron joby.

Rollback plateb: dokud je jen jeden podnik, stačí FLEK zrušit v partnerské části. Rezervace se zruší a peníze vrátí automaticky přes `stripe-refunds`.
