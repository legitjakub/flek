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

Lokální ilustrační fotografie existují v `public/images/services` a mají rozlišení podle aktivity; dřívější tvrzení, že sport nemá fotky, už neplatí. Katalog wellness používá neutrální spa snímek místo dřívější resortové fotografie. Některá ukázková data stále odkazují na Unsplash. Vybraná fotografie podniku má přednost před odvozenou ilustrací. Nahrávání vlastních fotografií přes UI není implementované; historické Storage politiky zůstávají samostatnou oblastí pro kontrolu před ostrým provozem.

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
- WhatsApp potřebuje účet Meta (pro pilot testovací číslo, ostré číslo s ověřením firmy), pět schválených utility šablon a secrets (`docs/PRED_SPUSTENIM.md`). Bez nich se nic neposílá, zákazník WhatsApp nevidí a v Provozovně je jen informace, že upozornění nejsou aktivní. Skutečné doručení, ověření jedním klepnutím na iPhonu a Androidu ani klepnutí na tlačítko zatím neproběhlo (**IMPLEMENTOVÁNO, ALE VYŽADUJE RUČNÍ EXTERNÍ OVĚŘENÍ**). V prohlížeči je ověřený celý tok s podvrženou zprávou z WhatsAppu přímo v databázi.
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
- Fotka kategorie je ilustrační a u neobvyklé služby nemusí sedět (půjčení kola dostane fotku sportovní lekce).

## Právní minimum (18. 9. 2026)

- Právní texty verze 1.0 nejsou zveřejněné: chybí údaje provozovatele v `private.settings` a účinnost verzí. Do té doby aplikace nemá patičku „O FLEKu“, souhlas v rezervaci ani odkaz na zásady v registraci a podnik souhlasí s „obchodními podmínkami FLEKu“ bez odkazu jako dřív.
- Texty napsal agent, ne právník (**IMPLEMENTOVÁNO, ALE VYŽADUJE RUČNÍ EXTERNÍ OVĚŘENÍ** právníkem před ostrým provozem). Zásady popisují i povinné potvrzení e-mailem, smazání účtu a doby uchování z migrace, která čeká na souhlas; proto se texty zveřejní až po ní.
- Smazání účtu zatím nejde v aplikaci: Profil nabídne e-mail podpory. E-mail zákazníkovi o rezervaci jde dál vypnout v nastavení upozornění a podrobnosti smlouvy (poskytovatel, cena, kód, storno) v něm budou až po migraci.
- Podnik, který se registroval před 18. 9., nemá typ podnikatele, datum narození ani ověření v ARES; doplní je ve fakturačních údajích. DAC7 podklad je jen podklad pro ruční oznámení, registraci provozovatele neřeší.
- `ares-lookup` čte veřejné API ARES bez klíče a bez smlouvy; při výpadku ARES podnik vyplní údaje ručně a admin je ověří sám.
- Staré analytické události mají `session_id` vyplněný dál, nové už ne. Trychtýř pro nepřihlášené proto nejde spojit na návštěvu.

