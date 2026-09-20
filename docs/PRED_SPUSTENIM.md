# FLEK — co zbývá před spuštěním

Stav k 18. 9. 2026. Seznam všeho, co je potřeba dodělat, než FLEK začne brát skutečné peníze od skutečných zákazníků. Úkoly jsou rozdělené podle toho, **kdo je musí udělat**:

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
- 16 demo podniků má testovací účet Stripe. Demo FLEKy se každé ráno doplní na 3 dny dopředu, od 20. 9. tři termíny na službu a den.
- **Potvrzování rezervací podnikem** (hold před Checkoutem, autorizace, potvrzení do 10/5/3 minut, stržení až potom) je od 15. 9. 15:54 zapnuté pro všechny podniky (`manual_confirmation_enabled = 'true'`), po zelených testech v režimu `demo` (akceptace 106/106, průchod se skutečnými testovacími platbami).
- **WhatsApp** pro podniky i zákazníky (výchozí zapnutý, ověření čísla jedním klepnutím, vypínatelný v nastavení upozornění) je v kódu a databázi. U Meta je od 18. 9. aplikace FLEK s odsouhlasenými podmínkami a testovacím číslem; čeká na pět šablon, webhook a secrets.
- **Právní texty** verze 1.0 (podmínky pro zákazníky s oddílem o nahlášení obsahu, podmínky pro podniky a zásady ochrany osobních údajů) jsou v aplikaci, ale zobrazí se až s údaji provozovatele. Souhlas s verzí zapisuje server, analytika nic neukládá do prohlížeče, e-mail o rezervaci chodí zákazníkovi vždy a účet jde smazat v Profilu.
- **Přihlášení přes Google a Apple** je v kódu a prověřené až k poslednímu kroku. Tlačítka se ukážou, až je Jakub zapne v Supabase (postup v `docs/NOTION.md`, Na tahu je Jakub); `npm run check:oauth` kdykoli vypíše, co ještě chybí. K 20. 9. je obojí vypnuté.
- **Nasazení webu** jde zase samo z `main`: 18. 9. agent s Jakubovým souhlasem odpojil od projektu ve Vercelu uspanou databázi z Vercel Marketplace, která nasazení shazovala. Na webu běží verze z 18. 9.
- Ověřeno: 101/101 akceptačních kontrol se skutečnými testovacími platbami Stripe (původní režim), SQL testy potvrzování a WhatsAppu, build a unit testy v CI.

---

## Část 1: Musí udělat člověk

### Stripe

