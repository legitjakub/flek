# FLEK — co zbývá před spuštěním

Stav k 13. 9. 2026. Seznam všeho, co je potřeba dodělat, než FLEK začne brát skutečné peníze od skutečných zákazníků. Úkoly jsou rozdělené podle toho, **kdo je musí udělat**:

- **Část 1: Musí udělat člověk.** Úkoly vyžadují účty, podpisy, peníze, osobní údaje, přihlašovací klíče nebo právníka. AI agent je udělat nesmí, nebo nemůže.
- **Část 2: Zvládne AI agent v kódu.** Stačí mu zadat úkol, nic dalšího nepotřebuje.
- **Část 3: Postup spuštění.** Pořadí kroků v den přepnutí na ostrý provoz.

Hotový úkol odškrtni tady i v `docs/NOTION.md` (todolist fáze B). Úkoly na teď pro Jakuba jsou v Notionu v sekci „Na tahu je Jakub“.

## Kde jsme teď

- Aplikace běží veřejně na https://www.app-flek.eu jako demo pilot (původní https://flek-nine.vercel.app funguje dál).
- E-maily jdou přes Resend z `mail.app-flek.eu`. Upozornění na rezervace fungují v aplikaci a e-mailem; push čeká na `VAPID_PRIVATE_KEY` v Supabase secrets.
- Platby jdou **jen přes Stripe Connect v testovacím režimu**:
  - zákazník platí na stránce Stripe Checkout,
  - FLEK si ponechá servisní poplatek, zbytek jde podniku,
  - vratky i obsazení místa řeší webhook.
  - Skutečné peníze se nestrhávají.
- 16 demo podniků má testovací účet Stripe. Demo FLEKy se každé ráno doplní na 3 dny dopředu.
- Ověřeno: 100/100 akceptačních kontrol se skutečnými testovacími platbami Stripe, build a unit testy v CI.

---

## Část 1: Musí udělat člověk

### Stripe

- [ ] **Ruční testovací platba.** Otevřít FLEK u demo podniku, rezervovat a zaplatit kartou `4242 4242 4242 4242` (libovolné budoucí datum a CVC). Ověřit, že se objeví rezervační kód, a pak rezervaci zrušit a zkontrolovat vratku v Stripe Dashboardu (sandbox).
- [ ] **Projít onboarding skutečného podniku.** V partnerské části „Kubova“ → Provozovna → „Propojit se Stripe“. V testovacím režimu jde použít testovací údaje. Totéž platí pro „Tenis kurt“ (sejmencz@post.cz): dokud Stripe nepropojí, podnik nemůže zveřejnit FLEK.
- [ ] **Aktivovat ostrý účet Stripe** pro firmu FLEK (IČO, bankovní účet, ověření totožnosti jednatele).
- [ ] **V ostrém režimu dokončit nastavení Connect.** Týká se to profilu platformy, země Česko, Express dashboardu pro podniky a potvrzení, že poplatky a ztráty nese platforma (`losses_collector = application`). Bez toho Stripe nedovolí zakládat účty podniků.
- [ ] **Vytvořit ostrý webhook** na `https://<projekt>.supabase.co/functions/v1/stripe-webhook`:
  - Události platformy: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `charge.refunded`.
  - Zvlášť Connect webhook (události připojených účtů) s `account.updated`.
- [ ] **Vložit ostré klíče do Supabase → Edge Functions → Secrets:** `STRIPE_SECRET_KEY` (`sk_live_…`) a `STRIPE_WEBHOOK_SECRET` (`whsec_…`). Klíče nikdy do chatu, repozitáře ani `.env` v gitu.
- [ ] **Nastavit vzhled Checkoutu a výpis na kartě.** V Stripe nahrát logo a barvy a nastavit text výpisu (statement descriptor), např. `FLEK`.

### Supabase a infrastruktura

- [ ] **Rozhodnout o produkčním prostředí.** Doporučení je nový Supabase projekt pro ostrý provoz; současný `yupkrntknbkvmlajwlph` zůstane jako demo/staging pro akceptační testy.
- [ ] **Produkční projekt přepnout na Supabase Pro** (placené). Přináší zálohy, projekt se neuspává a zapne se ochrana proti prolomeným heslům.
- [ ] **Převést vlastnictví Supabase na firemní účet.** Dnes je projekt v organizaci jiného účtu. Zapnout 2FA a přidat druhého vlastníka.
- [x] **Redirect URLs a Site URL** v Supabase → Authentication → URL Configuration: `https://www.app-flek.eu` (13. 9.).
- [x] **Doména app-flek.eu:** DNS v Endoře a doména ve Vercelu (13. 9.).
- [x] **E-maily:** účet Resend, doména `mail.app-flek.eu` (DKIM a dva CNAME v Endoře), SMTP v Supabase Auth (13. 9.). Resend doménu ověřil (Verified).
- [x] **`NOTIFICATION_FROM` a `VAPID_PUBLIC_KEY`** v Supabase → Edge Functions → Secrets (13. 9.). E-mailová upozornění fungují.
- [ ] **`VAPID_PRIVATE_KEY`** doplnit v Supabase → Edge Functions → Secrets ze souboru `/private/tmp/flek-notification-secrets.env`. Bez něj push upozornění čekají ve frontě.
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
- [ ] **Přehled plateb pro admina a účetní export (CSV):** platby, vratky, poplatky FLEKu a převody podnikům spárované se Stripe ID.
- [x] **Úklid `scripts/acceptance.mjs`:** mrtvé větve demo plateb odstraněné (13. 9.).
- [ ] **Spustit `npm run test:integration` s Dockerem.** Po přechodu na Stripe neběžel; helper `book()` teď potvrzuje platbu přes `stripe_payment_succeeded`.

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
- [ ] V produkčním projektu nesmí zůstat demo podniky ani účty `@flek.test`. Admin akce `demo_accounts` funguje jen s testovacím klíčem.
- [ ] Přepsat Notion stránku „FLEK — přehled projektu“ obsahem `docs/NOTION.md`.

### Výkon (není nutné ke spuštění)

- [ ] Zmenšit balík aplikace: mapa má 979 kB, Temporal 325 kB. Změřit Lighthouse na mobilu.

---

## Část 3: Postup spuštění

1. Hotové jsou úkoly Stripe, Supabase a právo z části 1 a sekce Platby, E-maily a Úklid dema z části 2.
2. Produkční Supabase: aplikovat migrace (`supabase db push`), zkontrolovat advisor a vytvořit admin účet s MFA.
3. Nasadit Edge Functions bez `stripe-test-pay` a vložit ostré secrets Stripe.
4. Vytvořit ostré webhooky Stripe a ověřit, že testovací událost dojde (`stripe_events` v databázi).
5. Spustit migraci `stripe_test_mode = false`.
6. Vercel: produkční proměnné na nový projekt, doména app-flek.eu, Redirect URLs v Supabase.
7. První podnik projde onboardingem Stripe a zveřejní FLEK.
8. **Kontrolní platba skutečnou kartou** na malou částku, potom storno a ověření vratky na účtu.
9. Sledovat první dny: Sentry, `private.stripe_events`, vratky a cron joby.

Rollback plateb: dokud je jen jeden podnik, stačí FLEK zrušit v partnerské části. Rezervace se zruší a peníze vrátí automaticky přes `stripe-refunds`.
