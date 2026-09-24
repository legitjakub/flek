# Omezení pilotu

Aktualizováno 15. 9. 2026. Aktuální implementaci shrnuje [přehled projektu](docs/PROJECT_STATUS.md); důkazy ověření jsou v [VERIFICATION.md](VERIFICATION.md).

## Platby a výplaty

Platby jdou jen přes Stripe Connect (Checkout, destination charge, poplatek FLEKu jako application fee), zatím v **testovacím režimu** Stripe: platí se testovací kartou 4242 4242 4242 4242 a žádné peníze se nestrhnou. Demo platby (`demo_confirm_payment`) jsou odstraněné; starší platby s `provider=demo` zůstaly jen kvůli historii.

- Demo podniky mají testovací účty Stripe bez dashboardu (Accounts v2, testovací údaje a IBAN). Příjem plateb je aktivní, výplaty (`payouts`) Stripe k 13. 9. ještě neaktivoval.
- Stav účtu podniku se obnovuje při návratu z onboardingu, otevřením sekce „Platby a výplaty“ a přes `account.updated`. Tuto událost ale posílá jen Connect webhook. Události Accounts v2 (`v2.core.account…`) zatím nikdo neposlouchá.
- FLEKy podniku, kterému Stripe později platby omezí, se ve feedu dál zobrazují. Rezervace ale skončí hláškou `PAYMENTS_NOT_READY`.
- Ostrý režim vyžaduje živé klíče, nový webhook, `stripe_test_mode=false` v `private.settings`, potvrzenou odpovědnost platformy za ztráty v nastavení Connect a vypnutí `stripe-test-pay`. Účetní doklady a fakturace poplatků chybí.
- Formulář „Výplatní a fakturační údaje“ v provozovně se stále ptá na číslo účtu, přestože výplaty už posílá Stripe na účet zadaný v jeho onboardingu.
- Vratku, kterou Stripe zamítne nebo zruší, musí vyřešit člověk: v aplikaci pro to není obrazovka ani upozornění, zapíše se jen událost `refund_failed` do analytiky. Takové platby najde dotaz `select * from payments where provider = 'stripe' and status = 'paid' and refund_status in ('failed', 'canceled')`. Totéž platí pro platby, u kterých se 8× nepodařilo se Stripe spojit (`refund_attempts >= 8`). Novou vratku lze vytvořit v Stripe Dashboardu; webhook ji zapíše sám.
- Akceptační kontroly zakládají na demo účtu `demo-admin@flek.test` platbu na testovací kartě `pm_card_refundFail`, jejíž vratka schválně selže. V demo datech proto zůstávají zaplacené platby se selhanou vratkou; nejsou to skutečné peníze.

## Testy a zařízení

Jednotkové testy běží v CI při každém pushi a 100 API akceptačních kontrol prošlo (naposledy 13. 9. 2026 po zamknutí tabulek). Databázový test údržby, časových hranic a neměnnosti cen prošel v transakci s rollbackem. Lokální sada `npm test` vyžaduje běžící Docker/Supabase; lokální backend nyní neběží. Docker CLI je dostupné, dřívější tvrzení, že na počítači vůbec není Docker, už neplatí.

Mobilní rozměry systémového Chrome ověřují responzivní rozhraní, nenahrazují fyzický iPhone/Safari a test skeneru kamerou. Aktuální průchod a jeho limity uvádí poslední sekce VERIFICATION.md. Kompletní nový audit všech rolí, barev a konkurence je samostatný odložený úkol.

## Typy a historie migrací

`src/types/database.ts` obsahuje aplikační typy spravované ručně. Výstup generátoru Supabase má jinou strukturu; starý skript `db:types` by bez navazující migrace importů aplikaci rozbil. Není součástí postupu pro běžné spuštění.

Názvy migrací v repozitáři jsou sladěné s hostovanou historií (13. 9. 2026). Migrace aplikovaná přes MCP dostane verzi podle času aplikace; soubor je pak potřeba přejmenovat na tuto verzi, jinak by ji `supabase db push` spustil podruhé.

