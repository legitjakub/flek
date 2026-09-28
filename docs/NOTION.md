# FLEK — přehled projektu

> Aktualizováno 27. 9. 2026. Zdroj pravdy je repozitář (`docs/NOTION.md`). Stránku aktualizuje agent na požádání; ruční úpravy tady se při další aktualizaci přepíšou.

## Ve zkratce

FLEK je český marketplace pro volná místa na poslední chvíli. Podnik (kadeřnictví, masáže, jóga, sport, wellness) zveřejní termín, který by jinak propadl, a zákazník si ho se slevou rezervuje, zaplatí v aplikaci a v podniku ukáže kód.

| Co | Stav |
| --- | --- |
| Fáze | Fáze 1 — demo pilot (běží veřejně, platby přes Stripe v testovacím režimu) |
| Web | https://www.app-flek.eu (původní https://flek-nine.vercel.app funguje dál) |
| Kód | https://github.com/legitjakub/flek (větev `main`) |
| Poslední nasazení | web + Edge Functions 27. 9. (`c09ed4c`), Vercel/CI/Supabase success; dříve web 25. 9. 2026 (nový vzhled partnerské části, zvonění a oznámení pro podniky zapnuté s povolením, úvod pro zákazníky na jedné obrazovce) a migrace `20260925205632_merchant_push_default` v hostované DB; předtím web a migrace fotografií 23. 9. (`e9fd9cb`). `content-moderation` nasazený 21. 9. |
| Testy | 230 unit testů a build po závěrečném sloučení aktuálního main (27. 9.); skutečný Checkout sandbox → autorizace → potvrzení → capture → kód → storno → refund 402 Kč; SQL regrese potvrzování, vratek a povinného emailu s rollbackem; UI 320/375/390/1280 px |
| Potvrzování rezervací podnikem | **zapnuté pro všechny podniky** od 15. 9. 15:54 (předtím demo: akceptace 106/106 a průchod se skutečnými testovacími platbami) |
| WhatsApp | u Mety platný trvalý token, aplikace FLEK přihlášená k odběru, webhook ověřený, profil s logem, číslo FLEKu uložené; všech pět šablon Meta 27. 9. schválila; odesílání ale dál blokuje, dokud není přidaná platební metoda, vyplněný profil firmy a ověřená firma, a chybí zkouška na telefonu, do té doby je kanál serverově vypnutý a v UI skrytý |
| Recenze a moderace | ověřené anonymní hvězdičky a komentáře po dokončené rezervaci; komentáře, vlastní veřejné texty a fotografie čekají na kontrolu. Funkce je nasazená, ale OpenAI 21. 9. vrací HTTP 429, takže nové podklady zatím bezpečně zůstávají neveřejné v admin frontě |
| Právní texty | **zásady ochrany osobních údajů jsou od 20. 9. zveřejněné** (správce Jakub Hrnčíř jako fyzická osoba, kontakt jakub@app-flek.eu); obchodní podmínky pro zákazníky i pro podniky ve verzi 1.0 čekají na IČO. Všechny texty před ostrým provozem zkontroluje právník |
| Přihlášení | e-mail a heslo; **Google od 20. 9. funguje** (v Google Cloud zatím režim Testing, přihlásí se jen účty v seznamu test users); Apple čeká na placené členství v Apple Developer Program |
| Data v produkci (13. 9.) | 18 schválených podniků, 330 nabídek, 321 rezervací, 16 účtů (12 demo, 4 ostatní), od 13. 9. platby jen přes Stripe (test), 16 demo podniků s testovacím Stripe účtem |
| Pro AI agenty | `AGENTS.md` v kořeni repozitáře (Claude Code ho načítá přes `CLAUDE.md`) |

## Na tahu je Jakub

Úkoly, které AI agent udělat nesmí nebo nemůže, protože jde o klíče, hesla nebo platbu kartou. Hotové odškrtni.

- [ ] **Schválit agentovi volání Supabase z chatu.** Audit před spuštěním (28. 9.) potřebuje číst hostovanou databázi (kontroly dat, Security Advisor) a nasadit opravy migrací. Volání nástrojů Supabase v aplikaci Claude teď končí „requires approval“: potvrď je, až se objeví, nebo je u konektoru Supabase povol bez ptaní. Heslo ani klíč agent nepotřebuje.
- [x] **Doplnit klíče pro upozornění v Supabase.** `NOTIFICATION_FROM` a `VAPID_PUBLIC_KEY` doplnil Claude, `VAPID_PRIVATE_KEY` Jakub (13. 9.). Otisk klíče sedí se souborem a doručovací funkce s ním běží.
- [ ] **Vložit nové šablony e-mailů do Supabase.** V repozitáři mají `supabase/templates/confirmation.html` a `recovery.html` nově skutečné logo; Supabase Auth ale čte šablony ze svého nastavení, ne z repozitáře. Otevři Supabase → Authentication → Emails, u „Confirm signup“ a „Reset password“ vlož obsah těch dvou souborů a ulož. (Upozornění na rezervace jdou přes Edge Function a ta se nasazuje z `main` sama.)
- [ ] **Vyměnit klíč Resendu.**
  1. V resend.com otevři API keys → Create API key. Název „FLEK“, oprávnění Sending access, doména `mail.app-flek.eu`.
  2. Nový klíč vlož v Supabase na dvě místa: Edge Functions → Secrets jako `RESEND_API_KEY` a Authentication → Emails → SMTP Settings → Password.
  3. Potom v Resendu smaž oba staré klíče („FLEK production“ a „FLEK production rotated“). Objevily se v záznamu Codexu.