- [ ] **Ruční testovací platba.** Otevřít FLEK u demo podniku, rezervovat a zaplatit kartou `4242 4242 4242 4242` (libovolné budoucí datum a CVC). Ověřit, že se objeví rezervační kód, a pak rezervaci zrušit a zkontrolovat vratku v Stripe Dashboardu (sandbox).
- [x] **Projít onboarding skutečného podniku „Kubova“.** Propojený 14. 9. (platby, výplaty i údaje potvrzené).
- [ ] **„Tenis kurt“ (sejmencz@post.cz)** propojený se Stripe není: dokud to majitel neudělá, podnik nemůže zveřejnit FLEK.
- [ ] **Aktivovat ostrý účet Stripe** pro firmu FLEK (IČO, bankovní účet, ověření totožnosti jednatele).
- [ ] **V ostrém režimu dokončit nastavení Connect.** Týká se to profilu platformy, země Česko, Express dashboardu pro podniky a potvrzení, že poplatky a ztráty nese platforma (`losses_collector = application`). Bez toho Stripe nedovolí zakládat účty podniků.
- [ ] **Vytvořit ostrý webhook** na `https://<projekt>.supabase.co/functions/v1/stripe-webhook`:
  - Události platformy: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`. Bez událostí `refund.*` se o vratce, která selže až dodatečně, FLEK nedozví. Testovací webhook je má od 14. 9.
  - Zvlášť Connect webhook (události připojených účtů) s `account.updated`.
- [ ] **Vložit ostré klíče do Supabase → Edge Functions → Secrets:** `STRIPE_SECRET_KEY` (`sk_live_…`) a `STRIPE_WEBHOOK_SECRET` (`whsec_…`). Klíče nikdy do chatu, repozitáře ani `.env` v gitu.
- [ ] **Nastavit vzhled Checkoutu a výpis na kartě.** V Stripe nahrát logo a barvy a nastavit text výpisu (statement descriptor), např. `FLEK`.

### Potvrzování rezervací a WhatsApp

- [x] **Edge Functions nasazené** (15. 9.): push do `main` nasadil přes GitHub integraci Supabase funkce z `supabase/config.toml` (`stripe-webhook`, `notification-delivery`, `whatsapp-webhook`, `booking-confirmation`, `stripe-refunds`), `stripe-checkout` a `stripe-test-pay` nasadil agent přes MCP. Webhook prošel akceptací 101/101.
- [x] **Testovací Stripe webhook:** události `payment_intent.amount_capturable_updated`, `payment_intent.canceled` a `payment_intent.payment_failed` doplnil agent 15. 9. admin funkcí `stripe-webhook-setup` (najde endpoint této aplikace a přidá chybějící události, klíč zůstává v Supabase secrets).
- [ ] **Ostrý Stripe webhook:** po jeho vytvoření a vložení ostrých klíčů stačí jako admin zavolat `stripe-webhook-setup` (nejdřív s `{"dry_run": true}`), doplní stejné události.
- [x] **Potvrzování pro všechny podniky** zapnul agent 15. 9. v 15:54 po Jakubově výslovném souhlasu.
- [ ] **Ruční test na telefonu** (demo podniky už potvrzují): zaplatit Apple Pay nebo Google Pay a kartou 4242 přímo na stránce Stripe Checkout, zkontrolovat, že banka ukáže jen blokaci, potvrdit v partnerské části druhým účtem a ověřit kód; podruhé zvolit Nemohu přijmout a ověřit, že blokace zmizí. Agent prošel stejný tok s testovací kartou zadanou na serveru (číslo karty do formuláře psát nesmí).
- [ ] **Meta — WhatsApp Business Platform:**
  1. **Pro pilot stačí testovací číslo** (hotovo 18. 9.: aplikace FLEK, podmínky Meta odsouhlasené agentem s Jakubovým svolením, testovací WhatsApp účet a číslo; Phone Number ID a ID účtu má Jakub v chatu, do repozitáře nepatří): Meta for Developers → nová aplikace typu Business → produkt WhatsApp → „API Setup“. Testovací číslo nepotřebuje ověření firmy, ale posílá zprávy jen na nejvýš 5 čísel přidaných v „To“ (Jakub, demo telefon podniku). Pro ostrý provoz: Business portfolio s ověřením firmy, WhatsApp Business Account a vlastní číslo pro FLEK (nesmí být zároveň v aplikaci WhatsApp), zobrazované jméno „FLEK“.
  2. System user s trvalým tokenem a oprávněními `whatsapp_business_messaging` a `whatsapp_business_management` (testovací token platí jen 24 hodin). Zkopírovat App Secret a Phone number ID.
  3. Webhook: callback `https://yupkrntknbkvmlajwlph.supabase.co/functions/v1/whatsapp-webhook`, verify token náhodný řetězec aspoň 16 znaků, odebírat pole `messages`. Nejdřív ulož v Supabase secrets `WHATSAPP_VERIFY_TOKEN` (stejný řetězec) a `WHATSAPP_APP_SECRET` (bod 5), jinak Meta webhook při „Verify and save“ neověří.
  4. Pět šablon kategorie **Utility**, jazyk čeština (`cs`). **Neklikej je ručně:** po vložení tajných klíčů (bod 5) je jako admin založí funkce `whatsapp-templates-setup` — nejdřív `{"dry_run": true}`, pak naostro; znění níž má uložené v `supabase/functions/_shared/whatsapp.ts` a šablonu, která už u Mety je, nepřepisuje. Ruční postup zůstává jako záloha. Parametry musí zůstat v tomto pořadí (posílá je `claim_whatsapp_deliveries`):
     - `flek_booking_request` (podniku, žádost o potvrzení), tlačítka: dvě rychlé odpovědi s texty přesně **Potvrdit** a **Nemohu přijmout**:
       ```
       Nová rezervace čeká na potvrzení.
       Termín: {{1}}
       Služba: {{2}}
       Vy dostanete: {{3}}
       Potvrďte do {{4}}, jinak žádost vyprší a zákazník nic nezaplatí.
       ```
       Ukázky: `dnes 14:30`, `Pánský střih (45 min)`, `750 Kč`, `14:08`.
     - `flek_business_confirmed` (podniku, nová rezervace bez potvrzování):
       ```
       Máte novou potvrzenou rezervaci.
       Termín: {{1}}
       Služba: {{2}}
       Vy dostanete: {{3}}
       Kód zákazníka ověříte v aplikaci FLEK Partner.
       ```
       Ukázky: `zítra 9:00`, `Masáž zad (60 min)`, `586 Kč`.
     - `flek_business_cancelled` (podniku, zrušení, vypršení, selhání platby):
       ```
       Změna rezervace ve FLEKu.
       Termín: {{1}}
       Služba: {{2}}
       Stav: {{3}}
       Podrobnosti najdete v aplikaci FLEK Partner v Rezervacích.
       ```
       Ukázky: `st 17. 9. 18:15`, `Pánský střih (45 min)`, `Rezervace byla zrušena`.
     - `flek_customer_confirmed` (zákazníkovi, potvrzený FLEK):
       ```
       Tvůj FLEK je potvrzený.
       Podnik: {{1}}
       Termín: {{2}}
       Služba: {{3}}
       Rezervační kód: {{4}}
       Kód ukážeš v podniku, rezervaci najdeš i v aplikaci FLEK.
       ```
       Ukázky: `Studio Dobrá hodina`, `dnes 17:00`, `Pánský střih (45 min)`, `FLEK-7K2QHM`.
     - `flek_customer_cancelled` (zákazníkovi, zrušení nebo nepotvrzená žádost):
       ```
       Změna tvé rezervace ve FLEKu.
       Podnik: {{1}}
       Termín: {{2}}
       Služba: {{3}}
       Stav: {{4}}
       Co to znamená pro platbu, najdeš v aplikaci FLEK v Rezervacích.
       ```
       Ukázky: `Studio Dobrá hodina`, `zítra 13:00`, `Pánský střih (45 min)`, `Podnik rezervaci nepotvrdil`.
  5. Supabase → Edge Functions → Secrets: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WABA_ID` (ID WhatsApp účtu, potřebuje ho zakládání šablon), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TEMPLATE_BOOKING_REQUEST` (`flek_booking_request`), `WHATSAPP_TEMPLATE_BUSINESS_CONFIRMED`, `WHATSAPP_TEMPLATE_BUSINESS_CANCELLED`, `WHATSAPP_TEMPLATE_CUSTOMER_CONFIRMED`, `WHATSAPP_TEMPLATE_CUSTOMER_CANCELLED` (názvy šablon výše), `WHATSAPP_TEMPLATE_LANGUAGE` (`cs`), volitelně `WHATSAPP_GRAPH_VERSION` (výchozí `v25.0`). Šablonu, která ještě není schválená, stačí nevyplnit: ta zpráva se přeskočí. Nikdy do chatu ani repozitáře.
  6. Říct agentovi zobrazované číslo FLEK; zapíše ho do `private.settings` (`whatsapp_display_number`). Tím se WhatsApp objeví v Provozovně, v Profilu a ve výzvách.
  7. Na svém telefonu: v Profilu i v Provozovně demo podniku klepnout na „Ověřit ve WhatsAppu“ (má se otevřít WhatsApp s připravenou zprávou), zprávu odeslat, nechat přijít žádost a vyzkoušet obě tlačítka, opakované klepnutí a zprávu zákazníkovi s kódem.