## Demo data a účty

Demo nabídky obnovuje každý den job `flek-demo-refresh` (3 dny dopředu, jen podniky, jejichž všichni členové mají e-mail `@flek.test`). Před ostrým pilotem na stejné databázi ho vypněte: `select cron.unschedule('flek-demo-refresh');`.

Veřejná ukázka obsahuje fiktivní podniky a účty `demo-*@flek.test`. Hesla jsou mimo repozitář, administrátor má vlastní heslo. Skutečný pilot musí oddělit reálná data od ukázkového seedu. Akceptační skript je určen demo prostředí: založené nabídky ruší, ale zanechá zrušenou historii rezervací a plateb. Neběží proti skutečným zákaznickým účtům.

Supabase advisor nadále hlásí vypnutou ochranu proti prolomeným heslům; na Free tarifu ji zapnout nejde. Projekt běží na Free tarifu bez stahovatelných záloh a výchozí e-mail Supabase je určený pro testování — pro skutečné zákazníky je potřeba vlastní SMTP. Administrátoři zatím nemají povinné MFA. Oprávnění RPC, finanční a kapacitní změny se ověřují na serveru. Zpráva advisoru o endpointu `security definer` sama neznamená chybu: tyto RPC tvoří úmyslné rozhraní pro autorizované operace.

## Fotografie a Google hodnocení

Původní lokální generované fotografie byly 23. 9. odstraněny. Katalog nyní používá skutečné fotografie z Unsplashe; jejich zdroje, autoři a licence jsou v `docs/assets/activity-photo-sources.json`. U pěti variant, kde vhodný snímek nebyl, se ukazuje neutrální FLEK placeholder. Stock snímek není fotografií konkrétní provozovny a načítá se z externí CDN; při výpadku jej nahradí placeholder. Vybraná fotografie podniku má přednost před katalogem. Vlastní fotografii služby lze nahrát přímo v partnerském editoru (do 5 MB, přes privátní kbelík `moderation-pending` a frontu kontroly); zveřejní se teprve po schválení, takže bez funkční automatické nebo ruční moderace zůstane čekat.

Google hodnocení se zobrazí jen pro správně přiřazené Place ID a funkční serverové Places API s billingem. Chybějící odpověď se nenahrazuje fiktivními hvězdičkami. Aktuální test rezervací neověřuje billing ani konfiguraci Google Cloud.

## Upozornění a obsluha podniku

Upozornění podniku v otevřené aplikaci funguje přes Realtime s 15sekundovým pollingem; zvuk závisí na povolení přehrávání prohlížečem. Potvrzená a zrušená rezervace navíc vytvoří upozornění v aplikaci (zvonek) pro zákazníka i členy podniku a podle nastavení e-mail a Web Push.

- E-mail a push odcházejí přes Edge Function `notification-delivery`. Potřebuje v Supabase secrets `RESEND_API_KEY`, `NOTIFICATION_FROM`, `VAPID_PUBLIC_KEY` a `VAPID_PRIVATE_KEY` a ověřenou doménu `mail.app-flek.eu` v Resendu (ověřená 13. 9.). Dokud chybí, zprávy čekají ve frontě a po doplnění odejdou i se zpožděním. Od 13. 9. jsou všechny klíče nastavené; push ještě nikdo nevyzkoušel na skutečném telefonu.
- Push na iPhonu funguje jen v aplikaci přidané na plochu (iOS 16.4+). Text oznámení záměrně neobsahuje detaily rezervace.
- Účty `@flek.test` e-maily nedostávají. SMS, připomínka před termínem ani e-mail o vratce nejsou.
- Zákaznické sledování podniku znamená nové nabídky v Oblíbených a odznak navigace, ne push oznámení.

Více provozoven na účet je podporováno přepínačem v partnerské části. Pozvánky personálu a detailnější týmová oprávnění zůstávají mimo tento pilot. Schválení provozovny se oznámí v aplikaci; potvrzovací e-maily registrace účtu zajišťuje Supabase Auth.

## Další vědomé hranice