- [ ] **Aktivovat a otočit klíč pro automatickou moderaci.** V OpenAI projektu ověř limity/billing pro API; nasazený požadavek na bezplatný Moderation endpoint vrací HTTP 429. Vytvoř nový omezený klíč, vlož ho jako `OPENAI_API_KEY` pouze do Supabase Edge Functions secrets a starý smaž. Potom agent provede bezpečný a závadný test. Bez toho se nic závadného nezveřejní, ale bezpečný nový obsah čeká na ruční kontrolu.
- [x] **Vyzkoušet e-maily.** Claude 13. 9. poslal na jakub.hrncir24@gmail.com „Obnova hesla — FLEK“ a „Zkušební upozornění — FLEK“, Resend oba hlásí Delivered. Zkontroluj, že nepadly do spamu. Odkaz z obnovy hesla použít nemusíš.
- [x] **Platba přes skutečný Stripe Checkout.** Agent 27. 9. prošel standardní testovací kartou celý tok blokace → potvrzení podnikem → stržení → kód/QR → storno → skutečná vratka 402 Kč. Notifikace v aplikaci vznikly správně; testovací nabídky jsou uklizené.
- [x] **Skutečný potvrzovací a storno e-mail:** 27. 9. po Checkout platbě 4242 na vlastním nedemo účtu doručené do Gmailu, otevřené a obsah ověřený. Druhý test skončil skutečným refundem 402 Kč a úklidem nabídky.
- [ ] **Zobrazení push — MANUAL VERIFICATION REQUIRED:** otevřít Oznamovací centrum testovaného Macu a ověřit oznámení FLEK. Zařízení je přihlášené, push potvrzení i storna služba přijala na první pokus; automatické čtení systémového panelu timeoutovalo.
- [x] **Uložit VAPID klíče do správce hesel.** Hotovo 15. 9.: Jakub je uložil a dočasný soubor s klíči smazal (ověřeno, soubor už neexistuje).
- [x] **Propojit podnik „Kubova“ se Stripe.** Hotovo 14. 9.: platby, výplaty i údaje u Stripe potvrzené (ověřeno 15. 9. v databázi). Tenis kurt propojený zatím není.
- [x] **Odhlásit se z Endory.** Přihlášení už vypršelo (13. 9.), DNS záznamy pro Resend jsou uložené a ověřené.
- [x] **Nasadit funkce pro potvrzování rezervací.** Push do `main` je nasadil sám přes GitHub integraci, `stripe-checkout` a `stripe-test-pay` doplnil Claude (15. 9.).
- [x] **Přidat události do testovacího webhooku ve Stripe.** Claude je 15. 9. přidal bez Dashboardu přes admin funkci `stripe-webhook-setup` (klíč zůstal v Supabase), zapnul potvrzování pro demo podniky a testy prošly.
- [x] **Zapnout potvrzování pro všechny podniky.** Po tvém souhlasu přepnul Claude 15. 9. v 15:54 na `true` a upravil dva texty pro podniky.
- [ ] **Dokončit WhatsApp u Meta.** Hotovo 18. 9. (Claude s tvým svolením): podmínky Meta pro WhatsApp odsouhlasené, založený testovací WhatsApp účet s testovacím číslem +1 555 156 7838; Phone Number ID a ID účtu ti Claude napsal do chatu (do repozitáře nepatří). **Stav 24. 9. ve 23:30:** trvalý token systémového uživatele funguje. Claude přihlásil aplikaci FLEK k odběru zpráv, nastavil profil na WhatsAppu (texty, web, e-mail podpory, logo) a uložil číslo FLEKu do aplikace. Všech pět šablon čeká na schválení u Mety (jednu Meta zamítla, má nové znění a je znovu ve schvalování). Zbývá:
  1. ~~`WHATSAPP_VERIFY_TOKEN` do Supabase~~ hotovo 24. 9. ve 23:33, Claude nastavil webhook a Meta ho ověřila.
  2. developers.facebook.com → FLEK → WhatsApp → API Setup → pole „To“ → Manage phone number list: tvoje číslo (případně demo telefon podniku, nejvýš 5 čísel), potvrdit kódem. Testovací číslo píše jen na tato čísla.
  3. **Šablony Meta 27. 9. schválila (všech pět).** Posílat je ale nezačne, protože pořád blokuje celý účet (zjištěno 25. 9., 27. 9. beze změny). Odblokuje ho, až v Meta Business Suite vyplníš **Informace o firmě** (právní název, země Česko, web https://www.app-flek.eu), přidáš **platební metodu** k WhatsApp účtu a ověříš firmu (doklad s IČO). Přesný postup je v `docs/PRED_SPUSTENIM.md`, stav ukazuje administrace v řádku „Účet u Mety“.
  4. Pro skutečné podniky a zákazníky přidat vlastní telefonní číslo (testovací píše jen na 5 čísel ze seznamu „To“).
  5. Až Meta účet odblokuje (nejdřív platební metoda), Claude kanál na tvůj pokyn zpřístupní a ty na telefonu vyzkoušíš „Ověřit ve WhatsAppu“ v Profilu i v Provozovně a zkušební rezervaci. Stav ukáže i administrace (Nastavení → WhatsApp → Zkontrolovat stav).
- [x] **Zkontrolovat SMTP odesílatele v Supabase Auth.** Uložené správně (15. 9.): zapnuté, odesílatel `ucet@mail.app-flek.eu`, jméno FLEK, uživatel `resend`, port 465.
- [ ] **Vyzkoušet registraci nové adresy** s odkazem otevřeným v jiném prohlížeči (agent účty zakládat nesmí).
- [x] **Odpojit uspanou databázi od projektu ve Vercelu.** Hotovo 18. 9.: po tvém souhlasu Claude odpojil nepoužívanou databázi `supabase-cerulean-village` od projektu flek (Storage → Projects → Remove Project Connection; databáze zůstala a jde znovu připojit). Nasazení commitu 060491e prošlo a na www.app-flek.eu běží nová verze.
- [ ] **Údaje provozovatele, až založíš firmu nebo živnost.** Bez nich se právní texty, patička „O FLEKu“ a patička e-mailů nezobrazí.
  1. Pošli agentovi jméno nebo obchodní firmu, IČO, sídlo (místo podnikání), případně jinou doručovací adresu, a e-mail podpory, nejlépe na vlastní doméně (třeba podpora@app-flek.eu).
  2. U s.r.o. přidej zápis v obchodním rejstříku (soud, oddíl a vložka) a DIČ, pokud budeš plátce DPH.
  3. Agent údaje uloží do databáze, upraví v textech řádek o zápisu (živnostenský, nebo obchodní rejstřík), zveřejní podmínky a zásady a zkontroluje patičku webu i e-mailů.
  4. Stejné údaje pak doplň sám ve svých účtech (agent do nich zasahovat nesmí):
     - Stripe → Settings → Business: údaje o firmě, adresa, e-mail podpory a text na výpisu z karty „FLEK“. Při přechodu z OSVČ na s.r.o. Stripe firmu ověří znovu.
     - Meta → Business portfolio: název, adresa a web app-flek.eu; později ověření firmy kvůli ostrému číslu WhatsApp.
     - Google Cloud → Branding pro přihlášení přes Google: název, e-mail podpory, odkazy na /soukromi a /podminky.
     - Apple Developer, pokud chceš přihlášení přes Apple: u s.r.o. členství na firmu (potřebuje číslo D-U-N-S).
     - Vercel → Environment Variables: `VITE_SUPPORT_EMAIL` na nový e-mail podpory.
     - Registrátor domény app-flek.eu: držitel domény.
     - Supabase, GitHub, Vercel a Notion: firemní účet nebo druhý vlastník a dvoufázové ověření.
     - Úřady s daňovým poradcem: registrace DAC7, DPH, obor živnosti „Zprostředkování obchodu a služeb“.
     - Bankovní účet firmy pro výplaty ze Stripe, fakturace poplatků podnikům (třeba Fakturoid) a pojištění odpovědnosti.
- [ ] **Přihlášení přes Google** (zdarma, asi 15 minut; klíče vkládáš ty):
  1. console.cloud.google.com → nový projekt „FLEK“.
  2. Google Auth Platform → Branding: název FLEK, e-mail podpory, domovská stránka `https://www.app-flek.eu`, zásady `https://www.app-flek.eu/soukromi`, podmínky `https://www.app-flek.eu/podminky`, autorizované domény `app-flek.eu` a `yupkrntknbkvmlajwlph.supabase.co`. Audience: External, In production. (Dokud nepošleš údaje provozovatele, ukazuje `/soukromi` jen „Tento dokument právě připravujeme“ — lepší je vyplnit Branding až po nich.)
  3. Clients → Create client → Web application. Authorized JavaScript origins `https://www.app-flek.eu`, Authorized redirect URIs `https://yupkrntknbkvmlajwlph.supabase.co/auth/v1/callback`.
  4. Client ID a Client secret vlož v Supabase → Authentication → Sign In / Providers → Google → Enable → Save.
  5. Supabase → Authentication → URL Configuration: Site URL `https://www.app-flek.eu` a do Redirect URLs přidej **`https://www.app-flek.eu/**`** (s hvězdičkami). Aplikace se vrací na `/prihlaseni?oauth=google&returnTo=…` a Supabase porovnává celou adresu včetně dotazu, takže samotné `https://www.app-flek.eu/prihlaseni` nestačí a přihlášení by skončilo na úvodní stránce. Na starém webu navíc `https://flek-nine.vercel.app/**`.
  6. Na www.app-flek.eu/prihlaseni se objeví „Pokračovat přes Google“, vyzkoušej ho. Když se něco nepovede, `npm run check:oauth` řekne, jestli je vypnutý poskytovatel, nebo chybí návratová adresa.
- [ ] **Přihlášení přes Apple** (placené členství Apple Developer 99 USD ročně, tajný klíč platí nejvýš 6 měsíců):
  1. developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → App IDs: nové ID (třeba `eu.app-flek.web`) se zapnutým Sign in with Apple.
  2. Identifiers → Services IDs: nové ID (třeba `eu.app-flek.signin`), zapnout Sign in with Apple → Configure: primární App ID z bodu 1, doména `yupkrntknbkvmlajwlph.supabase.co`, Return URL `https://yupkrntknbkvmlajwlph.supabase.co/auth/v1/callback`.
  3. Keys → nový klíč se Sign in with Apple, stáhnout soubor `.p8` (jde jen jednou), poznamenat Key ID a Team ID.
  4. Z klíče vygenerovat tajný klíč podle návodu Supabase „Login with Apple“ a vložit ho v Supabase → Authentication → Sign In / Providers → Apple (Client IDs = Services ID z bodu 2) → Enable → Save. Do kalendáře si dej připomínku za 5 měsíců: klíč vygenerovat znovu.
  5. Sign in with Apple for Email Communication: zaregistrovat odesílací doménu `mail.app-flek.eu` a adresy `rezervace@mail.app-flek.eu` a `ucet@mail.app-flek.eu`. Bez toho e-maily na skryté adresy Apple (…@privaterelay.appleid.com) nedojdou a potvrzení rezervace e-mailem je povinné.
  6. Stejné Redirect URLs jako u Googlu (bod 5 výš) platí i pro Apple — stačí je nastavit jednou.
  7. Vyzkoušet „Pokračovat přes Apple“ na www.app-flek.eu/prihlaseni. Počítej s tím, že Apple ve webovém přihlášení **jméno neposílá vůbec** (dává ho jen nativním aplikacím), takže účet vznikne bez jména a aplikace si o něj řekne před první rezervací.
- [ ] **Právní kontrola textů a výchozích řešení před ostrým provozem.** Texty jsou veřejné v repozitáři (`src/content/pravni`), po zveřejnění na `/podminky`, `/podminky-podniky` a `/soukromi`. Kontrolní seznam pro právníka je v `docs/PRED_SPUSTENIM.md` (Právo, účetnictví a firma).
- [ ] **Firma a úřady:** ověřit obory živnosti (zprostředkování obchodu a služeb), s daňovým poradcem registraci a oznámení DAC7 a DPH, zvážit s.r.o. a pojištění odpovědnosti, ochrannou známku FLEK a licenci map pro komerční provoz.

## Todolist

- [x] Swipování nabídek nad mapou po provozovnách, mapa neskáče tam a zpět (28. 9. 2026)
- [x] Stejné průsvitné modré sklo na kartách i v náhledu na mapě, oznámení „Nabídka je aktivní“ v barvách partnerské části (28. 9. 2026)
- [x] Hledání služby lupou v Objevit i na mapě (bez ohledu na diakritiku), filtr „Brzy“ místo „Teď“ (28. 9. 2026)
- [x] Přístupnost: viditelné okraje polí a čtená nápověda i chyba, bílý fokus na tmavých plochách, název stránky v kartě a fokus na nadpis po přechodu, orientace i na šířku, plochy 44 px (28. 9. 2026)
- [x] Partnerská část: dvoukrokové odmítnutí na kartě žádosti, vykání ve sdílených textech, chybové stavy Služeb a Stripe, zpráva po návratu ze Stripe, naposledy použité služby z Přehledu (28. 9. 2026)
- [x] Pravdivý text v Oblíbených s pozvánkou k hlídači, štítek ilustrační fotky na mapě a v úvodu (28. 9. 2026)
- [x] Detail nabídky: vlastní rezervovaný FLEK, potvrzení podnikem před klepnutím, průměr hodnocení od 3 recenzí, sloučené stejné časy (28. 9. 2026)
- [x] Jeden srozumitelný stav rezervace pro zákazníka a stav peněz u částky, potvrzení zrušení žádosti, jiné FLEKy po odmítnutí (28. 9. 2026)
- [x] Čísla na Přehledu pro podniky v jedné kartě: rezervace dnes s částkou, aktivní nabídky s volnými místy a výdělek za měsíc (27. 9. 2026)
- [x] Partnerská část v brandu FLEKu: modré hlavní akce, karty s barevným okrajem podle stavu, seznamy po dnech, záložky s počty, Nabídky jako diář, modrá karta nejbližší rezervace na Přehledu a „Ověřit rezervaci“ s načtením QR kódu (25. 9. 2026)
- [x] Zvonění a oznámení na telefon pro podniky zapnuté samy, podnik jen jednou klepnutím povolí na svém zařízení (25. 9. 2026)
- [x] Úvod pro zákazníky zkrácený na jednu obrazovku s tím nejdůležitějším (25. 9. 2026)
- [x] Zpřehlednit výběr termínu: jeden výrazný souhrn v ultramarínu, podtržené dny a klidnější volby času s cenou (23. 9. 2026)

- [x] Nahradit nevhodnou resortovou fotografii wellness služeb neutrálním spa snímkem; jednorázová migrace opravuje katalog i existující služby a obálky (14. 9. 2026)
- [x] Dokončit originální fotografickou knihovnu pro každou připravenou aktivitu; 74 originálů, dvě varianty pro všech 37 aktivit včetně půjčení kola, responsivně napojené (20. 9. 2026)
- [x] Nahradit generovanou knihovnu vizuálně ověřenými skutečnými fotografiemi nebo neutrálním FLEK placeholderem; zdroje a licence jsou v manifestu a vlastní fotka podniku má stále přednost (23. 9. 2026)
- [x] Zkrátit mobilní detail služby a rezervaci, odstranit opakované údaje, obecné popisy a automaticky otevřenou mapu (23. 9. 2026)

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

- [x] Discovery: čtyři hlavní časy, advanced volby ve Filtrech s viditelnými chips a badge (nasazeno 27. 9.).
- [x] Partner: Zopakovat → nový čas → Zveřejnit, poslední 3 služby bez nového backendu (nasazeno 27. 9.).
- [x] Money UX: rozlišení blokace/stržení/uvolnění/refundu, historický kód nepřebije storno a vratku (nasazeno 27. 9.).

Podrobný rozpis (co musí udělat člověk, co zvládne AI agent, postup spuštění) je v `docs/PRED_SPUSTENIM.md`.

- [x] Supabase Auth: Site URL `https://www.app-flek.eu` a návratové adresy pro potvrzení účtu a obnovu hesla (13. 9.)
- [ ] Oddělit prostředí: nový produkční Supabase projekt, současný zůstane jako demo/staging s akceptačními testy
- [ ] Produkce na Supabase Pro (zálohy, bez uspávání, ochrana proti prolomeným heslům)
- [ ] Převést Supabase projekt na firemní účet s 2FA a druhým vlastníkem
- [x] Vlastní SMTP přes Resend z `mail.app-flek.eu`, české šablony potvrzení účtu a obnovy hesla (13. 9.; DNS záznamy v Endoře, doména v Resendu ověřená)
- [x] Upozornění na potvrzenou a zrušenou rezervaci pro zákazníka i podnik: v aplikaci, e-mailem a push, nastavitelné (13. 9.)
- [ ] Připomínka před termínem a e-mail o vratce
- [x] Potvrzování rezervací podnikem: hold před Checkoutem, autorizace platby, potvrzení do 10/5/3 minut, stržení až po potvrzení, stavy pro zákazníka i podnik, testy (15. 9.; dokončení verze ChatGPT s 15 opravami)
- [x] Potvrzování pro demo podniky: události ve Stripe, `demo`, akceptace 106/106, průchod se skutečnými testovacími platbami (15. 9.)
- [x] Potvrzování pro všechny (`true`) a úprava dvou textů pro podniky (15. 9.)
- [x] WhatsApp upozornění pro podniky v kódu: párování čísla kódem, šablona s tlačítky Potvrdit / Nemohu přijmout, podepsaný webhook (15. 9.)
- [x] WhatsApp i pro zákazníky, výchozí zapnutý, vypínatelný u každé události, ověření čísla jedním klepnutím, výzvy u podniku a po rezervaci, pět šablon (15. 9.)
- [x] Zakládání pěti šablon u Mety admin funkcí `whatsapp-templates-setup` místo ručního klikání ve WhatsApp Manageru (20. 9.)
- [ ] WhatsApp účet Meta, pět schválených šablon a skutečný test s telefonem
- [x] Víc časů jedné služby na jedné kartě (feed, mapa, podnik, oblíbené) a výběr času na detailu; stejně vysoké karty v náhledu na mapě (15. 9.)
- [x] Karusel „Mohlo by se ti líbit“ na detailu nabídky a lepší obrázek pro službu bez fotky (15. 9.)
- [x] Vyměnit staré obrázky u aktivních demo služeb za knihovnu podle konkrétní aktivity a rozšířit demo provozovny o 24 testovacích služeb (20. 9.)
- [x] Umožnit podniku nahrát vlastní fotografii služby; vlastní fotografie má všude přednost a ilustrační katalog slouží jen jako placeholder (20. 9.)
- [x] Ověřené anonymní recenze po dokončené rezervaci, jediné upozornění v aplikaci/push a souhrn na podniku i detailu (21. 9.)
- [x] Fail-closed fronta pro názvy, popisy, vlastní fotografie a text recenze; privátní upload, admin schválení/zamítnutí s auditem a zásady 1.1 (21. 9.)
- [x] Mapa bez číselných čtvercových shluků; skutečné špendlíky, kompaktní 136px náhled a carousel po jedné službě (21. 9.)
- [ ] Automatická moderace na skutečném bezpečném i závadném obsahu (čeká na vyřešení HTTP 429 v OpenAI projektu)
- [x] Registrace existujícího e-mailu nabídne přihlášení nebo obnovu hesla místo „Poslali jsme odkaz“ (15. 9.)
- [x] Platby přes Stripe Connect: Checkout, poplatek FLEKu jako application fee, výplaty a KYC podniků přes Stripe, ověřený webhook, vratky přes refund API (13. 9., testovací režim)
- [x] Odebrat demo platby (`start_payment` jen Stripe, `demo_confirm_payment` zrušená) (13. 9.)
- [ ] Ostrý Stripe: živé klíče a webhook, `stripe_test_mode=false`, potvrdit odpovědnost platformy v Connect nastavení, vypnout `stripe-test-pay`
- [ ] Poslouchat události Accounts v2 (`v2.core.account[...]`) nebo Connect webhook `account.updated`, ať se stav účtu podniku mění i bez otevření aplikace
- [ ] Skrýt ve feedu FLEKy podniků, kterým Stripe omezil platby; formulář „Výplatní údaje“ sladit se Stripe (číslo účtu už zadává podnik u Stripe)
- [ ] Fakturace servisního poplatku podnikům a účetní export plateb
- [ ] Povinné MFA (TOTP) pro administrátory, CAPTCHA (Turnstile) u registrace, `secure_password_change`, přísnější limity
- [x] Obchodní podmínky pro zákazníky (výjimka z odstoupení u služeb s termínem, storno a nedostavení, reklamace, ADR, nahlášení obsahu podle DSA) a pro podniky (P2B: řazení, poplatky, pozastavení, ukončení, stížnosti, zakázaný obsah); verze 1.0 v aplikaci, zveřejní se s údaji provozovatele (18. 9.)
- [x] Zásady ochrany osobních údajů se zpracovateli a dobami uchování; analytika bez identifikátoru v prohlížeči, takže bez cookie lišty (18. 9.)
- [x] Verze textu u souhlasu podniku i zákazníka zapisuje server; bez souhlasu s platnou verzí platba nezačne a podnik, který s podmínkami ještě nesouhlasil, nezveřejní FLEK (18. 9.)
- [x] Export dat v Profilu (18. 9.)
- [x] Smazání účtu v Profilu (anonymizace i v přihlašování, rezervace a platby zůstanou bez osobních údajů) a denní mazání starých dat `flek-retention` (18. 9.)
- [x] Povinné potvrzení rezervace e-mailem s poskytovatelem, cenou, kódem a stornem, zprávy podnikům o schválení a pozastavení s důvodem, důvod blokace zákazníka, zpráva o vyřízení nahlášení (18. 9.)
- [x] Právní texty porovnané s Too Good To Go, TasteTown, Fresha a Reservio: pravidla obsahu sloučená do podmínek (3 dokumenty místo 4), bez formální lhůty na odvolání, podnik s podmínkami souhlasí jednou a nová verze platí pokračováním ve spolupráci (18. 9.)
- [x] Kontrola kvality právních textů: odstoupení i u kadeřnictví a kosmetiky (výslovná žádost o službu v termínu), tlačítko „Zaplatit“ na platební stránce Stripe, přesné lhůty blokací, u podniků doba neurčitá a komu předáváme data, v zásadách Google a Apple a povinné údaje (18. 9.)
- [x] Přihlášení přes Google a Apple v kódu; jméno z účtu Google se předvyplní (Apple ho ve webovém toku neposílá), tlačítka se ukážou po zapnutí v Supabase (18. 9., prověřeno testem `tests/oauth-profile.sql` a skriptem `npm run check:oauth` 20. 9.)
- [x] Kdo službu poskytuje (název, IČO, adresa) u rezervace a na stránce podniku, IČO ověřené v ARES, schválení podniku jen s IČO (18. 9.)
- [x] Nahlášení nabídky nebo podniku s frontou v administraci, podklad pro oznámení DAC7 (CSV) (18. 9.)
- [ ] **Právní kontrola textů a výchozích řešení před ostrým provozem** (právník, kontrolní seznam v `docs/PRED_SPUSTENIM.md`)
- [ ] Admin nástroj na ruční vratku a storno (se zápisem do audit logu)
- [x] Vratky podle skutečného stavu ve Stripe: vráceno až po potvrzení, selhaná vratka jde člověku (14. 9., P0 z auditu)
- [ ] Přehled a upozornění pro admina na vratky, které Stripe zamítl nebo které 8× selhaly (v kódu 28. 9.: „Platby k řešení“ v administraci a e-mail adminům; čeká na migraci v hostované DB)
- [x] Audit před spuštěním (28. 9.): peníze, oddělení podniků a zákazníků, oprávnění, stavy žádosti, vratky, Edge Functions a scénáře A–J; BLOCKER žádný. Migrace z repozitáře poprvé přehrané na čisté databázi (dvě opravy), zastaralé testy opravené, nový `tests/tenant-isolation.sql`
- [ ] Opravy z auditu 28. 9. v pořadí H1 → M1–M3 → M4 → M6 → M5 → L1–L5 (seznam v `docs/PRED_SPUSTENIM.md`, Část 2)
- [ ] Sentry pro chyby v aplikaci, upozornění při selhání cronu nebo webhooku, jednou vyzkoušené obnovení ze zálohy
- [ ] Mapy a hledání adres: licencovaný poskytovatel nebo vlastní limity (ArcGIS záloha a veřejné Photon API nejsou na komerční provoz)
- [ ] Skutečný e-mail podpory a údaje provozovatele v `private.settings` (Jakub pošle); `VITE_SUPPORT_EMAIL` zůstává jen jako záloha
- [ ] Otestovat na fyzickém iPhonu v Safari včetně skenování QR kamerou
- [ ] Zvážit soukromý repozitář a ochranu větve `main` (povinné zelené CI)

### Fáze C — růst

- [ ] Role v podniku: vlastník → manažer → recepce (recepce jen ověřuje kódy)
- [ ] Nahrávání vlastních fotek podnikem s přepočtem, odstraněním EXIF a limitem rozměrů
- [ ] Google hodnocení s cache, rate limitem a hlídáním rozpočtu (dnes nenasazené)
- [x] Web push upozornění pro podnik i zákazníka (13. 9.)
- [x] Poloha na mapě a hlídač FLEKů v okolí s upozorněním (24. 9.)
- [x] Revize hlídače: noční klid s ranní zprávou, brzda 15 min, sleva ve zprávě, mazání se smazáním účtu, pozvánka z Objevit a Rezervací (24. 9.)
- [x] Úvod pro nové zákazníky a stránka pro podniky podle dnešní aplikace; přeškrtnutá běžná cena všude, kde zákazník vidí cenu (24. 9.)
- [x] Zvonění nové žádosti v partnerské části, dokud ji podnik nevyřídí; oznámení o žádosti zůstane na obrazovce (25. 9.)
- [x] Nová žádost přes celou obrazovku s odpočtem, animací v rytmu zvonění a velkým „Potvrdit“ (25. 9.)
- [x] Nastavení upozornění reaguje hned a uloží se i tam, kde prohlížeč oznámení odmítne (25. 9.)
- [x] Průvodce „Začínáme“ pro nové podniky, přehlednější Provozovna a nápověda „Jak FLEK funguje“ na vyžádání (24. 9.)
- [ ] WhatsApp: vlastní číslo do „To“ (Jakub), schválení šablon u Mety, zpřístupnění a zkouška na telefonu (token, odběr, webhook, profil s logem a číslo hotové 24. 9.)
- [ ] Hlídač: skutečný čas cesty místo odhadu vzdušnou čarou (potřebuje routovací službu)
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
3. Na detailu vidí konečnou cenu včetně poplatku a úsporu proti běžné ceně. Když má služba víc volných časů, vybere si ho přímo v kartě („Vyber si čas“); karty ve feedu a na mapě ukazují další časy téže služby. Pod detailem je karusel „Mohlo by se ti líbit“ s dalšími FLEKy podniku a okolí.
4. Rezervuje a zaplatí kartou, Apple Pay nebo Google Pay na stránce Stripe Checkout (v pilotu testovací karta 4242 4242 4242 4242). Místo obsadí webhook Stripe, zákazník se vrátí na kód rezervace. Bez účtu může prohlížet, k rezervaci se musí přihlásit. Zapomenuté heslo si obnoví odkazem z e-mailu.
   - Rezervaci potvrzuje podnik (od 15. 9.): místo se mu podrží 3 minuty na zaplacení, částka se na kartě jen zablokuje a podnik má na potvrzení 10, 5 nebo 3 minuty podle toho, jak brzy termín začíná. Zákazník vidí odpočet a může žádost zrušit. Po potvrzení se platba strhne a zobrazí se „🔥 FLEK je tvůj!“ s kódem; když podnik nepotvrdí, blokace se uvolní a nic nezaplatí.
5. Dostane rezervační kód a QR, najde je v Rezervacích. O potvrzení a zrušení ví ze zvonku v aplikaci, e-mailem, (když si zapne) oznámením na telefonu a na WhatsApp, jakmile si jedním klepnutím ověří číslo (výchozí zapnuto, vypíná se v Profilu).
6. Zdarma může zrušit do 60 minut před začátkem (podnik si lhůtu může změnit) nebo do 10 minut od rezervace, podle toho, co nastane později.
7. Oblíbené podniky může sledovat a vidí u nich nové FLEKy; může pozvat kamaráda odkazem `/r/kód` a nainstalovat si appku na plochu.
8. Na mapě vidí, kde právě je (modrá tečka), a může si zapnout **hlídač FLEKů** (na mapě, na konci Objevit nebo v prázdných Rezervacích): zvolí místo, dojezd (10–30 min pěšky nebo MHD/kolem) a filtr a FLEK mu dá vědět, když se v okolí objeví nový termín na nejbližší dva dny — nejvýš jednou za 15 minut, v noci ne (co přibude, pošle ráno v 7). Hlídače spravuje v Profilu, kanály upozornění v rozklikávacím řádku „Upozornění“.

### Podnik (`/partner`)

1. Registruje provozovnu, admin ji schválí.
2. Přidá služby z připravených šablon podle kategorie nebo vlastní.
3. Zveřejní FLEK: čas, kapacita a částka, kterou chce dostat. Sleva pro zákazníka musí být aspoň 10 % a cena aspoň 15 % běžné ceny; server hlídá i kolize termínů.
4. Dostane upozornění na novou rezervaci a storno (v aplikaci vždy, e-mail a oznámení na telefon jsou zapnuté samy a dají se změnit v Provozovně). Oznámení chodí jen na zařízení, kde podnik jednou klepnutím povolí zvonění a oznámení (karta „Zapněte zvonění na tomto zařízení“); o vlastním potvrzení nebo odmítnutí zprávu nedostane. U pultu načte QR kód zákazníka (nebo kód opíše) a aplikace hned řekne, jestli rezervace na dnes platí; případně označí „Nedorazil“.
   - Potvrzování (od 15. 9.): nová žádost převezme celou obrazovku (od 25. 9.) s odpočtem („Potvrďte do 04:18“), kartou rezervace a tlačítky Potvrdit rezervaci / Nemohu přijmout, a aplikace zvoní (jako tablet rozvozové služby), dokud žádost nepotvrdí, neodmítne, nevyprší nebo ji neztlumí. „Později“ ji schová do lišty nahoře; na Přehledu a v Rezervacích zůstává i jako karta; oznámení na telefonu u žádosti zůstane na obrazovce do klepnutí. Po ověření WhatsAppu v Provozovně (jedno klepnutí, číslo provozovny je předvyplněné) přijde žádost i tam a jde vyřídit tlačítkem ve zprávě; přijdou tam i zrušení a vypršení.
5. Vidí metriky: rezervace, výplaty a naplněnost.

### Admin (`/admin`)

Schvaluje provozovny (skutečný podnik jen s IČO), kontroluje nabídky a rezervace, spravuje uživatele, vyřizuje nahlášený obsah, vidí metriky pilotu a výnos FLEKu a stahuje podklad pro oznámení DAC7.

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
- Rezervaci potvrzuje nebo odmítá jediná serverová funkce pro aplikaci i WhatsApp; kdo rozhodne první, vyhrál, a po deadlinu žádost vyprší. Kód rezervace se ukáže až po potvrzení a stržení platby.
- Všechny částky jsou v haléřích, čas rozhoduje databázový `now()` v zóně Europe/Prague.

## Kde co běží

| Část | Služba | Poznámka |
| --- | --- | --- |
| Web aplikace | Vercel | automatické nasazení z `main` na GitHubu; nastavení ve `vercel.json`; k projektu nesmí být připojené úložiště z Vercel Marketplace (uspané úložiště shodí nasazení) |
| Databáze, přihlašování, soubory | Supabase (projekt `yupkrntknbkvmlajwlph`) | PostgreSQL + PostGIS, Auth, Storage, zabezpečení RLS |
| Realtime upozornění | Supabase Realtime | záložně se aplikace ptá každých 15 s |
| Pravidelná údržba | Supabase `pg_cron`, job `flek-maintenance` | každých 15 min dokončí rezervace 24 h po konci |
| Potvrzování rezervací | Edge Function `booking-confirmation`, cron `flek-confirmation-expiry` (každých 30 s) | strhne platbu po potvrzení nebo uvolní autorizaci, vrací místa po vypršení; přepínač `manual_confirmation_enabled` v `private.settings` (od 15. 9. `true`) |
| WhatsApp | Meta WhatsApp Cloud API, Edge Functions `whatsapp-webhook` (odesílá `notification-delivery`) a `whatsapp-templates-setup` (admin nebo databáze: stav u Mety, šablony, odběr, webhook, profil a logo), cron `flek-whatsapp-events-cleanup` | backend je hotový, `whatsapp_enabled=false`; token, odběr, webhook, profil a číslo hotové 24. 9., chybí schválení šablon a skutečný test. Do té doby je kanál v UI skrytý |
| Moderace veřejného obsahu | privátní bucket `moderation-pending`, `private.content_moderation`, Edge Function `content-moderation`, OpenAI `omni-moderation-latest` | fail-closed texty a fotografie služeb/podniků a text recenze; admin fronta v Nahlášení. Provider 21. 9. vrací HTTP 429, bezpečný obsah zatím čeká na ruční kontrolu |
| Obnova demo nabídek | `pg_cron`, job `flek-demo-refresh` (každé ráno) | doplní demo FLEKy na 3 dny dopředu, tři termíny na službu a den (od 20. 9.); před ostrým provozem vypnout |
| Mazání staré analytiky | `pg_cron`, job `flek-analytics-retention` (každé ráno) | smaže události starší 180 dní |
| Kontrola kódu | GitHub Actions (`.github/workflows/ci.yml`) | build, unit testy a audit závislostí při každém pushi; secret scanning a Dependabot |
| Bezpečnostní hlavičky | Vercel (`vercel.json`) | CSP s allowlistem domén; nová služba se musí přidat |
| Platby | Stripe Connect (testovací režim, sandbox FLEK) | Checkout, destination charges, účty podniků přes Accounts v2; klíče v Supabase secrets |
| Platební Edge Functions | Supabase: `stripe-checkout`, `stripe-webhook`, `stripe-connect`, `stripe-refunds`, `stripe-test-pay`, `stripe-webhook-setup` (jen admin: doplní události webhooku) | webhook: `https://yupkrntknbkvmlajwlph.supabase.co/functions/v1/stripe-webhook`; funkce z `supabase/config.toml` nasazuje push do `main` (GitHub integrace) |
| Údržba plateb | `pg_cron`, job `flek-stripe-maintenance` (každých 5 min) | vrátí zaplacené platby bez rezervace po 60 min, uzavře opuštěné pokusy, dožene frontu vratek |
| Doména | www.app-flek.eu: DNS v Endoře (freehosting), web na Vercelu | kořenová doména a e-mailové schránky zůstávají u Seznamu |
| E-maily | Resend, odesílací subdoména `mail.app-flek.eu` | SMTP pro Supabase Auth (ověření účtu, obnova hesla) i upozornění na rezervace |
| Upozornění na rezervace | trigger `booking_notification`, fronta `private.notification_delivery`, Edge Function `notification-delivery`, cron `flek-notification-delivery` (každou minutu, jen když je co doručit) | zvonek v aplikaci, e-mail, Web Push (VAPID) |
| Google hodnocení | Supabase Edge Function `google-place-rating` | v kódu hotové, v produkci nenasazené |
| Mapové podklady | OpenFreeMap (styl `bright`) nad OpenStreetMap; záložní dlaždice ArcGIS World Street Map | zdarma, bez klíče |
| Hledání adresy | Photon (komoot) nad OpenStreetMap | výběr místa a adresa provozovny |
| Navigace | odkaz do Google Map | tlačítko Navigovat, bez API klíče |
| Analytika | vlastní tabulka přes RPC `record_event` | vyhledávání, zobrazení, rezervace, oblíbené, sdílení, pozvánky; v prohlížeči nic neukládá (bez cookie lišty) |
| Právní texty | `src/content/pravni/*.md` (podmínky pro zákazníky, pro podniky a zásady), verze v `public.legal_documents`, údaje provozovatele v `private.settings` | zveřejní se až s údaji provozovatele a platnou verzí; souhlasy v `private.legal_acceptances` |
| Mazání starých dat | `pg_cron`, job `flek-retention` (každou noc ve 3:40) | doručování a zprávy WhatsApp po 90 dnech, upozornění po 12 měsících, vyřízená nahlášení po 3 letech, záznamy cronu po 14 dnech |
| Přihlášení přes Google a Apple | Supabase Auth → Sign In / Providers | Google zapnutý 20. 9. (klient v Google Cloud, Redirect URLs `https://www.app-flek.eu/**`), Apple zatím ne. Stav vypíše `npm run check:oauth` |
| Ověření IČO | Edge Function `ares-lookup` nad veřejným API ARES | název a sídlo podniku z registru, bez klíče |
| Fotky služeb | vlastní snímky nejdřív v privátním `moderation-pending`, po schválení ve `covers/{business_id}/moderated`; fallback v `public/images/activities` (74 originálů 1254 px, deriváty 800/176 px) a `service_photos` | podnik nahraje JPG/PNG/WebP do 5 MB; schválená vlastní fotka má všude přednost, dvě ilustrační varianty pro 37 aktivit jsou jen placeholder |
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
| `OPENAI_API_KEY` | Supabase Edge Functions secrets | automatická bezpečnostní kontrola veřejných textů a fotografií; nikdy nepatří do klienta ani repozitáře |
| `RESEND_API_KEY`, `NOTIFICATION_FROM` | Supabase secrets | e-mailová upozornění (odesílatel `FLEK <rezervace@mail.app-flek.eu>`) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Supabase secrets | odesílání Web Push |
| `GOOGLE_MAPS_API_KEY` | Supabase secrets | zatím nenastaveno, pro Google hodnocení |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WABA_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TEMPLATE_LANGUAGE` a šablony `WHATSAPP_TEMPLATE_BOOKING_REQUEST`, `…_BUSINESS_CONFIRMED`, `…_BUSINESS_CANCELLED`, `…_CUSTOMER_CONFIRMED`, `…_CUSTOMER_CANCELLED` | Supabase secrets | zatím nenastaveno, pro WhatsApp podniků i zákazníků |

Service-role klíč nikdy nepatří do aplikace ani do repozitáře. Hesla demo účtů nejsou v repozitáři.

## Obrazovky

| Role | Adresy |
| --- | --- |
| Zákazník | `/` Objevit, `/mapa`, `/nabidka/:id`, `/podnik/:id`, `/oblibene`, `/rezervace`, `/profil`, `/prihlaseni`, `/potvrzeni`, `/r/:kód`; právní texty `/podminky`, `/podminky-podniky`, `/soukromi` |
| Podnik | `/partner`, `/partner/nabidky`, `/partner/rezervace`, `/partner/sluzby`, `/partner/provozovna`, `/partner/metriky`, `/partner/registrace` |
| Admin | `/admin`, `/admin/nabidky`, `/admin/rezervace`, `/admin/uzivatele`, `/admin/metriky`, `/admin/audit`, `/admin/nahlaseni` |

## Pro AI agenty a předávání práce

- Každý agent začíná souborem `AGENTS.md`: mapa kódu, pravidla, postup nasazení a migrací, co nespouštět.
- Zákaznická část tyká, partnerská vyká; zákazníkovi se termínu říká „FLEK“.
- Po každé změně agent zapíše: řádek do historie v `docs/PROJECT_STATUS.md`, úkol a historii sem do `docs/NOTION.md`, a přepíše Notion stránku.
- Nespouštět `npm run db:types`; akceptační testy mění demo data; hesla se nikdy necommitují.
- Nová externí doména musí do CSP ve `vercel.json`; nová admin akce zapisuje `private.audit(...)`; veřejná data jen přes RPC.

## Účty a přístupy

Skutečné účty (admin, podniky Kubova a Tenis kurt) a účty ke službám jsou na soukromé stránce „FLEK — účty a přístupy“ jen v Notionu, protože repozitář je veřejný. Hesla nejsou nikde v Notionu ani v repozitáři.

| Účet | Role | Heslo |
| --- | --- | --- |
| `demo-admin@flek.test` | administrace | `DEMO_ADMIN_PASSWORD` v `.env.local` |
| `demo-customer@flek.test` | zákazník s historií rezervací | `DEMO_PASSWORD` v `.env.local` |
| `demo-merchant@flek.test` | partner, Studio Dobrá hodina | `DEMO_PASSWORD` |
| `demo-merchant2@flek.test` | partner, Studio Nová kapitola | `DEMO_PASSWORD` |
| `demo-5@flek.test` až `demo-12@flek.test` | partneři ostatních demo podniků | `DEMO_PASSWORD` |

Kde účty najdeš: Supabase → Authentication → Users (seznam, poslední přihlášení, poslání obnovy hesla). V databázi `auth.users` (e-maily; heslo je jen jako nevratný hash), `public.profiles` (jméno a telefon), `public.user_roles` (kdo je admin) a `public.business_members` s `public.businesses` (kdo patří ke které provozovně). Zapomenuté heslo se nedá přečíst, jen obnovit.

## Jak s projektem pracovat

| Příkaz | Co dělá |
| --- | --- |
| `npm run dev` | lokální vývoj |
| `npm run build` | kontrola typů a produkční build |
| `npm run test:unit` | unit testy |
| `npm run test:acceptance` | ~100 kontrol proti hostované databázi (mění demo data), sám pozná, jestli demo podnik potvrzuje rezervace |

Podrobnosti: `README.md`, `docs/PROJECT_STATUS.md`, `LIMITATIONS.md`, `VERIFICATION.md`, `DECISIONS.md`.

## Historie změn

| Datum | Změna |
| --- | --- |
| 28. 9. 2026 | Administrace má novou záložku „Platby k řešení“ s počtem v navigaci. Ukazuje vratky, které Stripe zamítl nebo neprovedl, platby bez rezervace, neuvolněné blokace, nedokončené stržení a selhané události ze Stripe, u každé s odkazem do Stripe. O každém novém problému přijde adminům e-mail. Čeká na nasazení migrace. |
| 28. 9. 2026 | Audit před spuštěním: bez zásadní chyby, jedenáct nálezů k opravě s pořadím v `docs/PRED_SPUSTENIM.md`. Migrace z repozitáře jdou nově přehrát na čisté databázi, což nový produkční projekt potřebuje. Zastaralé testy opravené, nový test hlídá, že podnik nevidí data jiného podniku a zákazník jiného zákazníka. |
| 28. 9. 2026 | Swipování nabídek nad mapou už nepřeskakuje tam a zpět: služby jedné provozovny jdou za sebou a mapa se mezi nimi nehýbe, posune se až na další podnik. |
| 28. 9. 2026 | Náhled služby na mapě má stejné průsvitné modré sklo jako karty v Objevit. Po zveřejnění FLEKu se místo zeleného pruhu ukáže karta v barvách partnerské části: „Nabídka je aktivní“, služba a čas a kolik zákazník zaplatí a podnik dostane. |
| 28. 9. 2026 | Zákazník si může lupou vyhledat službu podle názvu (i bez háčků a čárek), v Objevit i na mapě. Filtr „Teď“ se jmenuje „Brzy“ (příští 4 hodiny) a karty nabídek mají průsvitný modrý panel. |
| 28. 9. 2026 | Přístupnost: pole mají viditelný okraj a chybné pole červený, čtečka obrazovky přečte u pole i nápovědu a chybu, fokus z klávesnice je vidět i na tmavých kartách, karta prohlížeče říká, na jaké stránce jsi (a u podniku počet nových žádostí), po přechodu jde fokus na nadpis stránky a aplikace jde otočit na šířku. |
| 28. 9. 2026 | Partnerská část: „Nemohu přijmout“ na kartě žádosti se nejdřív zeptá, jako žádost přes celou obrazovku; aplikace podnikům všude vyká (i v chybách a ve zvonku); neúspěšné načtení Stripe už nevypadá jako nepropojený účet; po návratu ze Stripe se ukáže, co se děje; z Přehledu jdou zveřejnit naposledy použité služby na dvě klepnutí. |
| 28. 9. 2026 | Oblíbené už neslibují upozornění, které neexistuje: řeknou, že nové FLEKy u sledovaných míst najdeš v Oblíbených s tečkou na liště, a nabídnou hlídač, který opravdu upozorní. Štítek „ilustrační foto“ je nově i na mapě a v úvodu. |
| 28. 9. 2026 | Detail nabídky pozná, že vyprodaný FLEK je tvůj („Tohle je tvůj FLEK“ s odkazem na kód) místo „už někdo chytil“, už před klepnutím řekne, že podnik má na potvrzení až 10 minut a do té doby je částka jen zablokovaná, hodnocení ukazuje průměr až od tří recenzí a stejný čas zveřejněný víckrát se ukáže jednou s počtem míst. |
| 28. 9. 2026 | Moje rezervace mluví k zákazníkovi: každá rezervace má jeden stav („Čeká na podnik“, „Podnik nemohl přijmout“, „Zrušeno na tvou žádost“…) a u částky je vždy vidět, co se děje s penězi („Jen zablokováno“, „Zaplaceno“, „Vracíme“, „Blokace uvolněna“, „Nic nestrženo“). Na čekání na podnik jde žádost zrušit až po potvrzení a aplikace řekne, že stránku jde zavřít, protože výsledek přijde e-mailem. Když podnik žádost odmítne nebo nestihne, pod výsledkem se rovnou nabídnou jiné FLEKy. |
| 27. 9. 2026 | Přehled pro podniky ukazuje čísla v jedné kartě místo tří dlaždic s nulami: kolik rezervací je dnes a kolik za ně podnik dostane, kolik nabídek je aktivních a kolik v nich zbývá volných míst (nebo že teď nic nenabízí) a kolik podnik tento měsíc vydělal. Každé číslo vede na stránku, kde jsou podrobnosti. |
| 27. 9. 2026 | Skutečný Checkout test v sandboxu prošel včetně autorizace, potvrzení podnikem, capture, kódu, storna a refundu 402 Kč. Nasazené zjednodušené Discovery a Zopakovat/recent služby, opravené peněžní texty, zachovaný novější vzhled partnera. Build + 226 unit testů a Vercel/CI/Supabase PASS. Druhý test na vlastním účtu ověřil doručený potvrzovací i storno email v Gmailu. Zbývá pouze systémové zobrazení push. |
| 27. 9. 2026 | WhatsApp: Meta schválila všech pět šablon zpráv. Posílat je začne, až bude u WhatsApp účtu platební metoda, vyplněný profil firmy (právní název, země, web) a ověřená firma; do té doby zůstává WhatsApp ve FLEKu vypnutý. |
| 25. 9. 2026 | Partnerská část má nový vzhled v barvách FLEKu. Nabídky jsou diář po dnech (Nadcházející a Ukončené místo tří záložek), každá karta má vlevo čas, barvou a slovem stav (Aktivní, Vyprodáno, Uzavřeno…), výrazně „Vy dostanete“, proužek obsazenosti a dole Zopakovat, Upravit, Zrušit. Přehled ukazuje modrou kartu nejbližší rezervace a kdo ještě dnes přijde. Rezervace začínají kartou „Ověřit rezervaci“ s modrým „Načíst QR kód“ a po načtení hned řeknou, jestli rezervace platí. Služby, Provozovna a Metriky mají hlavičky s ikonami, Metriky modrou kartu s výdělkem. |
| 25. 9. 2026 | Zvonění a oznámení na telefon jsou pro podniky zapnuté samy. Podnik jen jednou klepne na „Povolit zvonění a oznámení“: prohlížeč se zeptá na povolení, zařízení se zaregistruje, jednou zazvoní na zkoušku a displej zůstane rozsvícený. Na iPhonu aplikace poradí přidání na plochu, při zamítnutí řekne, jak povolení vrátit. |
| 25. 9. 2026 | Výběr času v detailu nabídky zůstává v původní podobě (dvě nové podoby se nelíbily); nově se další čas načítá dopředu a karta s vybraným termínem se po přepnutí plynule prolne místo skoku. |
| 25. 9. 2026 | Úvod pro nové zákazníky je jedna obrazovka: balíček nabídek, „Volné FLEKy. Se slevou.“, jedna věta, co FLEK je, tři důvody a tlačítko „Najít svůj FLEK“. |
| 25. 9. 2026 | Potvrzení rezervace má nový vzhled: nahoře světlá karta s kalendářním listem, službou, časem a podnikem, pod ní cena s úsporou, pak tři jasné kroky (zrušení zdarma, blokace platby, potvrzení podnikem) a modré tlačítko s částkou. Lhůta pro zrušení zdarma všude říká i den („do zítřka 17:30“), aby nevypadala jako propásnutá. |
| 25. 9. 2026 | UX/UI audit celé zákaznické části na telefonu, tabletu i počítači: bez chyb v konzoli, rozbitých obrázků a problémů s kontrastem. Opraveno: hlavička na tabletu přetékala, malé odkazy a tlačítka mapy mají 44 px, štítek „ilustrační foto“ je čitelný na každé fotce, detail termínu, který už nejde rezervovat, to řekne hned v kartě a termín, který právě běží, se už nehlásí jako „proběhl“. |
| 25. 9. 2026 | WhatsApp: zjištěno, proč Meta šablony neschvaluje. Účet je blokovaný, dokud nebude vyplněný profil firmy, přidaná platební metoda a ověřená firma; administrace to ukazuje v řádku „Účet u Mety“ a postup je v úkolech pro Jakuba. |
| 25. 9. 2026 | Žádost přes celou obrazovku má nový vzhled: nahoře modrá výzva s logem FLEKu, které „zvoní“, dole jeden bílý panel se vším podstatným a jedním tlačítkem „Potvrdit rezervaci“ (na tabletu a počítači napůl vedle sebe). Běžná cena u nabídek zůstává, jak byla. |
| 25. 9. 2026 | Nová žádost o rezervaci se podniku ukáže přes celou obrazovku v barvách FLEKu, jako na tabletech rozvozových služeb: pulzující špendlík v rytmu zvonění, kruh s odpočtem, karta rezervace a velké „Potvrdit rezervaci“. Po potvrzení krátká animace a další žádost; „Později“ ji schová do lišty. Otestováno na telefonu, tabletu i počítači. |
| 25. 9. 2026 | Náhled služby na mapě má stín, který pod kartou plynule mizí místo ostrého řezu nad spodním menu. |
| 25. 9. 2026 | Karta „Tvůj FLEK“ v Profilu vypadá jako útržek voucheru: velké číslo ušetřené za měsíc, pod perforací počet FLEKů, nejlepší úlovek a součet od začátku (v prvním měsíci skrytý, aby se čísla neopakovala). |
| 25. 9. 2026 | Partnerská aplikace při nové žádosti o rezervaci zvoní, dokud ji podnik nepotvrdí nebo neodmítne (jde ztlumit a vyzkoušet v Provozovně, displej může zůstat rozsvícený). Zaškrtávání upozornění v Profilu a Provozovně reaguje hned a „Zapnout“ zapne i oznámení na telefonu. |
| 24. 9. 2026 | WhatsApp u Mety je skoro hotový: s trvalým tokenem je FLEK přihlášený k odběru zpráv, profil na WhatsAppu má texty a logo FLEKu a číslo je uložené v aplikaci. Webhook je nastavený a Meta ho ověřila. Pět šablon čeká na schválení. |
| 24. 9. 2026 | WhatsApp nejel, protože token Mety v Supabase byl dočasný a po odhlášení z Facebooku přestal platit. Claude teď umí dokončit nastavení u Mety sám z databáze včetně webhooku a loga v profilu; stačí trvalý token systémového uživatele. Panel v administraci jde nově volat i z webu (dřív ho zastavil prohlížeč). |
| 24. 9. 2026 | WhatsApp jde dokončit z administrace: panel ukáže, co chybí, a uloží číslo, přihlásí odběr a nastaví profil FLEKu jedním klepnutím. V Metě zbývá webhook a fotka profilu. |
| 24. 9. 2026 | Nový podnik vede průvodce „Začínáme“: vidí, kolik má hotovo a co udělat teď, a jedním klepnutím se dostane přesně tam. Až je připravený, průvodce zmizí. Provozovna má rozcestník a nápověda je po ruce, když ji podnik chce. |
| 24. 9. 2026 | Nový úvod pro zákazníky ukáže i polohu na mapě a hlídač, stránka pro podniky vysvětlí celý postup od zveřejnění po výplatu. Běžnou přeškrtnutou cenu zákazník vidí u každé ceny, i v náhledu na mapě a ve svých rezervacích. |
| 24. 9. 2026 | Hlídač FLEKů v noci mlčí a ráno pošle jednu zprávu, ozve se nejdřív po čtvrt hodině a řekne i slevu; smazáním účtu zmizí i hlídače. Oddálená mapa ukazuje firemní špendlíky místo teček, Upozornění v Profilu se rozkliknou až na klepnutí a prázdné Rezervace nabídnou volné FLEKy v okolí a hlídač. |
| 24. 9. 2026 | Mapa ukazuje, kde právě jsi, a hlídač FLEKů ti dá vědět, když se do 10–30 minut cesty uvolní nový FLEK podle tvého filtru. |
| 23. 9. 2026 | Detail služby na telefonu má kratší fotografii, přehlednější termín, cenu a výběr dalších časů, ultramarínovou akci a mapu otevřenou až po klepnutí. Všech 37 katalogových aktivit má dvě varianty: skutečné ověřené fotografie, případně neutrální FLEK. Generované soubory byly odstraněny a demo katalog aktualizovaly dvě cílené migrace. |
| 22. 9. 2026 | Podnik může nahrát fotku provozovny přímo v Provozovně; zákazník ji vidí nahoře na stránce podniku. |
| 22. 9. 2026 | Mapa ukazuje všechny podniky i při oddáleném pohledu: server posílá mapě celou odpověď (dřív 50 řádků z jednoho konce města) a když špendlíky nemají kam, překreslí se všechny jako body. |
| 22. 9. 2026 | Mobilní detail nabídky má jeden přehledný souhrn vybraného FLEKu; pod ním se nejdřív volí den a potom jiný čas v kompaktní dvousloupcové mřížce. Vybraný termín se v seznamu neopakuje a spodní lišta obsahuje jen cenu a hlavní akci. |
| 22. 9. 2026 | Karty v Objevování mají zpátky skutečné sklo — fotka pod panelem prosvítá; hláška o rozšířeném hledání, karta „Tvůj FLEK“ v profilu a patička „O FLEKu“ jsou přestavěné do firemních barev a drží pohromadě. |
| 21. 9. 2026 | Osm nejvytíženějších oborů má skutečné fotografie místo generovaných a databáze prošla auditem výkonu (indexy a pravidla přístupu). |
| 21. 9. 2026 | *(nahrazeno 22. 9.)* Městský pohled mapy ukazuje všechny provozovny jako malé kruhové FLEK body; po přiblížení se rozbalí na plné špendlíky s oborem a cenou a vybraný bod se rozbalí vždy. Mapa využije plný bezpečný limit 100 výsledků a hláška o rozšířeném hledání má kompaktní ultramarínový štítek. |
| 21. 9. 2026 | Karty v Objevování dostaly jemně ultramarínový skleněný panel: cena je v hlavní barvě FLEKu, ikony a další časy používají brandový odstín a původní cena už není červená. |
| 21. 9. 2026 | Mapa ukazuje skutečné FLEK špendlíky místo číselných shluků; mobilní náhled má 136 px a carousel se posouvá po jedné službě. Přibyly ověřené anonymní recenze, upozornění po dokončení, privátní fail-closed moderace textů a fotografií, admin fronta s auditem, RLS na citlivých privátních tabulkách a bezpečný příznak dostupnosti WhatsAppu. Databáze i funkce jsou nasazené; OpenAI moderace zatím vrací HTTP 429 a WhatsApp čeká na dokončení Meta. |
| 21. 9. 2026 | Detail nabídky na mobilu: odznak slevy a „Začíná za…“ na fotce, den termínu v barvě značky, cena a úspora nad seznamem časů, hodina vlevo a cena vpravo u každého času, bloky pod kartou jako karty s barevnou ikonou |
| 20. 9. 2026 | Podnik může u služby nahrát vlastní fotografii; ta má před ilustračním katalogem přednost na kartách, mapě, detailu i v partnerské části a nenese označení „ilustrační foto“. |
| 20. 9. 2026 | Zásady ochrany osobních údajů jsou v aplikaci zveřejněné na Jakuba jako fyzickou osobu; obchodní podmínky čekají na IČO. |
| 20. 9. 2026 | Karty a navigace dostaly matné sklo (fotka a mapa pod nimi prosvítají) a e-maily konečně nesou skutečné logo FLEK místo textu „flek′“. |
| 20. 9. 2026 | Administrace ukazuje u provozovny seznam ke kontrole (IČO a ARES, podmínky, kontakt, adresa, služby, Stripe), počet čekajících a filtr; podnik bez IČO nejde schválit a je vidět proč. |
| 20. 9. 2026 | Registrace provozovny dá vědět majiteli i adminovi (dřív se o nové provozovně nedozvěděl nikdo a ležela v administraci). Ověřeno, že e-maily z aplikace odcházejí — demo účty je schválně nedostávají. |
| 20. 9. 2026 | Fotky demo služeb a obálek srovnané s katalogem v kódu (padel, tenis, sauna, masáže) a víc demo FLEKů: tři termíny na službu a den místo jednoho, takže v aplikaci je co rezervovat i odpoledne. |
| 20. 9. 2026 | Mapa: špendlík ukazuje ikonu oboru (nůžky, ruka, jiskry, činka, květ, vlny) místo fotky služby, neznámá kategorie značku FLEK. Detail nabídky: časy téže služby jsou karty s cenou, slevou, délkou a posledním místem místo pilulek; rezervuje se jedním tlačítkem u vybraného času, nad pět časů se zbytek schová. Přihlášení přes Google a Apple prověřené do posledního kroku (nový test profilu, skript `npm run check:oauth`, opravený postup s Redirect URLs); zapnout ho může jen Jakub. |
| 20. 9. 2026 | Aktivní demo služby napojené na novou fotografickou knihovnu, opravené půjčení kola a 24 dalších testovacích služeb napříč všemi aktivitami; v produkci je 60 aktivních služeb bez chybějícího nebo starého obrázku a 128 budoucích FLEKů, skutečné fotografie podniků ve Storage se nepřepisují |
| 20. 9. 2026 | Dokončená knihovna 74 originálních fotek: dvě varianty pro všech 37 aktivit, připravené pro ořez 4:5, 1:1 i 2:1 a napojené s 800px a 176px verzemi pro mobil a mapu |
| 20. 9. 2026 | Nová úvodní stránka v duchu aplikace move+: fotka je celá karta, fakta na matném panelu přes její spodní okraj, na fotce jen čas a sleva; „Začíná brzy“ se listuje do strany a nadpis je dvouřádkový. Promo bloky pro nepřihlášené mají jednu výšku. |
| 18. 9. 2026 | Kontrola kvality právních textů (odstoupení u kadeřnictví a kosmetiky, tlačítko „Zaplatit“ u Stripe, přesné lhůty, doplněné podmínky pro podniky a zásady); uspaná databáze odpojená od projektu ve Vercelu a web znovu nasazený; u Meta odsouhlasené podmínky WhatsAppu a založené testovací číslo, šablony zatím ne (WhatsApp Manager v Chromu zamrzá) |
| 18. 9. 2026 | Povinné potvrzení rezervace e-mailem, zprávy podnikům a zákazníkům s důvodem, smazání účtu v Profilu a noční mazání starých dat; přihlášení přes Google a Apple (čeká na klíče); právní texty porovnané s Too Good To Go, TasteTown, Fresha a Reservio a zjednodušené; web čeká na odpojení uspané databáze ve Vercelu |
| 18. 9. 2026 | Právní minimum: obchodní podmínky pro zákazníky a pro podniky, zásady ochrany osobních údajů a pravidla obsahu (verze 1.0, zveřejní se s údaji provozovatele, pak je zkontroluje právník), souhlas s verzí při platbě i u podniku, kdo službu poskytuje, ověření IČO v ARES, nahlášení obsahu, export dat, podklad DAC7, analytika bez ukládání do prohlížeče, texty v režimu potvrzování |
| 15. 9. 2026 | Potvrzování rezervací zapnuté pro všechny podniky (15:54) a texty pro podniky upravené; Kubova je se Stripe propojená od 14. 9. |
| 15. 9. 2026 | Potvrzování rezervací zapnuté pro demo podniky: události ve Stripe doplněné admin funkcí, akceptace 106/106 v režimu potvrzování, průchod se skutečnými testovacími platbami (potvrzení i odmítnutí); pro všechny čeká na souhlas; neuložené kopie Codexu uklizené do zálohy |
| 15. 9. 2026 | Víc časů jedné služby na jedné kartě a výběr času na detailu, stejně vysoké karty v náhledu na mapě, karusel „Mohlo by se ti líbit“, fotka kategorie a nový obrázek pro službu bez fotky; WhatsApp i pro zákazníky, výchozí zapnutý a vypínatelný v nastavení, ověření čísla jedním klepnutím; nasazené platební funkce, potvrzování čeká na události ve Stripe |
| 15. 9. 2026 | Potvrzování rezervací podnikem dokončené po ChatGPT (zatím vypnuté): místo se drží před platbou, peníze se strhnou až po potvrzení, podnik má 10/5/3 minuty, žádosti nahoře v partnerské části s bannerem a zvukem, zákazník vidí odpočet a „🔥 FLEK je tvůj!“; WhatsApp upozornění připravená na účet Meta; registrace existujícího e-mailu nabídne přihlášení; wellness fotka opravená i v databázi |
| 14. 9. 2026 | Mapa: zpátky plný náhled s fotkou, slevou, původní cenou, vzdáleností a tlačítky Navigovat a Detail; vybraný špendlík zůstane nad kartou |
| 14. 9. 2026 | Opravy mapy a detailu: značky na mapě se už nepřekrývají, po klepnutí na špendlík dole se mapa posune nad náhled, lišta časů nad mapou nekončí průhlednou pilulkou a u tlačítka Chytit FLEK nevisí tečka |
| 14. 9. 2026 | Nová paleta „Noční ultramarín“: tmavý ultramarín, noční modročerná a chladné světlé pozadí v aplikaci, logu, ikonách, mapě a e-mailech |
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