- [ ] **E-mail při registraci:** SMTP v Supabase Auth je uložené správně (ověřeno 15. 9.: zapnuté, odesílatel `ucet@mail.app-flek.eu`, uživatel `resend`, port 465). Zbývá zaregistrovat novou adresu, otevřít odkaz v jiném prohlížeči a ověřit přihlášení.

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
- [x] **VAPID klíče** uložené ve správci hesel, dočasný soubor s klíči smazaný (15. 9.).
- [x] **Skutečné e-maily:** obnova hesla a upozornění doručené na jakub.hrncir24@gmail.com (Resend: Delivered, 13. 9.). Zbývá zkouška s rezervací kartou 4242 a push.
- [x] **Vercel: odpojit databázi `supabase-cerulean-village` od projektu flek** (18. 9., agent po Jakubově výslovném souhlasu: Storage → Projects → Remove Project Connection). Databáze zůstala a jde znovu připojit; nasazení od té doby prochází. K projektu nepřipojovat úložiště z Vercel Marketplace, uspané shodí každé nasazení.
- [ ] **Přihlášení přes Google a Apple:** klient OAuth v Google Cloud a Services ID s klíčem u Apple Developer, klíče vložit v Supabase → Authentication → Sign In / Providers, přidat `https://www.app-flek.eu/prihlaseni` do Redirect URLs. Postup krok za krokem je v `docs/NOTION.md` (Na tahu je Jakub). U Apple je potřeba každých 6 měsíců vygenerovat nový tajný klíč a zaregistrovat odesílací doménu pro skryté e-mailové adresy.
- [ ] **Monitoring chyb:** účet Sentry (nebo podobné služby) a předání DSN do Vercelu jako `VITE_SENTRY_DSN`.
- [ ] **Vercel:** proměnné `VITE_*` pro produkci, včetně skutečného `VITE_SUPPORT_EMAIL`.