- Mapový JavaScript je velký; Vite hlásí upozornění na chunk nad 500 kB. Nové měření Lighthouse zatím neproběhlo.
- Doporučení měří atribuci a dokončenou první rezervaci; nevytváří utratitelný kredit.
- Předplatné, chat, dynamická cenotvorba, účetnictví, integrace na externí rezervační systémy a automatické výplaty nejsou součástí V1.

## Potvrzování rezervací a WhatsApp (15. 9. 2026)

- Potvrzování podnikem je od 15. 9. 15:54 zapnuté **pro všechny podniky** (`manual_confirmation_enabled = 'true'`). Podnik bez zapnutých upozornění (e-mail, push, WhatsApp) se o žádosti dozví jen v otevřené aplikaci; když ji do 10/5/3 minut nepotvrdí, žádost vyprší a zákazník nic nezaplatí.
- Průchod se skutečnou platbou prošel jen s testovací kartou zadanou na serveru (`stripe-test-pay`), ne přes formulář Stripe Checkout, Apple Pay ani Google Pay.
- Po sondě zůstala ve Stripe (testovací režim) autorizovaná, nestržená platba 390 Kč zákazníka `demo-6`: bez události FLEK nezná její PaymentIntent, takže ji úklidový job zrušit nemohl. Stripe nestrženou autorizaci sám zruší do 7 dnů; platba `0d10cb4d…` v databázi zůstane ve stavu `release_pending`, dokud nepřijde `payment_intent.canceled`.
- Opuštěný Checkout drží místo až 3 minuty. Platba dokončená po uplynutí holdu se nerezervuje, autorizace se uvolní a zákazník uvidí „Čas na zaplacení vypršel“.
- Uvolnění blokace na kartě trvá podle banky; u Apple Pay a Google Pay se může blokace ve výpisu tvářit jako platba. Na skutečném telefonu to zatím nikdo nevyzkoušel.
- Termín, který začíná dřív než za 15 minut, v režimu potvrzování rezervovat nejde. Při `demo` to hlídá jen `start_payment`, takže demo podnik takový FLEK chvíli ukazuje jako volný a rezervace skončí hláškou „Tento termín už bohužel není volný“.
- Lhůta zrušení se u potvrzených žádostí počítá od potvrzení. Nápověda v Provozovně („10 minut od zaplacení“) a text na stránce pro podniky se upraví při zapnutí pro všechny.
- Vypršení okna podniku a pozdní capture ověřuje jen `tests/manual-confirmation.sql` (posunutím deadlinu), akceptační běh je kvůli délce okna nečeká.
- WhatsApp potřebuje účet Meta (pro pilot testovací číslo, ostré číslo s ověřením firmy), pět schválených utility šablon a secrets; od 18. 9. je u Meta aplikace FLEK s odsouhlasenými podmínkami a testovacím číslem, šablony, webhook a secrets chybí (`docs/PRED_SPUSTENIM.md`). Šablony už nikdo neklikne ručně: po vložení tokenu je u Mety založí admin funkce `whatsapp-templates-setup`, schválení ale trvá a řídí si ho Meta. Bez nich se nic neposílá, zákazník WhatsApp nevidí a v Provozovně je jen informace, že upozornění nejsou aktivní. Skutečné doručení, ověření jedním klepnutím na iPhonu a Androidu ani klepnutí na tlačítko zatím neproběhlo (**IMPLEMENTOVÁNO, ALE VYŽADUJE RUČNÍ EXTERNÍ OVĚŘENÍ**). V prohlížeči je ověřený celý tok s podvrženou zprávou z WhatsAppu přímo v databázi.
- Testovací číslo Meta pošle zprávy jen na nejvýš 5 čísel přidaných v nastavení aplikace; ostatní podniky a zákazníci je nedostanou, dokud FLEK nemá ostré číslo.
- Ověření jedním klepnutím uloží kód ve stejném klepnutí, kdy se otevírá WhatsApp. Když síť kód uloží až po odeslání zprávy, párování selže a WhatsApp odpoví, že kód nesedí; stačí „Otevřít WhatsApp znovu“ a zprávu poslat ještě jednou.
- Zprávy na WhatsApp provozovny se řídí nastavením upozornění člena, který číslo ověřil; ostatní členové ho mění jen pro sebe.
- WhatsApp nechodí o vlastní akci (podnik o svém potvrzení, odmítnutí nebo zrušení, zákazník o svém zrušení); ukáže se v aplikaci a e-mailem.
- Když Meta přijme zprávu, ale odpověď se ztratí, worker ji pošle znovu s novým tokenem; tlačítko první zprávy pak odpoví, že zprávu už nejde použít. Rozhodnout jde z druhé zprávy nebo z aplikace.
- Rozhodnutí z WhatsAppu se v auditu připíše členovi, který číslo propojil, ne konkrétní osobě u telefonu.

## Časy, doporučení a obrázky (15. 9. 2026)

- Karta ve feedu a na mapě ukáže jen časy, které vrátilo aktuální hledání: s filtrem „Dnes“ nebo „Do 2 h“ chybí časy z dalších dnů. Výběr času na detailu bere všechny volné časy služby u podniku.
- Seskupuje se podle služby, takže dvě služby se stejným názvem a jinou délkou (třeba masáž 30 a 60 minut) jsou dvě karty a na detailu si mezi nimi vybrat nejde.
- „Mohlo by se ti líbit“ není personalizované: jiné služby podniku, stejná kategorie do 5 km od uložené polohy (jinak od podniku), pak cokoli v okolí.
- Katalogové snímky jsou pouze placeholder. U připravených aktivit jsou dvě varianty, neznámá vlastní služba spadne na univerzální abstraktní FLEK; vlastní schválená fotografie podniku má vždy přednost.

## Právní minimum (18. 9. 2026)

- Od 20. 9. jsou zveřejněné **jen zásady ochrany osobních údajů** (na Jakuba jako fyzickou osobu). Obchodní podmínky pro zákazníky i pro podniky zůstávají schované, dokud nebude IČO; do té doby aplikace nemá souhlas s platnou verzí podmínek v rezervaci a podnik souhlasí s „obchodními podmínkami FLEKu“ bez odkazu jako dřív.
- Texty napsal agent, ne právník (**IMPLEMENTOVÁNO, ALE VYŽADUJE RUČNÍ EXTERNÍ OVĚŘENÍ** právníkem před ostrým provozem). Řádek o zápisu provozovatele říká „podnikatel zapsaný v živnostenském rejstříku“; u s.r.o. se musí změnit.
- Skutečný e-mail s podrobnostmi smlouvy zatím neodešel: demo účty e-maily nedostávají a jiná rezervace od nasazení nebyla.
- Podnik, který se registroval před 18. 9., nemá typ podnikatele, datum narození ani ověření v ARES; doplní je ve fakturačních údajích. DAC7 podklad je jen podklad pro ruční oznámení, registraci provozovatele neřeší.
- `ares-lookup` čte veřejné API ARES bez klíče a bez smlouvy; při výpadku ARES podnik vyplní údaje ručně a admin je ověří sám.
- Nová verze podmínek pro podniky platí pokračováním ve spolupráci. Aplikace ukáže banner, ale e-mail o nové verzi 15 dní předem se neposílá sám; při vydání nové verze ho musí poslat člověk.
- Smazaný účet zůstává v `auth.users` s adresou `smazany-…@smazany.invalid` a blokací, aby rezervace a platby měly na koho ukazovat. Člen podniku a admin smazání v aplikaci nemají.

## Přihlášení přes Google a Apple (18. 9. 2026, ověřeno 20. 9.)