### Právo, účetnictví a firma

Texty napsal agent podle skutečného chování FLEKu (18. 9. 2026): `src/content/pravni/podminky.md` (zákazníci, včetně nahlášení obsahu podle DSA), `podminky-podniky.md` (podniky, P2B, zakázaný obsah) a `soukromi.md` (GDPR). Jsou veřejné v repozitáři; v aplikaci se ukážou na `/podminky`, `/podminky-podniky` a `/soukromi`, jakmile budou v databázi údaje provozovatele. Po srovnání s Too Good To Go, TasteTown, Fresha a Reservio (viz `DECISIONS.md`) jsou pravidla obsahu oddílem podmínek, ne samostatným dokumentem.

- [ ] **Údaje provozovatele.** Jakub pošle agentovi jméno (obchodní firmu), IČO, adresu místa podnikání (případně jinou doručovací adresu) a e-mail podpory. Agent je uloží do `private.settings` (`operator_name`, `operator_ico`, `operator_address`, `support_email`) a nastaví účinnost verze 1.0 (`legal_documents.effective_at`). Tím se objeví patička „O FLEKu“, texty, souhlas v rezervaci a patička e-mailů. U s.r.o. přidá Jakub zápis v obchodním rejstříku a agent upraví řádek o zápisu v podmínkách a v patičce. Co pak musí Jakub přepsat ve svých účtech (Stripe, Meta, Google, Apple, Vercel, doména, úřady), je v `docs/NOTION.md`.
- [ ] **Právní kontrola textů a výchozích řešení před ostrým provozem** (právník). Agent zvolil tato výchozí řešení podle dnešní aplikace; právník potvrdí, nebo řekne, co změnit:
  - **Odstoupení:** u služeb využití volného času v určeném termínu (sport, jóga, wellness, masáže) výjimka z 14denní lhůty podle § 1837 písm. j). Pro služby, na které se nevztahuje (hlavně kadeřnictví a kosmetika), podmínky i věta před platbou obsahují výslovnou žádost o poskytnutí v rezervovaném termínu, tedy před koncem lhůty; po úplném poskytnutí právo zaniká (§ 1837 písm. a)), při odstoupení během poskytování zákazník platí poměrnou část (§ 1834). Ověřit, že věta v rezervaci stačí jako výslovná žádost a poučení a že zrušení zdarma podle podmínek s tím nekoliduje.
  - **Storno a nedostavení:** zrušení zdarma do lhůty podniku (výchozí 60 minut před začátkem) nebo 10 minut od potvrzení; při nedostavení se nic nevrací; po 2 nedostaveních za 60 dní se rezervace zablokují.
  - **Vznik smlouvy:** potvrzením podniku; do té doby je částka na kartě jen blokovaná a kód se neukáže.
  - **Model plateb a DPH:** FLEK přijímá platbu přes Stripe jménem podniku, servisní poplatek je úplata za zprostředkování. Stripe destination charge bez `on_behalf_of` ale dělá z FLEKu obchodníka na výpisu z karty a spory nese FLEK; s daňovým poradcem rozhodnout, zda přejít na `on_behalf_of`.
  - **Tlačítko:** v aplikaci „Pokračovat k platbě“ s větou o souhlasu a o blokaci, na stránce Stripe Checkout od 18. 9. „Zaplatit“ (dřív „Zarezervovat“) s větou, že se částka nejdřív jen zablokuje. Ověřit, že to splňuje § 1826a i v režimu potvrzování, kdy se peníze strhnou až po potvrzení podnikem.
  - **P2B a DSA:** podmínky pro podniky (řazení, poplatky, pozastavení s odůvodněním, ukončení 30 dní předem, změny oznámené 15 dní předem a platné pokračováním ve spolupráci), nahlášení obsahu a odůvodnění jako oddíl podmínek. Formální vnitřní odvolání (čl. 20 DSA) mikropodnik mít nemusí, podmínky proto nabízejí jen nové posouzení na e-mailu.
  - **DAC7:** registrace provozovatele a roční oznámení; podklad stáhne admin v Administraci → Metriky.
  - **Zásady ochrany osobních údajů:** právní základy, doby uchování, zpracovatelé a předávání mimo EU.
  - Po kontrole: každá změna textu zvedne verzi (viz `AGENTS.md`).
- [ ] **Obory živnosti.** Ověřit v živnostenském rejstříku, že živnost pokrývá zprostředkování obchodu a služeb, případně obor doplnit.
- [ ] **DAC7** (s daňovým poradcem): registrace u Specializovaného finančního úřadu a oznámení do konce ledna za předchozí rok. Podniky zadávají datum narození (OSVČ), stát a adresu sídla ve fakturačních údajích.
- [ ] **Daně:** s daňovým poradcem ujasnit DPH ze servisního poplatku (plátcovství nad 2 000 000 Kč za kalendářní rok) a to, kdo komu vystavuje doklad (FLEK → podnik za poplatek, podnik → zákazník za službu).
- [ ] **Fakturační nástroj** pro poplatky podnikům, například Fakturoid (rozhodnutí a účet).
- [ ] **Firma a pojištění:** zvážit s.r.o. (ručení) a pojištění odpovědnosti. Při změně provozovatele agent vydá novou verzi textů.
- [ ] **Ochranná známka FLEK:** rešerše a případná přihláška.

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

- [x] Události ve Stripe, `manual_confirmation_enabled = 'demo'`, `npm run test:acceptance` v režimu potvrzování (106/106) a průchod zákazník (375 px) + podnik (390 px) se skutečnými testovacími platbami: potvrzení → kód a stržení, odmítnutí → uvolněná blokace (15. 9.).
- [x] Přepnuto na `'true'` a upravený text na stránce pro podniky („…rezervaci během pár minut potvrdíte…“) i nápověda k lhůtě zrušení v Provozovně („10 minut od potvrzení rezervace“) (15. 9.).
- [x] Opravy nasazené verze ChatGPT, oba SQL testy, akceptační skript pro oba režimy, unit testy stavů (15. 9.).
- [x] WhatsApp v kódu: párování, šablona, webhook s ověřením podpisu, rozhodnutí přes `decide_booking` (15. 9.).
- [x] WhatsApp pro zákazníky, výchozí zapnutý a vypínatelný po událostech, ověření jedním klepnutím, pět šablon (15. 9.).
- [ ] Po zapnutí WhatsAppu: projít výzvy na obrazovce čekání na potvrzení a „🔥 FLEK je tvůj!“ se skutečnou testovací platbou.