- Google je v produkci zapnutý od 20. 9. (ověřeno na `/auth/v1/settings`), ale projekt v Google Cloud je zatím v režimu **Testing**: přihlásí se jen účty ručně přidané do test users, přihlášení vyprší po 7 dnech a je limit 100 účtů. „In production“ jde zapnout až po vyplnění celé stránky Branding, která chce odkazy na zásady a podmínky — ty se zveřejní s údaji provozovatele. Apple zůstává vypnutý, dokud nebude placené členství.
- **Apple ve webovém toku jméno neposílá vůbec.** Dokumentace Supabase to říká výslovně: celé jméno dává Apple jen nativnímu SDK a Sign in with Apple JS, ne OAuth toku, který FLEK používá. Účet z Apple tedy vznikne bez jména a o jméno si řekne rezervační formulář před první rezervací (stejně jako o telefon). Dřív tu stálo, že Apple pošle jméno při prvním přihlášení; to platí jen pro nativní aplikace.
- Apple často pošle jen skrytý e-mail (`…@privaterelay.appleid.com`). Bez registrace odesílací domény `mail.app-flek.eu` v Sign in with Apple for Email Communication tam e-maily nedojdou, ani povinné potvrzení rezervace. Tajný klíč Apple platí nejvýš 6 měsíců.
- Návrat z Google nebo Apple míří na `/prihlaseni?oauth=…&returnTo=…`, tedy s dotazem v adrese. Supabase porovnává celou adresu včetně dotazu a oddělovače jsou jen `.` a `/`, takže samotné `https://www.app-flek.eu/prihlaseni` v Redirect URLs nestačí — patří tam `https://www.app-flek.eu/**`. Bez toho přihlášení skončí na úvodní stránce a původní cíl (třeba rozkliknutá nabídka) se ztratí. Stav obojího vypíše `npm run check:oauth`.
- Účet z Google má jméno z Googlu (první slovo jako jméno, zbytek jako příjmení); telefon si vyžádá první rezervace.
- Google Auth Platform → Branding chce odkaz na zásady ochrany osobních údajů. Než budou v databázi údaje provozovatele, `/soukromi` ukazuje jen „Tento dokument právě připravujeme“, takže Branding má smysl vyplňovat až po nich.

## Ikony a časy (20. 9. 2026)

- Špendlík na mapě kreslí ikonu oboru pro šest kategorií z `public.categories`. Sedmá kategorie dostane obecnou značku FLEK, dokud jí v `src/lib/categoryGlyphs.ts` nepřibude tvar; fotka služby už ve špendlíku není (zůstala v náhledové kartě a v seznamu).
- Karty s časy na detailu nabídky nesou vlastní tlačítko jen u vybraného času. Rezervovat jiný čas jsou tedy dvě klepnutí (vybrat, pak rezervovat), aby na mobilu zůstala jediná spodní lišta s výzvou.

## Nasazení webu (18. 9. 2026)

- K projektu flek ve Vercelu nesmí být připojené úložiště z Vercel Marketplace. Uspané úložiště (18. 9. `supabase-cerulean-village`) shodí každé nasazení na kroku „Provisioning Integrations“; vyřešené odpojením s Jakubovým souhlasem, web se od té doby nasazuje zase sám.

## Schvalování provozoven (20. 9. 2026)

- Provozovnu, která není demo a nemá v `business_billing` vyplněné IČO, nejde schválit — server vrátí `PROVIDER_DETAILS_REQUIRED`. Je to záměr z 18. 9.: zákazník musí vidět, kdo mu službu poskytuje. Podnik IČO doplní v Provozovně ve fakturačních údajích (ověří se proti ARES), teprve pak ho admin schválí.

## Sklo a e-maily (20. 9. 2026)

- Sklo (`.glass`) je průhledné na 86 %, což je strop daný čitelností textu nad tmavou fotkou. Víc průhlednosti by shodilo malý text pod WCAG AA.
- Logo v e-mailech je obrázek na `https://www.app-flek.eu/images/email-logo.png`. Klient, který blokuje obrázky, ukáže jen alt „FLEK“ — text e-mailu tím netrpí, ale hlavička je pak prázdná.
- Šablony ověřovacích e-mailů (`supabase/templates/*.html`) jsou v repozitáři jen jako zdroj pravdy; Supabase Auth je čte ze svého nastavení. Změna v repozitáři se na odesílané e-maily projeví, až je člověk vloží v Supabase → Authentication → Emails.