### E-maily a upozornění

- [x] Potvrzení a zrušení rezervace zákazníkovi e-mailem, v aplikaci a push (13. 9.).
- [x] Povinné potvrzení rezervace e-mailem (potvrzení smlouvy „na trvalém nosiči“): poskytovatel, cena, kód, storno, nedostavení, verze podmínek a ADR (`supabase/functions/_shared/email.ts`), v patičce provozovatel; zákazníkovi ho nejde vypnout (18. 9.). Skutečný e-mail přes novou verzi zatím nikdo nedostal, demo účty e-maily nedostávají.
- [ ] Připomínka před termínem.
- [x] E-mail, push a upozornění v aplikaci podniku o nové rezervaci a o stornu, nastavitelné v Provozovně (13. 9.).
- [ ] E-mail o vratce.

### Přihlášení a zabezpečení

- [ ] Povinné MFA (TOTP) pro administrátory: `is_admin()` vyžaduje `aal2` a v `/admin` se MFA nastavuje.
- [ ] CAPTCHA (Cloudflare Turnstile) u registrace a obnovy hesla. Klíče založí člověk.
- [ ] `secure_password_change`, požadavky na heslo a rozumné limity pokusů v `supabase/config.toml` i v dashboardu.
- [x] Přihlášení přes Google a Apple v kódu (`SocialSignIn.tsx`): tlačítka jen pro poskytovatele zapnuté v Supabase, návrat na původní stránku, jméno z účtu Google do profilu (18. 9.). Klíče zakládá Jakub.
- [x] Prověřený zbytek cesty (20. 9.): `tests/oauth-profile.sql` hlídá, co trigger udělá se jménem od Googlu i s prázdnou odpovědí Apple, a `npm run check:oauth` rozliší vypnutého poskytovatele od nepovolené návratové adresy. Do Redirect URLs patří `https://www.app-flek.eu/**` (návrat nese dotaz `?oauth=…&returnTo=…`), ne samotné `/prihlaseni`. Apple ve webovém toku jméno neposílá.

### GDPR a souhlasy

- [x] Export dat uživatele v Profilu (RPC `export_my_data`, 18. 9.).
- [x] Verze textu u souhlasu podniku (fakturační údaje, banner nové verze) i zákazníka (každá platba) zapisuje server do `private.legal_acceptances` (18. 9.).
- [x] Analytika bez souhlasu: v prohlížeči se nic neukládá, události nejsou propojené identifikátorem relace (18. 9.).
- [x] Smazání účtu v Profilu (`delete_my_account`: anonymizace profilu i přihlašovacího e-mailu, zrušení přihlášení, rezervace a platby zůstanou bez osobních údajů) a denní mazání starých dat (cron `flek-retention`: doručování a zprávy WhatsApp po 90 dnech, upozornění po 12 měsících, vyřízená nahlášení po 3 letech, záznamy cronu po 14 dnech) (18. 9.).
- [x] Zprávy dotčenému při schválení nebo pozastavení podniku, při blokaci zákazníka (důvod je povinný) a oznamovateli po vyřízení nahlášení, v aplikaci i e-mailem (18. 9.).

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