## Recenze, moderace a WhatsApp dostupnost (21. 9. 2026)

- Veřejné recenze jsou záměrně anonymní. Podnik ani návštěvník neuvidí jméno autora; při řešení sporu má vazbu na rezervaci jen server a administrace.
- Automatická moderace je fail-closed. Pokud OpenAI odpoví chybou, nový text ani fotografie se nezveřejní a poslední schválená verze zůstane vidět. To může bezpečný obsah dočasně zpozdit.
- Skutečný požadavek z nasazené funkce `content-moderation` skončil 21. 9. odpovědí HTTP 429. Kód, fronta, opakování a ruční admin kontrola fungují; automatické schvalování začne až po vyřešení limitu nebo aktivace projektu OpenAI.
- Moderace snižuje riziko explicitního a jinak závadného obsahu, ale negarantuje bezchybné rozhodnutí. Hraniční obsah musí posoudit člověk; falešně zamítnutý obsah lze znovu přezkoumat.
- Hvězdičkové hodnocení se započítá ihned, protože je svázané s ověřenou dokončenou návštěvou. Text se ukáže teprve po schválení; zamítnutí textu hvězdičky nemaže.
- WhatsApp je v UI skrytý, dokud serverový příznak a zobrazované číslo nepotvrdí, že je kanál skutečně připravený. Kód a SQL testy jsou hotové, ale bez plných Meta secrets, webhooku, schválených šablon a úspěšné testovací zprávy není produkčně aktivní.

## Mapa a rozsah hledání (22. 9. 2026)

- Mapa dostává stejnou odpověď jako feed, jen s vyšším stropem (300 řádků místo 50). Při pilotním objemu (315 rezervovatelných FLEKů u 17 podniků) na ně dosáhne každé řazení, ale je to strop, ne řešení: až bude nabídek řádově víc, bude mapa potřebovat vlastní čtecí RPC, které vrátí jeden řádek na adresu, ne všechny termíny. Strop RPC `search_offers` je proto 300 a výš by se neměl zvedat bez té funkce.
- Body se při hustém pohledu rozmisťují kolem své skutečné polohy nejvýš o 88 px. V extrémně husté skupině (desítky podniků v jednom bloku) se proto i body překryjí; žádný z nich ale nezmizí a všechny zůstávají dosažitelné klávesnicí. Dál od skutečné polohy se špendlík posouvat nebude — vypadal by, že patří do jiné čtvrti.
- Přepnutí mezi špendlíky a body se rozhoduje ze vzdáleností na obrazovce, takže posun mapou jím nehne; mění se jen při přiblížení. Při oddáleném pohledu není na mapě vidět cena — ta se vrátí po přiblížení nebo klepnutím na vybraný bod.

## Poloha a hlídač FLEKů (24. 9. 2026)

- Dojezd je odhad vzdušnou čarou (pěšky 75 m za minutu, MHD nebo kolo 200 m za minutu), ne trasa: řeka, kopec nebo přestup ho prodlouží. Skutečný čas cesty by potřeboval routovací službu s klíčem a novou doménou v CSP.
- Prohlížeč na pozadí polohu nesleduje. Hlídač „kde právě jsem“ se posune, jen když zákazník otevře mapu (a pohne se o víc než 300 m); jinak hlídá místo, kde byl naposledy.
- Upozornění na telefon potřebuje zapnutá oznámení v tomto prohlížeči (na iPhonu jen v aplikaci přidané na plochu). Bez nich hlídač zapisuje jen do zvonku v aplikaci.
- Hlídá se jen to, co přibude po založení nebo přesunu hlídače, a jen termíny do 48 hodin. FLEK, který se uvolní zrušením rezervace, se neohlásí znovu, pokud ho hlídač už jednou ohlásil.
- Hlídač chodí e-mailem jen po zapnutí v Profilu; WhatsAppem nechodí vůbec (Meta by šablonu nabídek posuzovala jako marketing).
- Skenování běží každých 5 minut v databázi (`flek-watch-scan`). Při tisících hlídačů by potřebovalo index nebo dávkování podle oblasti.
