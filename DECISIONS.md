# Rozhodnutí

Jeden řádek na rozhodnutí, chronologicky. Kde bylo zadání nejednoznačné, zvolili jsme nejjednodušší variantu, která splní akceptační kritéria.

## Databáze a doména

- Dostupnost je `stable`, ne `immutable`, protože `now()` je v PostgreSQL stabilní v rámci transakce. Jediný SQL predikát sdílí vyhledávání, detail i atomický nárok.
- `sold_out` a `expired` nejsou uložené stavy. `offer_status` nese jen administrativní záměr; dostupnost se odvozuje v dotazu. Neexistuje druhá definice v TypeScriptu.
- Zámek profilu zákazníka serializuje duplicitní nárok i pravidlo tří rezervací. Zámky provozovny koordinují nárok s pozastavením. Pořadí zámků: profil → provozovna → nabídka → rezervace.
- Všechny klientské mutace jdou přes RPC. Žádný klient — ani s admin JWT — nedostane právo zapisovat kapacitu nebo rezervace.
- Schválená veřejná nabídka zůstává čitelná i konkurenci. Zákaz čtení mezi podniky platí pro neveřejnou nabídku a rezervace; tím se řeší rozpor mezi maticí politik a doslovným zněním testu.
- Abeceda kódů vynechává 0/O/1/I/5/S; vzorová abeceda v zadání obsahovala 5 a S, což si protiřečilo. Rejection sampling odstraňuje modulo bias.
- Neexistující pražská 02:30 v březnu se odmítá; nejednoznačná říjnová 02:30 používá dřívější výskyt a explicitně se vrací zpět.
- Odklad zrušení se řídí zadaným pravidlem OR. Zobrazená lhůta je pozdější z časů začátek−60 minut a vytvoření+10 minut.
- Základní skalární validace formulářů se sdílí se sestavením argumentů; způsobilost, kapacita, slevy a autorizace zůstávají rozhodnutím databáze.
- Migrace `…0006_metrics.sql` doplňuje čtecí modely, které obrazovky potřebují (nabídky partnera s počtem obsazení, metriky partnera, seznamy a metriky administrace). Každá funkce si autorizaci odvozuje sama.

## Aplikace

- Místo další závislosti (React Router) je použit vlastní router nad History API, asi 60 řádků. Potřebujeme jen shodu cesty a odkaz, který nepřenačte stránku.
- `src/types/database.ts` je zatím psaný ručně podle migrací, protože `npm run db:types` potřebuje běžící PostgreSQL. Po prvním spuštění databáze ho generovaný soubor nahradí; viz LIMITATIONS.md.
- Scaffold `components/ui` ze šablony shadcn zůstal nepoužitý a byl odstraněn. Zadání výslovně varuje před vzhledem výchozího shadcn a vlastní komponenty vyšly kratší než přizpůsobování cizích.
- MapLibre se načítá až na obrazovkách, které kreslí mapu (`React.lazy`). Balík má skoro megabajt a objevování ho nesmí platit.
- Serverový čas se bere z každé odpovědi, která ho nese (`server_now`), a drží se jako odchylka. Odpočty a popisky dnů se z něj přepočítávají v intervalu; hodiny zařízení se nepoužívají.
- Zákaznická část tyká, partnerská vyká. Důsledně, bez míchání.
- TanStack Query běží v režimu `networkMode: 'always'`. Výchozí režim výpadek sítě jen pozastaví, takže by zákazník viděl nekonečný skeleton a zablokované tlačítko místo čitelné chyby.
- Cache dotazů se maže jen při skutečné změně identity, ne při každé události přihlášení. Mazání při úvodní události zahazovalo probíhající dotazy.
- Service worker cachuje jen skořápku aplikace. Odpovědi o nabídkách a rezervacích se nikdy neukládají — kapacita se mění po minutách.
- Aplikace se jmenuje **FLEK**. Přejmenování proběhlo přímo v migracích včetně prefixu rezervačních kódů a názvů Storage politik, protože migrace do té doby nikde neběžely a rename migrace by byla jen technický dluh.
- Denní doba je serverový parametr `search_offers`, ne klientský filtr. Řeže se podle pražských hodin; kdyby to dělal prohlížeč, uživatel v jiné zóně by dostal jiný „večer" a stránkování by přestalo dávat smysl.
- Použité filtry zůstávají viditelné jako odebratelné pilulky. Tichý filtr, který uživatel nevidí, je nejrychlejší způsob, jak vypadat prázdně.
- Objevování má rytmus: co začíná do tří hodin jde do vodorovného pásu nahoře, nejhlubší slevy do druhého, zbytek je seznam. Žádná nabídka není ve dvou sekcích zároveň.
- Hodnocení stojí na dokončené rezervaci (`bookings.rating` a moderovaný `review_body`), ne na samostatné tabulce recenzí. Hodnotit tak může jen vlastník dokončené rezervace — omezení vynucuje datový model, ne aplikace. Průměr se počítá v dotazu; denormalizovaný čítač je jen další věc, která se může rozejít s pravdou.
- Veřejná důvěryhodnost provozovny se bere z Google Places, ne z interních demo hodnocení. Ukládá se jen `google_place_id`; aktuální průměr a počet se načtou serverově bez cache a vždy se označí atribucí `Google Maps`. Staré sloupce hodnocení zůstávají kvůli kompatibilitě databáze, ale veřejné rozhraní je nepoužívá.
- Hranice tří kusů platila pro původní interní hodnocení. Veřejné rozhraní je už nepoužívá; Google průměr vždy doprovází skutečný počet hodnocení a atribuce zdroje.
- Sekce na objevování se musí zasloužit: až od šesti nabídek celkem a jen se dvěma a více položkami. Prázdný karusel je horší než poctivý seznam a pilot začíná s hrstkou termínů.
- Náhled nabídky nad mapou zůstal plovoucí kartou, ne modálním sheetem. Modál by zakryl mapu, ve které si uživatel právě vybírá.
- Mezikrok „Hotovo" po zveřejnění termínu zmizel. Potvrzení patří na stránku za sheetem; jinak partner platí klepnutím navíc za informaci, kterou už vidí.
- Platí se předem přes FLEK, ne na místě. Sedadlo se vydá až proti vypořádaným penězům: `create_booking` odmítne cokoli jiného než platbu ve stavu `paid` a částku porovná s cenou v nabídce, takže změna ceny mezi zaplacením a rezervací nemůže zákazníka přeplatit.
- Poskytovatel platby je za tabulkou `payments`. Od 13. 9. 2026 je to jen Stripe: webhook pod service role označí řádek jako zaplacený a v tomtéž volání (`stripe_payment_succeeded` → `private.book_payment`) obsadí místo. Když místo mezitím zmizelo, zařadí vratku. Zákazník, který po zaplacení zavře prohlížeč, tak rezervaci stejně dostane.
- Stripe Connect s destination charges: zákazník platí platformě přes Checkout, FLEK si ponechá servisní poplatek jako `application_fee_amount` a zbytek Stripe převede podniku. Vratka vrací převod i poplatek (`reverse_transfer`, `refund_application_fee`), takže zákazník dostane celou částku. FLEK díky tomu nepotřebuje vlastní platební licenci a KYC podniků řeší Stripe.
- Účty podniků se zakládají přes Accounts v2 s konfigurací `recipient` (Stripe u nových integrací v1 odmítá): Express dashboard, poplatky i ztráty nese platforma. Podnik smí prodávat, když je `stripe_transfers` aktivní. Demo podniky dostanou účet bez dashboardu s testovacími údaji přes admin akci `demo_accounts`, jen v testovacím režimu.
- Ukázkové platby byly odstraněny všude, i u demo podniků („všude jen Stripe“). Demo i akceptační testy tak procházejí stejnou cestou jako ostrý provoz. Automatické testy platí přes `stripe-test-pay` (`pm_card_visa`), povolené jen s testovacím klíčem a jen pro účty `@flek.test`.
- Jedna vypořádaná platba koupí právě jedno sedadlo — hlídá to částečný unikátní index `bookings_one_per_payment`, ne aplikace.
- Zrušení v bezplatném okně vrací celou částku. Storno po lhůtě je odmítnuté už dřív, takže „vrátit jen část" nemá kdy nastat. Výplaty podnikům posílá Stripe z jejich connected účtu.
- Ověřovacím artefaktem zůstává rezervační kód. QR je jen odkaz na partnerské vyhledání s předvyplněným kódem — partner tak ověřuje foťákem, ne přepisováním šesti znaků, a nepotřebuje k tomu žádnou čtečku v aplikaci.
- Adresu provozovny hledá Photon nad OpenStreetMap: bez klíče a dost rychle na psaní. Souřadnice jsou důsledkem vybrané adresy, ne samostatné pole — obchodník nemá důvod vědět, co je zeměpisná šířka. Ruční úprava zůstává schovaná pro případ, kdy našeptávač mine.
- Lhůta pro bezplatné zrušení patří provozovně, ne konstantě v kódu. Padelový kurt a tříhodinová procedura nenesou stejné riziko. Lhůta se navíc **snímkuje na rezervaci**: podnik, který si politiku později zpřísní, nesmí měnit podmínky, za kterých už někdo rezervoval.
- Písmo je Instrument Sans, jedna rodina. Zkoušel jsem k němu Bricolage Grotesque na nadpisy — charakter to dodalo, ale stálo to zhruba 60 kB navíc na produktu, který se otevírá na telefonu. Nadpisům stačí tloušťka a těsnější prostrkání. Ověřeno, že všechny zvažované rodiny umí českou diakritiku i tabulkové číslice.
- Tyrkysová označuje značku a to, co jde stisknout — nic jiného. Úspora „Ušetříš X" se proto přesunula do inkoustové a odpočet „Začíná za…" taky: je to fakt, ne výzva k akci. Zelená zůstala jen penězům (zaplaceno, vráceno) a je záměrně daleko od tyrkysové, aby se ty dva významy nepletly.
- Partnerská část a administrace se načítají až při vstupu. Zákazník je nikdy neotevře a nemá si je proč stahovat.
- Logo je nový wordmark „flek" s dvěma čárkami. Text se sází aplikačním písmem, takže je vždy ostrý a v jednom stylu s rozhraním; do ikony a favikony jde monogram, protože celý wordmark je v 16 px nečitelný. Předloha měla limetkovou, ale paleta zůstala tyrkysová a čárky se přizpůsobily jí — jedna identita místo dvou.
- „Upozornění" u oblíbených míst se **odvozuje**, neukládá. Nové je to, co provozovna zveřejnila po `seen_at`, tedy po okamžiku, kdy se zákazník naposledy díval. Žádná tabulka oznámení, která by mohla zastarat, a žádná úloha na pozadí. `seen_at` se posune, teprve když se seznam skutečně vykreslí — odznak tak nemůže lhát.
- Push ani e-mail ve V1 nejsou, takže upozornění znamená odznak v navigaci a obrazovka „Nové u tvých míst". Je to slabší než push, ale je to pravdivé a nevyžaduje to souhlas se zasíláním.
- Barevnost je odvozená z loga: značková tyrkysová kreslí znak, tmavší odstín je vyhrazený pro hlavní CTA. Slevový odznak je tmavý, aby s CTA nesoutěžil.
- Nedostupná nabídka je rozcestník, ne zašedlé tlačítko. Důvod se **odvozuje** z faktů, které server posílá — druhá definice rezervovatelnosti v TypeScriptu nevzniká, `offer_is_bookable` zůstává jediná autorita. Pořadí pravidel je celý návrh: zrušení podnikem přebíjí vše, prázdná kapacita přebíjí hodiny (že si termín někdo vzal, platí i po jeho začátku), teprve pak mluví čas. Nikdy se netvrdí „někdo ho chytil", když ve skutečnosti vypršel.
- `set_favorite(id, value)` existuje vedle `toggle_favorite`, ne místo něj. Toggle je správný pro stisk tlačítka a nebezpečný pro přehrání záměru po přihlášení: dvojí zavolání vrátí přesně ten stav, který měl nastat. Záměr „sledovat" proto přežívá přihlášení stejně jako záměr rezervovat.
- Doporučení mají atribuci, ale žádný kredit. Utratitelný kredit by musel projít invariantem „vypořádané peníze odpovídají ceně nabídky"; dokud to neumí celá platební cesta, je poctivější měřit, kdo koho přivedl, než ukazovat částku, kterou nejde uplatnit.
- Pravidla proti zneužití doporučení jsou **constrainty, ne kód**: self-referral řeší CHECK, jeden referrer na účet PRIMARY KEY, jednu kvalifikaci na rezervaci částečný UNIQUE index. Souběh tak nemůže vyrobit dva referrery. Kvalifikace visí na `merchant_resolve_booking` — tam, kde rezervace skutečně proběhne — a je odstíněná tak, že nikdy neshodí vyřízení reálné rezervace.
- Za „nový doporučený účet" se považuje jen účet mladší 30 dnů **a zároveň** bez jediné rezervace. Každá z podmínek zvlášť je obejitelná: spící starý účet, nebo čerstvý účet, který produkt už použil jinou cestou.
- Zákaznické metriky se počítají v PostgreSQL ze snímků rezervace, ne z dnešní ceny služby, a jen ze stavu `completed`. Zrušená ani nedostavená rezervace hodnotu nevytvořila. Na `profiles` nepřibyl žádný čítač, který by mohl zastarat.
- Skenování QR u partnera dekóduje na zařízení: na Chromiu nativním `BarcodeDetector`, jinde se `jsQR` stahuje až při otevření skeneru. Skener stojí **vedle** ručního pole, ne místo něj — zamítnutá kamera nebo prasklý displej musí zůstat průchodné.
- Výzva k instalaci se ukáže až po rezervaci nebo v Profilu, nikdy na první návštěvě, a odmítnutí se pamatuje. `beforeinstallprompt` se zachytává při startu aplikace, protože se spouští jednou a brzy — komponenta, která se připojí až po rezervaci, by ho nikdy neviděla.
- Počet sledujících se podniku ukazuje až od pěti a je formulovaný jako publikum, ne jako doručené oznámení. Žádné push doručování neexistuje a tvrdit opak by znamenalo, že tu větu podnik zopakuje zákazníkům.
- Fotku služby vybírá partner ze seznamu činností, ne algoritmus z kategorie. Do teď `services.image_url` nenastavovala **žádná** partnerská obrazovka — sloupec existoval a `save_service` ho přijímal, ale nebylo ho čím naplnit, takže se fotka dědila podle otisku ID. Navíc tři z dvanácti ukázkových snímků byly zařazené ve špatné kategorii: jóga mohla ukazovat kosmetiku, sauna posilovnu, manikúra bazén resortu. Katalog je pojmenovaný podle toho, co na fotce **je**, ne podle kategorie, do které byla založená.
- Několik činností v kategorii sdílí jeden snímek záměrně. Jedna pravdivá fotografie je lepší než dvě, z nichž jedna je špatně.
- Wellness služby sdílí neutrální spa snímek, který nenaznačuje konkrétní resort ani bazén. Tím zůstává fotografie použitelná pro vířivku, páru i odpočinkovou proceduru a nepřisuzuje podniku vybavení, které nemusí mít.
- Vlastní fotografie partnera se nahrává jen do privátního `moderation-pending`; do veřejného bucketu ji přesune server až po schválení. Tím má vlastní fotka přednost před placeholderem bez toho, aby nezkontrolovaný obsah získal veřejnou URL.
- Výběr se sleduje podle činnosti, ne podle fotky. Porovnávání přes `image_url` rozsvítilo všechny dlaždice, které snímek sdílejí — výběr „Dámský střih" vypadal, jako by bylo vybráno čtvero.
- Název doplněný výběrem jde opravit dalším výběrem, název napsaný rukou ne. Partner, který se překlikne, potřebuje opravit obojí; partner, který prodává „Pánský střih s mytím", chce jen tu fotku.
- QR kód rezervace je dostupný i po zavření potvrzovací obrazovky. Do teď existoval jen tam a pak zbyl holý šestiznakový kód k přečtení nahlas; přitom právě QR je to, co člověk u pultu ukazuje. Otevírá se v panelu, ne inline v seznamu — kodér se načítá až na vyžádání a jeden náhled na řádek by ho stáhl pro každou rezervaci.
- Formulář služby sleduje uvažování partnera: co prodávám, jak tomu říkám, jak dlouho to trvá, co to běžně stojí. Kategorie z něj zmizela doprostřed cesty — je skoro vždy ta, kterou má provozovna, a navíc filtrovala výběr činnosti nad sebou, takže její změna tiše zneplatnila už vybranou fotku. Teď je až na konci pod rozbalovátkem spolu s popisem.
- Délka služby se vybírá z přednastavených hodnot. Volné číselné pole zve k překlepu, na kterém záleží: „6" místo „60" zveřejní šestiminutovou masáž.
- Činnost, ke které nemáme poctivou fotku, se v katalogu zobrazí jako „Bez fotky". Půjčit si obrázek něčeho jiného je horší než přiznat, že snímek nemáme.


## Pilot v1 — 13. 9. 2026

- Starou zobrazovanou 15% provizi nahrazuje poplatek placený zákazníkem: 5 %, min. 25 / max. 149 Kč. `deal_price_cents` je stále konečná zákaznická cena, `merchant_price_cents` částka podniku. U starých dat politika 0 nemění dohodnutou cenu.
- Rezervace po zaplacení ukládá výplatu podniku, poplatek a verzi jako neměnný snímek. Stejná platba vrací stejný kód i při souběžných pokusech; kontrola musí proběhnout také po získání zámku profilu.
- Při vytvoření rezervace je pořadí zámků profil → provozovna → nabídka → platba. Údržba vybírá zamčené platby přes SKIP LOCKED a existenci rezervace kontroluje samostatným dotazem až po zamčení. Vrácení platby nesmí použít zastaralý snímek dotazu, který čekal na jinou transakci.
- Dokončení po 24 hodinách od konce řídí pg_cron, nikoli načtení stránky. Nedorazení lze označit pouze před koncem této lhůty; není důvodem k vrácení platby ani ke ztrátě výplaty podniku.
- Realtime přenáší impuls k opětovnému načtení autorizovaného seznamu, nikoli důvěryhodný obsah banneru. Záložní dotaz běží každých 30 sekund. Stav upozornění se váže na uživatele i provozovnu a odhlášení jej vymaže.
- Cenová validace probíhá před platbou i při serverové rezervaci. Změní-li se částka od otevření potvrzení, zákazník ji musí nejdřív znovu vidět. Blízký termín ukazuje 10minutovou možnost storna od rezervace místo už uplynulé hodiny.

## Audit a zabezpečení — 13. 9. 2026

- Veřejná data tečou jen přes čtecí RPC (`search_offers`, `get_offer_detail`, `business_public`, `business_offers`). Anon nemá SELECT na `businesses/services/offers` a přihlášený je čte přímo jen jako člen podniku nebo admin. RLS filtruje řádky, ne sloupce: každý nový interní sloupec by jinak byl veřejný.
- Demo nabídky obnovuje databázový job, ne seed ani ruční skript. Generuje jen pro podniky, jejichž všichni členové mají `@flek.test`, stejnou validací a cenou jako `publish_flek`; čas a cena vycházejí z hashe služby a dne, takže opakované spuštění nic nezdvojí.
- Admin změny zapisují do `admin_audit_log` ve stejné transakci jako samotnou změnu. Tabulka nemá UPDATE/DELETE/TRUNCATE (trigger) ani klientské granty; aktér je jen id bez cizího klíče, aby smazání účtu nepřepsalo historii.
- CSP je bez `unsafe-eval` a bez inline skriptů. Zod proto běží s `jitless: true` — jinak jeho zkouška `new Function` hlásí porušení CSP. Nová externí doména (mapy, obrázky, API) se musí přidat do CSP ve `vercel.json`, jinak ji prohlížeč tiše zablokuje.
- Analytika ukládá polohu hledání zaokrouhlenou na ~1 km a nezpracované události maže po 180 dnech (`flek-analytics-retention`). Velikost props je omezená uvnitř `record_event`, ne jen politikou.
- Obnova hesla používá stejný PKCE tok jako potvrzení e-mailu: odkaz vede na `/prihlaseni?mode=reset` a musí se otevřít ve stejném prohlížeči. Odpověď na žádost o odkaz je stejná bez ohledu na to, zda účet existuje.
- Chyba jedné stránky neshodí navigaci (boundary na úrovni routy) a chybějící chunk po novém nasazení stránku jednou sám obnoví.

## E-maily, upozornění a vzhled — 13. 9. 2026

- E-maily odcházejí přes Resend ze subdomény `mail.app-flek.eu`. Kořenová doména `app-flek.eu` a schránky u Seznamu zůstávají beze změny; Resend potřebuje jen DKIM a dva CNAME pod `mail`.
- Supabase Auth posílá ověření účtu a obnovu hesla přes stejné SMTP. Odkazy nesou `token_hash`, takže fungují i v jiném prohlížeči, než ve kterém se o ně požádalo.
- Upozornění vznikají v triggeru nad `bookings` ve stejné transakci jako změna rezervace: záznam do inboxu a do fronty doručení. Doručuje Edge Function volaná přes `pg_net` jen tehdy, když je něco splatné, a cron každou minutu jako pojistka. Výpadek Resendu nebo push služby rezervaci nezablokuje, jen se zpráva zkusí znovu (až 8×).
- Tajný klíč pracovníka je jen v `private.notification_config` a funkce ho ověřuje přes service-role RPC. Kopie v prostředí funkce se s databází rozešla a všechna doručení končila 401.
- Push nese jen odkaz a obecný text, detaily si aplikace načte po otevření: zamykací obrazovka může být sdílená.
- ~~Paleta „Mandarinka“~~ (13. 9. večer, 14. 9. nahrazená Nočním ultramarínem, viz níže): téměř černá `#17181C` pro text a hlavní tlačítka, mandarinková `#F2703F` jako výplň a zvýraznění (slevy, špendlíky, logo, kódy na tmavých blocích; s černou 6,1 : 1), tmavší `#B4460F` pro odkazy a ikony (5,5 : 1 na bílé), neutrální pozadí `#F6F5F3`. Barvy jsou jen v tokenech ve `src/styles.css`; logo, ikony aplikace (SVG i PNG), mapa, univerzální obrázek služby, manifest a e-maily používají stejné hodnoty.
- Služba bez vlastní fotky a bez ilustrace aktivity ukáže univerzální obrázek FLEKu, ne obal provozovny: ten dělal z půjčovny kol wellness.
- Originální ilustrační fotografie jsou čtvercové a kompozičně bezpečné pro ořez 4:5, 1:1 i 2:1; důležitý motiv je nad spodní třetinou, kterou na nových kartách překrývá informační panel. Pro kartu se nabízí 800px derivát a pro mapový bod 176px derivát. Fotka zvolená podnikem má vždy přednost.

## Vratky podle stavu ve Stripe — 14. 9. 2026

- Platba je `refunded` jen tehdy, když Stripe hlásí vratku `succeeded`. Přijatá vratka (`pending`, `requires_action`) nechá platbu `paid` ve frontě a pracovník `stripe-refunds` si stav při dalším běhu načte znovu. Dřív se za vrácenou považovala každá vratka, kterou Stripe přijal, a webhook `charge.refunded` ji tak označil naslepo (nález P0 z auditu ChatGPT).
- Stav vratky zapisuje jediné service-role RPC `stripe_refund_update` a ukládá ho do `payments.refund_status`. Webhook obsluhuje `refund.created`, `refund.updated`, `refund.failed` (a zastaralé `charge.refund.updated`) a vratku si vždy načte znovu ze Stripe: události chodí v libovolném pořadí, kopie v události může být starší.
- Zpráva o starší vratce nepřepíše novější a selhaná nebo zrušená vratka už nikdy neožije jako `succeeded`. Stripe ji sám nikdy neobnoví; pozdní `succeeded` od pomalejšího pracovníka se proto zahodí.
- Vratka, kterou Stripe zamítne (`failed`) nebo zruší (`canceled`), i dny po zdánlivém úspěchu, vrátí platbu na `paid` s důvodem a vypadne z automatické fronty. Stripe u selhané vratky radí vrátit peníze jinou cestou: nový pokus na zrušenou nebo ztracenou kartu jen znovu selže a vratku zrušenou kvůli sporu opakovat nelze. Automaticky se dál opakují jen chyby na cestě ke Stripe (až 8×).
- Zákazník u zrušené rezervace s nevrácenou platbou vidí „Vracíme peníze“ místo „Zaplaceno“. Stránka po návratu z platby u selhané vratky řekne, že se peníze na kartu vrátit nepodařilo a vyřeší se ručně (`my_payment_state` nově vrací `refund_status`).

## Paleta „Noční ultramarín“ — 14. 9. 2026

- Mandarinka nepůsobila dost tmavě ani moderně. Aplikace zůstává světlá kvůli fotkám služeb a světlé mapě, tmavší je značka. Pět designérů navrhlo směry (ultramarín, švestka, petrol, grafit s kobaltem, černá višeň), porota je posoudila podle značky, přístupnosti a praxe a Jakub vybral ze tří finalistů ukázaných na skutečných obrazovkách ultramarín.
- Značka `#2C26D2` je výplň s bílým textem (9,1 : 1) a může být i textem na bílé. Text a hlavní tlačítka jsou noční modročerné `#10121F`, odkazy a ikony `#1E22A3`, pozadí chladné `#F3F4F8`. Modrá je od zelené pro peníze, jantarového varování i červené chyby nejdál, takže se sleva nesplete se stavem, a jako doplňková barva k pleti, dřevu a teplému světlu nechá fotky vyniknout.
- Značka a ink mají mezi sebou jen 2,1 : 1, proto má značka na tmavých blocích dvě podoby: `brand-on-dark` `#8797FF` pro text (kód rezervace, ušetřená částka, 7,0 : 1) a `brand-bright` `#4D67FB` pro grafiku (špendlík v logu na tmavém, prstenec shluku na mapě, špendlík v ikoně aplikace).
- Role značky jsou tokeny (`brand-ink`, `brand-on-dark`, `brand-bright`, `ink-hover`, `promo`, `promo-ink`), ne natvrdo zapsané barvy v komponentách. Příští změna palety je tak jen změna hodnot ve `src/styles.css` plus statické soubory, které CSS nečtou: ikony (SVG a PNG), obrázek služby bez fotky, `theme-color` a e-maily.
- Promo blok je jednobarevný `#CFD4FF`, bez přechodu.

## Potvrzování rezervací podnikem — 15. 9. 2026

Stejné zadání dostal ChatGPT (Codex), Jakub schválil jeho plán a Claude jeho rozpracovanou verzi dokončil a opravil (Jakubova volba, 14. 9. večer). Proto zůstává Codexova architektura.

- **Stavy přímo v `bookings`** (`pending_payment`, `pending_merchant`, `capturing`, `confirmed`, `rejected`, `expired`, `payment_failed`), ne samostatná tabulka žádostí. Kapacita, finanční snímek, upozornění i čtecí modely už nad `bookings` stojí a jedna řada zámků (profil → podnik → nabídka → platba → rezervace) hlídá všechny přechody. Cena: každá budoucí funkce nad rezervacemi musí počítat s nedohodnutými stavy. Pomocník `private.booking_was_agreed` a test `update_offer` to hlídají.
- **Místo se drží už před Checkoutem**, 3 minuty (Jakubova volba). Zamítnutá alternativa: nejdřív autorizovat a místo vzít až potom. O poslední místo by pak mohli autorizovat dva zákazníci a jednomu by se blokace uvolňovala za místo, které nikdy nebylo. Opuštěný Checkout drží místo nejvýš 3 minuty; limit 5 opuštěných holdů za hodinu brání blokování inventáře.
- **Autorizace a stržení až po potvrzení** (`capture_method: manual`), ne okamžitá platba s vratkou při odmítnutí. Vratka trvá dny, stojí poplatky a zákazník by viděl stržené peníze za službu, kterou nedostal. Uvolněná blokace se nevrací, proto texty rozlišují „blokaci uvolňujeme“ a „peníze vracíme“.
- **Jediné rozhodnutí `private.decide_booking`** pro aplikaci i WhatsApp. Kontroluje deadline samo, takže cron `flek-confirmation-expiry` jen dřív vrací místa a na správnosti nezávisí. Druhý kanál nemá vlastní logiku, kterou by šlo obejít.
- **Okno podle začátku termínu** (10 / 5 / 3 minuty, pod 15 minut nic, vždy 10 minut rezerva před začátkem) rozhoduje server při autorizaci. Rozporný příklad ze zadání (16:00 → 17:30) se řídí tabulkou, tedy 5 minut.
- **Kód rezervace se ukáže až po potvrzení** na úrovni pohledů, ne jen v UI: data čekající žádosti ho neobsahují.
- **Rollout přepínačem** `false` / `demo` / `true` v `private.settings`, stejné pravidlo pro demo podniky jako `flek_demo_refresh`. Zapnout jde bez nasazení frontendu a vypnout bez ztráty rozběhnutých žádostí.
- **Worker s číslem pokusu v idempotency klíči.** Stripe vrací uložený výsledek klíče, takže opakování po chybě musí být nový požadavek; dvojí capture nebo zrušení Stripe stejně nedovolí. Po 8 pokusech nebo trvalé chybě se capture vzdá, místo se vrátí a autorizace uvolní.

## WhatsApp upozornění — 15. 9. 2026

- **Oficiální Meta WhatsApp Cloud API**, žádný WhatsApp Web ani neoficiální bot. Klíče jen v Supabase secrets.
- **Číslo se ověřuje párovacím kódem poslaným z toho čísla**, ne ověřovací šablonou ani odkazem s tokenem. Prokáže vlastnictví čísla, nepotřebuje další schválenou šablonu a žádný GET nic nemění. Kód se musí shodovat s číslem zadaným v aplikaci, takže uniklý snímek obrazovky sám nestačí.
- **Rozhodnutí z tlačítka se váže na odeslanou zprávu.** Oficiální referenční stránka Meta ukazuje v `button.payload` text tlačítka, integrace třetích stran potvrzují vrácení vlastního payloadu. Webhook proto přijme náš jednorázový token (v databázi jen hash) i samotný text tlačítka, ale vždy jen s `context.id` zprávy, kterou FLEK na to číslo poslal. Rozpor mezi tokenem a textem tlačítka nerozhodne nic.
- **Za podnik rozhoduje člen, který číslo propojil**, a jen dokud je členem. Nová spárování číslo přepnou do stavu čekání a staré zprávy přestanou platit.
- Jedna WhatsApp zpráva na žádost a podnik (u člena, který číslo propojil), ne na každého člena. Výpadek WhatsAppu neblokuje e-mail ani push: WhatsApp má vlastní frontu v téže tabulce a vlastní claim.

## Víc časů, doporučení, obrázky a WhatsApp pro všechny — 15. 9. 2026

Jakub po nasazení potvrzování poslal pět požadavků: stejně vysoké karty na mapě, karusel dalších služeb, lepší obrázek pro službu bez fotky, víc časů u jedné nabídky a WhatsApp vždy zapnutý, ale vypínatelný. Jeho volby: jedna karta s časy, WhatsApp zapnutý předem s ověřením jedním klepnutím, i pro zákazníky.

- **Jedna karta na službu s časy**, ne karta na každý termín (`src/features/discovery/slots.ts`). Každý čas zůstává samostatnou nabídkou s vlastní cenou, kapacitou a lhůtou zrušení; seskupuje se jen v klientovi podle `business_id + service_id` a na kartě je nejbližší čas. Feed, mapa, stránka podniku, oblíbené i náhrada za neobsaditelný FLEK používají totéž seskupení. Dvě služby se stejným názvem a jinou délkou jsou dvě karty. Hledání bere 50 řádků místo 30 a rozšiřování počítá karty, ne řádky, aby seskupení nezmenšilo nabídku.
- **Výběr času na detailu přepne adresu** (`/nabidka/<id>` s `replace`), ne jen stav stránky. Rezervační sheet, cena, mobilní lišta i návrat ze Stripe tak vždy sedí na zvolený čas; nabídka se předem načte, aby stránka nepoblikla. Nadpisy dnů jen tehdy, když má některý den víc časů.
- **Karusel „Mohlo by se ti líbit“** je výjimka z pravidla bez reklamních carouselů, na Jakubovo přání: jen skutečné FLEKy (jiné služby podniku, stejná kategorie v okolí, pak cokoli v okolí) ze stejných dotazů jako zbytek aplikace, žádný doporučovací algoritmus, a jen když jsou aspoň dva.
- **Obrázek služby bez fotky:** vlastní fotka → ilustrace podle názvu → fotka kategorie (stejné fotky bez tváří jako galerie aktivit) → obrázek FLEK. Bledá dlaždice s plusem vypadala jako „přidat fotku“. Fotka kategorie je jen ilustrační, u neobvyklé služby (půjčení kola) nemusí sedět přesně, proto má štítek.
- **WhatsApp je výchozí zapnutý jako e-mail** (`notification_preferences.whatsapp default true`) a vypíná se u každé události zvlášť i celý v sekci WhatsApp. Posílá se ale jen na číslo **ověřené zprávou z toho čísla**: zákaznická zpráva nese rezervační kód a podniková výplatu, telefon z profilu bez ověření nestačí. Zákazník WhatsApp nevidí, dokud FLEK nemá číslo; partner vidí, že upozornění zatím nejsou aktivní.
- **Ověření jedním klepnutím, kód vytvoří aplikace.** Na telefonu WhatsApp s připravenou zprávou spolehlivě otevře jen odkaz, na který člověk sám klepne; okno otevřené až po odpovědi serveru prohlížeč blokuje nebo neotevře aplikaci. Tlačítko je proto obyčejný odkaz na wa.me s kódem z `crypto.getRandomValues` a totéž klepnutí uloží hash kódu a souhlas. Bezpečnost se nemění: rozhoduje zpráva s kódem přímo z ověřovaného čísla a limit pěti kódů za hodinu. Cena: když se kód uloží až po odeslání zprávy (pomalá síť), párování selže a stačí „Otevřít WhatsApp znovu“.
- **Obecné kontakty** `private.whatsapp_contacts` pro podnik i zákazníka místo `business_whatsapp`. Tlačítka Potvrdit / Nemohu přijmout má dál jen žádost pro podnik a rozhoduje jen `private.decide_booking`; klepnutí na jakoukoli jinou zprávu nic nerozhodne.
- **Nikomu nechodí WhatsApp o tom, co sám udělal:** podnik nedostane zprávu o vlastním potvrzení, odmítnutí ani zrušení, zákazník o vlastním zrušení. V aplikaci a e-mailem se to ukáže dál. Podnik v režimu potvrzování tak dostane žádost a potom jen změny, které udělal někdo jiný (vypršení, zrušení zákazníkem, selhání platby); bez potvrzování dostane novou rezervaci jako „potvrzenou“.
- **Pět šablon, každá s vlastním secretem.** Chybějící šablona zprávu jen přeskočí (`WHATSAPP_TEMPLATE_MISSING`), takže šablony jde schvalovat postupně a e-mail s push běží dál. Parametry jdou v pořadí, v jakém stojí v textu, a žádný není na začátku ani na konci zprávy (pravidla Meta).
- **Push do `main` nasazuje i Edge Functions** uvedené v `supabase/config.toml` (GitHub integrace Supabase), zjištěno 15. 9. Nasazení mimo push jde dál přes MCP.
- **Události webhooku Stripe nastavuje admin funkce `stripe-webhook-setup`**, ne ruční klikání v Dashboardu. Najde jen endpoint mířící na `stripe-webhook` této aplikace, přidá chybějící události a nic jiného nemění (podpisový klíč, URL). Klíč Stripe zůstává v Supabase secrets, agent ho nepotřebuje vidět. Totéž půjde zavolat pro ostrý webhook.

## Právní minimum — 18. 9. 2026

Jakub rozhodl: provozovatel zatím OSVČ, texty napíše agent a mohou být veřejné, právník je zkontroluje před ostrým provozem; analytika bez ukládání do zařízení. Výchozí řešení sporných bodů jsou v kontrolním seznamu pro právníka (`docs/PRED_SPUSTENIM.md`).

- **Texty jsou markdown v repozitáři** (`src/content/pravni`), sestavené do aplikace a vykreslené do React prvků bez `dangerouslySetInnerHTML`. Změna textu jde přes commit a revizi, ne přes databázi. Databáze drží jen verze a účinnost (`public.legal_documents`), aby server mohl odmítnout souhlas se starou verzí.
- **Nic se neukáže, dokud nejsou údaje provozovatele.** Stránky, patička, souhlas i patička e-mailů čekají na `operator_name`, `operator_ico`, `operator_address` a `support_email` v `private.settings` a na účinnou verzi podmínek. Stránka, která by neřekla, kdo FLEK provozuje, by byla horší než žádná; produkce se proto nasazením nezměnila.
- **Souhlas zapisuje server se stejnou verzí, jakou člověk viděl.** Klient pošle verzi do `start_payment`, server ji porovná s platnou a zapíše `private.legal_acceptances`; nesedí-li, platba nezačne (`TERMS_OUTDATED`) a aplikace načte novou verzi. U podniku totéž ve fakturačních údajích a v banneru; zveřejnění FLEKu bez souhlasu zastaví trigger nad `offers` (plánované úlohy bez `auth.uid()` výjimka, jinak by se zastavila demo obnova).
- **Odstoupení: výjimka pro služby v určeném termínu u všech kategorií**, storno a nedostavení podle dnešních pravidel, smlouva vzniká potvrzením podniku. Nejistá místa (kadeřnictví a kosmetika, model plateb `on_behalf_of`, tlačítko v Checkoutu) řeší právník a daňový poradce.
- **Analytika bez identifikátoru v prohlížeči:** `record_event` ukládá `session_id` null, anonymní události se jen počítají a nepropojují. Cena: trychtýř nejde spočítat na návštěvu, jen na přihlášeného uživatele. Výhoda: žádná cookie lišta (§ 89 odst. 3 zákona o elektronických komunikacích).
- **Poskytovatel služby u rezervace:** název, IČO a adresa z fakturačních údajů podniku (`business_provider`), u demo podniků věta, že jde o ukázku, místo vymyšlené firmy. Skutečný podnik jde schválit jen s IČO; ARES se volá z Edge Function (`ares-lookup`), protože prohlížeč by ARES neměl v CSP a výsledek se ukládá k podniku pro admina.
- **Nahlášení obsahu jen přihlášeně** (limit 10 za den, e-mail podpory pro ostatní), vyřízení v administraci s auditem. Omezení nabídky nebo podniku dělá admin existujícími nástroji, nahlášení je jen fronta.
- **DAC7 jako CSV pro admina**, ne automatické podání: počítá jen ostré (`livemode`) zaplacené a nevrácené platby po čtvrtletích v `Europe/Prague`; oznámení podává provozovatel sám.
- **Migrace s povinnými e-maily, smazáním účtu a mazáním starých dat čeká na Jakubův výslovný souhlas.** Automatický režim ji odmítl jako změnu sdílených dat (mění přihlašovací data v `auth.users`, přidává denní mazání). Aplikovaná část je čistě přidávací; Profil zatím nabídne smazání účtu přes e-mail podpory.

## Srovnání s podobnými službami, povinné zprávy a přihlášení přes Google a Apple — 18. 9. 2026

Jakub povolil migraci s povinnými zprávami a mazáním dat, chtěl přihlášení přes Apple a Google a kontrolu, jestli FLEK jako zprostředkovatel nemá v právních věcech nic navíc proti podobným službám.

- **Srovnání (září 2026):** podmínky pro uživatele mají Too Good To Go asi 4 800 slov, Fresha asi 6 500, Reservio asi 8 500 a TasteTown asi 15 500. FLEK má 1 200 slov pro zákazníky, 1 200 pro podniky a 980 pro zásady, textem tedy nic nepřebývá. Všechny čtyři služby se popisují jako zprostředkovatel, reklamaci služby posílají k poskytovateli, mají věkovou hranici (plnoletost, Reservio 16 let) a omezenou odpovědnost. Too Good To Go vybírá platbu jménem obchodu stejně jako FLEK. TasteTown a Reservio mají nahlašování obsahu (DSA) jako oddíl podmínek.
- **Pravidla obsahu jsou oddílem podmínek**, ne samostatným dokumentem: nahlášení, lhůta, odůvodnění a kontaktní místo v podmínkách pro zákazníky, zakázané služby a obsah v podmínkách pro podniky. Místo čtyř dokumentů tři, jako u ostatních.
- **Formální vnitřní odvolání se lhůtou 6 měsíců vypuštěné.** Čl. 20 DSA se týká online platforem, mikro a malé podniky jsou vyňaté (čl. 19). Povinné zůstává oznámení a jeho posouzení (čl. 16), odůvodnění (čl. 17), kontaktní místo (čl. 11 a 12) a informace v podmínkách (čl. 14). Nesouhlas se řeší e-mailem a novým posouzením člověkem.
- **Podnik s podmínkami souhlasí jednou.** Novou verzi oznámíme aspoň 15 dní předem a platí pokračováním ve spolupráci, jak to dovoluje nařízení P2B a jak to dělají Too Good To Go, Fresha i Reservio. Blokovat zveřejňování do nového souhlasu by jen brzdilo podniky. Poprvé souhlasit musí dál; zákazník souhlasí s platnou verzí při každé platbě, protože ho to nic nestojí a je to důkaz.
- **Co zůstává, protože to žádá zákon i pro zprostředkovatele:** identifikace provozovatele (§ 435 OZ), kdo službu poskytuje a že FLEK jen zprostředkovává (informační povinnosti online tržiště), potvrzení smlouvy e-mailem, výjimka z odstoupení, ADR u ČOI, zásady ochrany osobních údajů a doby uchování (GDPR), podmínky pro podniky (P2B), údaje podniků pro DAC7 (osobní služby nemají výjimku pro malé prodejce). Export dat a smazání účtu v aplikaci zákon přímo nežádá, stačilo by na požádání; zůstávají, protože jsou hotové a App Store je u aplikací s účtem vyžaduje.
- **E-mail zákazníkovi o rezervaci nejde vypnout** (potvrzení a informace o smlouvě), podnikům a push dál podle nastavení. Zprávy o účtu (`account`) nemají rezervaci, proto `notifications.booking_id` smí být prázdné jen u nich.
- **Blokace zákazníka jen s důvodem**, který dostane v aplikaci i e-mailem. Podnik dostane důvod zamítnutí nebo pozastavení stejně.
- **Smazání účtu** smaže osobní údaje i přihlašovací identitu a účet zablokuje, rezervace a platby zůstanou (účetní a daňové lhůty). Jméno v profilu se změní na „Smazaný účet“, aby podnik u starých rezervací neviděl prázdné místo. Člen podniku a admin mažou účet přes podporu.
- **Google a Apple přes Supabase Auth (PKCE)**, bez vlastního serveru. Tlačítko se ukáže jen pro poskytovatele zapnutého v Supabase (veřejné `/auth/v1/settings`), takže kód mohl jít do produkce dřív než klíče. Jméno z účtu předvyplní `handle_new_user`, telefon si vyžádá první rezervace jako dosud. Doporučení: nejdřív Google (zdarma), Apple až s plánem na aplikaci v App Store (99 USD ročně, klíč každých 6 měsíců, registrace odesílací domény kvůli skrytým e-mailům).

## Kontrola kvality právních textů — 18. 9. 2026

Jakub: „u podmínek nejde o délku, ale o kvalitu“. Texty prošly proti zákonu a proti tomu, co aplikace skutečně dělá; opravy jsou v commitu 060491e, texty zůstávají ve verzi 1.0, protože ještě nejsou zveřejněné (chybí údaje provozovatele).

- **Odstoupení ve dvou vrstvách.** Výjimka § 1837 písm. j) jistě kryje služby využití volného času v určeném termínu (sport, jóga, wellness, masáže), u kadeřnictví a kosmetiky je nejistá. Pro ně podmínky i věta před platbou obsahují výslovnou žádost o poskytnutí služby v rezervovaném termínu, tedy před koncem 14denní lhůty: po úplném poskytnutí právo zaniká (§ 1837 písm. a)) a při odstoupení během poskytování se platí poměrná část (§ 1834). Bezplatné zrušení podle podmínek je pro zákazníka výhodnější a zůstává. Rozhodne právník.
- **Tlačítko na platební stránce Stripe „Zaplatit“** (`submit_type: 'pay'`, `stripe-checkout` v10). Z textu „Rezervovat“ (`book`) nevyplývá povinnost platit, jak žádá § 1826a odst. 3. V režimu potvrzování věta pod tlačítkem říká, že se částka nejdřív jen zablokuje.
- **Lhůty přesně podle SQL:** blokace po 2 nedostaveních trvá, dokud starší z nich není starší než 60 dní; po 5 propadlých podrženích za hodinu nejvýš hodinu. Neurčité „dočasně“ a „chvíli“ pryč.
- **Ukázkové podniky** jsou výslovná výjimka z věty, že všechny podniky jsou podnikatelé; rezervace u nich slouží jen k vyzkoušení.
- **Podnikům doplněno, co P2B žádá a chybělo:** spolupráce na dobu neurčitou bez omezení nabízet jinde (FLEK nemá doložku parity), komu předáváme data podniku (Stripe, Finanční správa) a co s nimi po skončení spolupráce.
- **Zásady doplněné** o přihlášení přes Google a Apple, o to, které údaje jsou povinné a proč (čl. 13 odst. 2 písm. e) GDPR), a o způsob námitky.
- **Účet:** místo „za vše, co se v účtu stane, odpovídáš ty“ (nevyvážené vůči spotřebiteli) jen povinnost chránit heslo a ozvat se při zneužití.

## Úvodní stránka v duchu move+ — 20. 9. 2026

Jakub ukázal aplikaci move+ (moveplus.cz) a chtěl Objevit ve stejném duchu.

- **Fotka je celá karta.** Fakta leží na matném bílém panelu přes její spodní okraj, na obrázku zůstaly jen dvě věci, podle kterých se rozhoduje o klepnutí: kdy to začíná a kolik je to dolů. Dřív byla fotka v poměru 8 : 5 nad bílým blokem textu; karta je teď čtverec (v liště na výšku), takže na obrazovku telefonu se vejde celá jedna nabídka a kus druhé.
- **Lišta jen pro první sekci.** „Začíná brzy“ se listuje do strany, ostatní sekce zůstaly mřížkou. Stránka samých lišt schová víc, než ukáže, a nabídky se mají procházet svisle.
- **Žádné profilovky podniků ani pulzující tečka.** Obojí bylo v prvním návrhu podle move+ a Jakub je zrušil: FLEK nemá loga podniků a písmeno v kolečku bralo šířku názvu služby; blikající tečka nepřidávala nic k tomu, co už říká „za 29 min“.
- **Nadpis dvouřádkový** („Volné FLEKy.“ a „Se slevou.“ v barvě značky). Sleva je aspoň 10 %, takže druhý řádek platí vždy.
- **Promo bloky pro nepřihlášené mají jednu výšku** (`min-h-80` v `EmptyState`), aby přepnutí mezi Oblíbenými a Rezervacemi neposkočilo o výšku zalomeného řádku. Delší text kartu roztáhne, kratší ji nezmenší.
- **„Sleduj místa, kam se vracíš.“** místo „kam se rád vracíš“ — texty pro zákazníka zůstávají bez rodu.

## Ikona oboru ve špendlíku a časy jako karty — 20. 9. 2026

Jakub ukázal aplikaci s mapou, kde má každý špendlík značku aplikace, a stránku podniku, kde je každá nabídka karta s fakty a tlačítkem. Vybral ikonky podle kategorie a tlačítko jen u vybraného času.

- **Ve špendlíku je ikona oboru, ne fotka služby.** Fotka ve 48px kolečku nic neřekla: ručník, lehátko a ošetřovna jsou při té velikosti stejný béžový čtverec, a šest fotek vedle sebe splývalo. Nůžky, ruka, jiskry, činka, květ a vlny se poznají na první pohled a mapa konečně nese obor. Tvary jsou z lucide, stejné sady, jakou kreslí zbytek aplikace, a názvy ikon už roky ležely v `public.categories.icon` nevyužité. Neznámá kategorie dostane značku FLEK.
- **Tmavá dlaždice s jasnou značkou**, přesně ten vztah, jaký má ikona aplikace: ultramarín `brand-bright` na noční `ink` (4.1 : 1, AA pro grafiku). Rozměry dlaždice (48 px) i celého špendlíku (64 px) zůstaly, protože z nich počítá kolize shluků `mapClusters.ts`.
- **Čas na detailu je karta, ne pilulka.** Pilulka unesla hodinu a nic víc, takže dva časy, které se liší o 150 Kč, o půl hodiny procedury nebo o poslední volné místo, vypadaly zaměnitelně a rozdíl se dal zjistit jen proklepáním. Karta rovnou říká, co si klepnutím koupíš: hodinu, konečnou cenu, slevu, délku a co zbývá.
- **Tlačítko jen u vybraného času.** Tlačítko na každé kartě (jako v ukázce) by na mobilu soupeřilo se spodní lištou a z dlouhého seznamu udělalo stěnu stejných výzev. Karta tedy čas vybere a rezervuje se jedním tlačítkem — na telefonu ve spodní liště, na desktopu v kartě termínu.
- **Strop výšky na desktopu.** Seznam časů má `md:max-h-96` a vlastní posuvník, protože karta „Tvůj termín“ je přilepená (`md:sticky`); bez stropu by šest karet vytlačilo cenu a tlačítko pod okraj obrazovky, kam se u přilepené karty nedá doscrollovat. Nad pět časů se zbytek schová za „Další časy (N)“ a vybraný čas se nikdy neschová.
- **Záložky (Overview/Reviews/About) z ukázky nepřebíráme.** Detail FLEKu je krátký; „O službě“ a „Kde to je“ by se za záložkami jen schovaly.

## Víc demo FLEKů na den — 20. 9. 2026

- **Tři termíny na službu a den místo jednoho.** Jedna nabídka denně vypadala v datech rozumně (29 publikovaných), ale odpoledne už nebylo co rezervovat: v 16:00 zbývaly tři. Demo má ukazovat produkt, ne prázdný feed.
- **Rotace slotů s krokem 7 z 25 půlhodin** (8:00–20:00). Krok nesoudělný s počtem slotů projde všechny a dva termíny téže služby od sebe dělí několik hodin, takže karta „další časy“ ukazuje rozumnou nabídku místo tří časů za sebou.
- **Strop šest na den** (`p_per_day` se ořízne), aby se z dema nestala zeď stejných nabídek.
- **Fotky se srovnaly migrací, ne v kódu.** Katalog v `serviceIllustrations.ts` se od 10. 9. měnil, ale existující řádky zůstaly na seedu a aplikace dává přednost fotce uložené u služby. Migrace mění jen řádky s přesně původní seedovanou hodnotou; co si podnik nahrál sám, zůstává.

## Karta na mapě vede k rezervaci — 20. 9. 2026

- **„Navigovat“ z karty pryč.** Na mapě člověk řeší, jestli se mu termín vyplatí, ne jak se tam dostane; čtvrť i vzdálenost má na kartě a trasu si hledá, až je FLEK jeho. Navigace zůstává na detailu a na voucheru po zaplacení.
- **Místo ní „Chytit FLEK“** se stejným slovesem jako na detailu, aby se stejná akce neučila dvakrát. Otevře detail s `?rezervovat=1`, což je parametr, který aplikace uměla už kvůli návratu z přihlášení — nevznikla druhá cesta do rezervace.
- **„Detail“ zůstává vedle** jako vedlejší akce pro toho, kdo si chce nejdřív přečíst popis a zrušení. U termínu, který se mezitím vyprodal, je tlačítko jediné a vede na záchrannou nabídku podobných termínů.

## Sklo a logo v e-mailech — 20. 9. 2026

- **Jedno sklo pro celou aplikaci** (`.glass` ve `styles.css`) místo šesti různých kombinací `bg-card/9x` s rozostřením. Sklo dělají tři věci dohromady: rozostření 20 px se zvýšenou sytostí (barvy fotky nebo mapy prosvítají), vlasová linka nahoře jako odlesk na hraně a měkký stín s náznakem barvy značky.
- **Průhlednost má strop 86 %,** protože pod panelem je fotka, o které nic nevíme. Nad černou fotkou má text `--color-muted` na 86% bílé 5,0 : 1 — nad AA pro malý text. Při 80 % je to 4,4 : 1, tedy pod normou: řádek se čtvrtí a vzdáleností by nad tmavou fotkou přestal být čitelný. Sklo je tedy tak průhledné, jak jde bez ztráty čitelnosti, ne tak průhledné, jak by vypadalo nejlíp na screenshotu.
- **Bez podpory `backdrop-filter`** se sklo přepne na skoro bílou (97 %). Průhledná deska bez rozostření je špinavá skvrna, ne sklo.
- **Karta nad mapou je sklo celá.** Mapa pod ní prosvítá, takže náhled působí jako vrstva nad mapou, ne jako vytržený obdélník.
- **V e-mailech je logo PNG,** vyrenderované ze stejného tvaru, jaký kreslí `components/ui.tsx`. SVG do e-mailu nepatří (většina klientů ho zahodí) a dosavadní „flek′“ — slovo s apostrofem — nebylo logo FLEKu. Když příjemce blokuje obrázky, zůstane alt „FLEK“.

## Zásady zveřejněné bez IČO — 20. 9. 2026

- **Zásady mají vlastní, nižší práh než obchodní podmínky.** GDPR chce vědět, kdo údaje zpracovává a kam se na něj obrátit — správcem může být fyzická osoba a IČO k tomu není potřeba. Obchodní podmínky naopak předpokládají podnikatele, takže ty čekají na IČO dál. V kódu jsou to dvě funkce: `privacyPublished` a `legalPublished`.
- **Proč to nepočkalo na firmu:** aplikace už veřejně běží a sbírá e-mail, jméno, telefon a přibližnou polohu. Informační povinnost se váže na okamžik sběru, ne na založení živnosti. Nechat veřejnou aplikaci sbírat údaje úplně bez zásad je horší než je zveřejnit na fyzickou osobu a po založení firmy je překlopit na novou verzi.
- **Jedna věta o správci místo tří polí.** Text měl natvrdo „IČO {{ico}}, místo podnikání {{sidlo}}“, což by bez IČO vykreslilo „IČO —“. Nově je to jeden údaj `{{spravce}}`, který IČO vynechá, dokud žádné není. Verze textu zůstává 1.0, protože pravidlo o nové verzi platí pro změnu **zveřejněného** textu a tenhle zveřejněný nikdy nebyl.
- **Patička odkazuje jen na to, co platí.** Dřív vypisovala všechny tři dokumenty; teď jen ty s účinnou verzí, aby odkaz nevedl na „Tento dokument právě připravujeme“. Řádek o živnostenském rejstříku se ukáže až s IČO.

## Šablony WhatsAppu zakládá funkce — 20. 9. 2026

- Znění pěti šablon je v `supabase/functions/_shared/whatsapp.ts` vedle odesílání, ne jen v dokumentaci. Pořadí parametrů drží `claim_whatsapp_deliveries` v SQL a `templateMessage` v odesílání; kdyby text žil jen ve WhatsApp Manageru, jedna úprava by tiše rozhodila údaje ve zprávě. Unit test hlídá, že `{{n}}` v textu sedí s počtem ukázek.
- Zakládá je admin funkce `whatsapp-templates-setup` přes Graph API, ne člověk v prohlížeči: WhatsApp Manager v Chromu 18. i 19. 9. po každém kroku zamrzal a neuložil jedinou šablonu. Stejný vzor jako `stripe-webhook-setup` — klíč zůstává v Supabase secrets, v odpovědi nikdy není.
- Šablonu, která už u Mety je, funkce nepřepisuje, jen vrátí její stav (APPROVED, PENDING, REJECTED). Přepsání schválené šablony znamená nové schvalování, a to není nic, co by měl spustit omylem jeden dotaz.
- Spouští se z administrace (**Nastavení**, `/admin/nastaveni`), ne z příkazové řádky. Funkce běží pod přihlášením admina, takže jinak by ji nešlo zavolat bez ručně vyrobeného tokenu — a token od Mety by musel někdo přenášet. Takhle zůstává v Supabase secrets a v prohlížeči se objeví jen názvy šablon a jejich stav.
- Název šablony si může přebít tajný klíč z `TEMPLATE_SECRETS`. Kdyby Meta nějaký název zamítla, založí se pod jiným a odesílání se přenastaví změnou secretu, bez zásahu do kódu.

## Detail nabídky: barva nese význam — 21. 9. 2026

- Den termínu (**Dnes**, **Zítra**) je pilulka v barvě značky, ne šedý text. Je to první otázka, kterou si člověk u FLEKu klade, a jako 12px metadata vedle bledé ikony se ztrácela.
- Barvy na stránce něco znamenají, nejsou dekorace: ultramarín = kdy a kde (den, špendlík, mapa), zelená = peníze, které zákazníkovi zůstanou (sleva, úspora, zrušení zdarma), jantarová = poslední místo. Proto je sleva u času zelený čip a ne šedý.
- V kartě času je hodina vlevo a cena vpravo. Jako první čip řádku stála cena na každé kartě jinde, takže porovnat dva časy znamenalo číst dva řádky čipů místo jednoho sloupce.
- Pořadí v kartě „Tvůj termín“: kdy → kolik → jak naspěch → jiné časy. Seznam časů byl nad cenou, takže cena a úspora vybraného termínu začínaly na mobilu pod ohybem.
- Bloky pod kartou („O službě“, „Kde to je“, „Zrušení zdarma“) jsou karty s barevnou ikonou. Holé nadpisy nad vlasovou linkou na šedé ploše nedávaly oku kde skončil jeden předmět a začal druhý.
- Spodní lišta na mobilu nese jen cenu a tlačítko. Úsporu říká karta nad ní; v liště byla potřetí v jednom výřezu obrazovky a stála 20 px výšky tam, kde jich je nejmíň.

## Mapa bez shluků a kompaktní náhled — 21. 9. 2026

- Oddálená mapa nezamění nabídky za čtverec s číslem. Každá provozovna zůstane samostatným FLEK špendlíkem; blízké body se deterministicky rozestoupí kolem skutečné polohy. Jen termíny na přesně stejné adrese sdílejí bod a malý počet.
- Náhled na telefonu má pevnou výšku 136 px a ukazuje jen fotografii, službu, podnik, nejbližší čas a konečnou cenu. Celá karta vede na detail. Toto rozhodnutí nahrazuje plnou rezervační kartu z 20. 9.; ta zakrývala příliš velkou část mapy a opakovala údaje z detailu.
- Krátký vodorovný pohyb nad 32 px posune carousel přesně o jednu službu. CSS snap a šipky klávesnice zůstávají jako stejné ovládání pro dotyk, myš i klávesnici.

## Ověřené recenze a fail-closed moderace — 21. 9. 2026

- Hvězdičky z dokončené rezervace se zveřejní hned a průměr se dál počítá z rezervací. Nepovinný komentář se veřejně ukáže až po schválení a nikdy s identitou zákazníka; veřejný záznam nese jen službu, datum a „Ověřená návštěva“.
- Žádost o hodnocení je jedna idempotentní událost `review_requested`: vždy v aplikaci, push jen podle preference, bez e-mailu a WhatsAppu. Upozornění vede přímo na formulář konkrétní rezervace.
- Názvy a popisy podniků a služeb, jejich vlastní fotografie a text recenze jsou fail-closed. Bezpečný výsledek se aplikuje serverově; označený, nejasný nebo nedostupný zůstane neveřejný v admin frontě. Poslední schválená verze se při čekání nemění.
- Automatická kontrola používá `omni-moderation-latest`; OpenAI dostane jen obsah určený ke zveřejnění, ne adresu, kontakt, cenu ani fakturační údaje. Adminské rozhodnutí se auditovaně aplikuje nebo zamítne.
- `private.settings` a `private.stripe_events` mají RLS bez klientských politik a odebrané klientské granty. Serverové funkce s pevnou autorizací zůstávají jedinou cestou.
- WhatsApp má samostatný serverový příznak dostupnosti. Ovládání se nezobrazí jen proto, že v prostředí existuje část klíčů; aktivuje se až po webhooku, schválených šablonách a úspěšné testovací zprávě.

## Barevný panel nabídky — 21. 9. 2026

- Spodní panel na fotografii má vlastní jemně ultramarínové sklo místo neutrální bílé desky. Vysoký podíl bílé drží kontrast malých metadat, modrý nádech a horní světelná linka ho vizuálně spojují se značkou FLEK.
- Konečná cena je jediný plný prvek panelu a používá hlavní ultramarín. Červené přeškrtnutí původní ceny zmizelo: červená v aplikaci patří chybě a zamítnutí, ne běžné cenové informaci.
- Ikony polohy a délky i čipy dalších časů používají tlumenou brandovou modrou. Panel tak má jednu barevnou logiku a nepřidává další soutěžící barvu ke slevě v horním rohu fotografie.

## Mapa, sklo a karta termínu — 22. 9. 2026

Nahrazuje rozhodnutí „Kompaktní FLEK body při oddálení“ z 21. 9., které řešilo totéž, ale hranicemi přiblížení a stropem 100 řádků.

- Mapa se přepne ze špendlíků na body podle skutečné hustoty, ne podle pevné hranice přiblížení: nejdřív se rozloží plné špendlíky, a když jediný z nich nenašel volné místo, překreslí se všechny jako body. Pevná hranice by při řídkém výsledku zbytečně schovala ceny a při hustém pohledu nad svou horní mezí by nestačila. Rozhodnutí vychází ze vzdáleností na obrazovce, které se posunem mapy nemění, takže posouváním neblikají.
- Vybraný termín zůstává plným špendlíkem s cenou, místo aby se kompaktní bod rozbaloval zpět. Ušetří to čtyřicet řádků CSS, které přepisovaly to, co už výchozí špendlík umí.
- Bod je prostý kotouč bez ikony oboru: při 13 px uvnitř 24 px kolečka není ikona čitelná (porovnáno vykreslením osmi kandidátů ve 4× měřítku). Víc termínů na jedné adrese pozná podle aury, ne podle číslíčka.
- Rozmisťování počítá s dotykovou plochou bodu (44 px), ne s kolečkem (20 px). Klepnutí na bod musí otevřít ten bod, ne jeho souseda.
- Mapa si říká o víc řádků ze stejného RPC, místo aby dostala vlastní funkci. „Rezervovatelné“ má zůstat jedna definice v SQL; druhá čtecí funkce by byla druhá odpověď na stejnou otázku. Strop není 100, ale 300 — migrace `20260921212301` zvedla mez ve validaci `search_offers`, protože při 100 řádcích dosáhlo řazení „nejblíž“ jen na 6 podniků ze 16. Je to pilotní kompromis, ne řešení pro velký katalog (viz LIMITATIONS.md). Feed zůstává na 50: tam se výsledky čtou postupně a víc řádků by jen prodloužilo stránku.
- Panel s fakty na kartě nabídky nemá vlastní materiál. Předchozí varianta s přelivem, vnitřním odleskem, barevným stínem a přechodovou linkou vyšla neprůhledná — tolik efektů kvůli bílé desce. Jedno sklo `.glass` pro celou aplikaci; barva značky nese význam (cena, časy), ne plochu.
- Vybraný čas se v seznamu jiných časů neopakuje. Blok nad seznamem ho popisuje celý, takže jeho karta v seznamu opakovala šest údajů na jedné obrazovce. Nahoře „tvůj termín“, dole „místo něj“.

## Detail služby vybírá den a potom čas — 22. 9. 2026

- Vybraný FLEK má jeden souhrn s termínem, délkou, cenou, slevou a úsporou. Stejný termín se už pod ním nevykresluje jako další volba.
- Alternativy se na telefonu vybírají ve dvou krocích: záložka dne a kompaktní dvousloupcové dlaždice časů. Cena zůstává u každého času, protože se mezi FLEKy může lišit; délka je společná a zůstává v souhrnu.
- Pevná mobilní akce obsahuje jen cenu a „Chytit FLEK“. Platební režim a pravidla zrušení jsou vysvětlené v detailu a potvrzovacím kroku; jejich opakování pod tlačítkem zvyšovalo lištu a překrývalo výběr časů.

## Skutečné fotografie a kratší detail — 23. 9. 2026

- Následná úprava rezervačního bloku: plnou barvu značky má pouze souhrn vybraného termínu. Dny používají podtržení a ostatní termíny jemný podklad bez obrysů a opakovaných slev. Počty možností zůstávají v přístupném názvu dne, aby vizuálně nesoutěžily s cenou. Výběr dne je skupina běžných přepínacích tlačítek ovladatelných Tab/Enter, nikoli neúplný ARIA tablist.

- Původní generovaná knihovna z 20. 9. je nahrazená ověřenými skutečnými fotografiemi. Každá použitá fotografie má v manifestu zdroj, autora a licenci. Pokud snímek neukazuje věrohodně danou aktivitu, použije se neutrální FLEK; nepřiřazujeme obrázek podle pouhé podobnosti kategorie.
- Migrace mění jen přesně známé staré katalogové adresy. Vlastní fotografie ve Storage nikdy nepřepisuje a ve všech zobrazeních má přednost. Poškozené nebo nedostupné URL končí stejným neutrálním placeholderem.
- U detailu má fotografie na telefonu 180 px a rezervace tvoří jediný souvislý blok. Vybraný termín a jeho cena jsou nahoře, další volby pod nimi. Spodní akce používá barvu značky. Mapa se na telefonu načte až po výslovném otevření, protože dříve prodlužovala stránku před rozhodnutím o rezervaci.
- Obecné ukázkové popisy a text provozovny se nevykreslují jako popis konkrétní služby. Konkrétní informace o službě zůstávají viditelné.

## Poloha a hlídač FLEKů — 24. 9. 2026

- Tečka polohy se na mapě zapne sama jen tehdy, když prohlížeč polohu už povolil; jinak až po klepnutí na „Moje poloha“. Dotaz na polohu hned při otevření mapy učí lidi klepat na „Blokovat“.
- Tečka má kruh nejistoty v metrech. Telefon uvnitř budovy bývá o desítky metrů vedle a tečka bez kruhu by tvrdila přesnost, kterou nemá. Poloha zůstává v prohlížeči; server ji nevidí, dokud si zákazník nezaloží hlídač.
- Hlídač měří dojezd v minutách, ne v kilometrech, protože tak lidé přemýšlejí („do 20 minut pěšky“), ale počítá vzdušnou čarou a v aplikaci to říká („zhruba 1,5 km vzdušnou čarou“). Routovací služba by znamenala klíč, cenu a novou externí doménu kvůli číslu, které je stejně odhad.
- Skenuje se v databázi cronem po 5 minutách, ne triggerem při zveřejnění nabídky: víc termínů naráz (typicky celý den jednoho podniku) přijde v jedné zprávě, a brzdy (15 minut, šest denně, noční klid) se hlídají na jednom místě.
- Ohlašuje se jen to, co přibude po založení nebo přesunu hlídače. Co v okolí už je, zákazník vidí na mapě ve chvíli, kdy hlídač zakládá; zahltit ho hned první zprávou by hlídač zabilo.
- Místo hlídače se ukládá zaokrouhlené na tři desetinná místa (asi 100 m). Pro okruh v kilometrech víc netřeba a přesná adresa bydliště na serveru nemá co dělat.
- Filtr hlídače se předvyplní z filtru nad mapou a ve formuláři je sbalený do jednoho řádku se souhrnem: většina lidí ho nemění a čtyři další přepínače by okno na telefonu zdvojnásobily.

## Revize hlídače, firemní špendlíky, Upozornění a prázdné Rezervace — 24. 9. 2026

- **V noci hlídač mlčí a ráno pošle souhrn.** Dřív v noci zapsal zprávu jen do zvonku a FLEK označil jako ohlášený, takže ráno o něm zákazník nevěděl, a push v noci by budil. Od 22 do 7 se nic nezapíše ani neoznačí; první sken po sedmé najde všechno, co přibylo a je pořád volné, a pošle jednu zprávu. Co mezitím zmizelo, ráno k ničemu není.
- **Brzda 15 minut místo 30.** FLEK na poslední chvíli bývá pryč za pár desítek minut; půl hodiny čekání na další zprávu znamenalo ohlásit ho, až už nebude. Šest zpráv denně na hlídač zůstává jako strop proti zahlcení.
- **Sleva patří do zprávy.** „490 Kč (−38 %)“ je důvod FLEK otevřít; samotná cena bez srovnání nic neříká.
- **O oznámení se prohlížeč zeptá při uložení hlídače, ne v Profilu.** To je jediná chvíle, kdy zákazník rozumí, proč ho žádáme; dotaz musí být první věc, kterou klepnutí udělá, jinak ho prohlížeč zahodí. Odmítnutí hlídač nezastaví, zprávy jen počkají ve zvonku. Stejně tak poloha: okno hlídače se na ni zeptá samo, místo aby posílalo zákazníka zpátky na mapu.
- **Hlídač se nabízí tam, kde zákazník nic nenašel** — v prázdném Objevit, na jeho konci a v prázdných Rezervacích — a jen tehdy, když žádný neběží; jinak řádek „Hlídač běží“. Druhá pozvánka by vypadala, jako že první nefungovala.
- **Smazání účtu maže hlídače výslovně.** `delete_my_account` řádek v `auth.users` anonymizuje, nemaže, takže `on delete cascade` z hlídačů nikdy neproběhne; zásady přitom slibují smazání se smazáním účtu. Každá nová tabulka s osobními údaji musí do `delete_my_account` přibýt ručně.
- **Firemní špendlík místo tečky při oddálení.** Nahrazuje „Bod je prostý kotouč“ z 22. 9.: tečky vypadaly jako chyba vykreslení a nebylo z nich poznat, že jde o FLEKy. Kapka s ciferníkem z loga (26 × 33 px) je čitelná i v hustém pohledu; ikona oboru v ní dál není, při téhle velikosti by čitelná nebyla. Dotyková plocha i rozmisťování zůstávají na 44 px, vybraný termín je plný špendlík s cenou.
- **Upozornění v Profilu jsou zavřený řádek s tabulkou.** Blok s nadpisem a zaškrtávátky pro každou událost zabíral půl obrazovky, přitom ho člověk otevře jednou. Zavřený řádek řekne, kam zprávy chodí; tabulka událostí × kanálů ukáže totéž na třetině místa a každé zaškrtávátko má celý popis pro čtečku obrazovky. WhatsApp je ve stejném řádku, protože je to jen další kanál.
- **Prázdné Rezervace ukazují, co tu bude, a co jde udělat hned.** Náhled rezervační karty s tmavým pruhem kódu vysvětlí bez textu, k čemu záložka je; tečky místo kódu, žádný vymyšlený kód ani podnik. Pod ním skutečné volné FLEKy v okolí ze stejného hledání jako Objevit — prázdná obrazovka s jedním tlačítkem posílala zákazníka jinam, lišta mu dá rezervovat rovnou. Toto hledání se nezapisuje jako `search_performed`, protože ho zákazník nezadal.

## Úvod pro zákazníky a podniky, běžná cena u každé ceny — 24. 9. 2026

- **Úvod popisuje aplikaci, jak je dnes, ne jak byla.** Čtyři kroky v pořadí první návštěvy: co je volné kolem tebe, cena proti běžné, rezervace, hlídač. Obrázky kreslí to, co zákazník pak skutečně uvidí: tečku „Tady jsi“ a špendlíky mapy, kód ve tvaru `FLEK-` a šest znaků, oznámení hlídače slovo od slova podle `public/sw.js`. Ukázková data (služby, čtvrti, ceny) jsou ilustrace bez jmen podniků.
- **Věta o rezervaci platí v obou režimech potvrzování.** „Potvrzení s kódem máš do pár minut, když podnik nepotvrdí, nic neplatíš“ je pravda s ručním potvrzováním (`manual_confirmation_enabled`) i bez něj, takže úvod nemusí číst serverové nastavení.
- **Klíč `flek.intro.v1` zůstává.** Úvod je pro nové zákazníky; kdo ho zavřel, nemá ho dostat znovu jen proto, že přibyl krok. Nový identifikátor by navíc znamenal úpravu zásad.
- **Stránka pro podniky vychází z podmínek pro podniky, ne z marketingu.** Každý krok (7 dní dopředu, 3–10 minut na potvrzení, blokace do potvrzení, celá částka i při nedostavení, výplata přes Stripe) je v `podminky-podniky.md`. Ukázka žádosti o rezervaci je kopie karty z přehledu se vzorovými hodnotami, bez jména zákazníka.
- **Běžná cena u každé ceny, kterou zákazník vidí, kromě špendlíků na mapě.** Sleva je důvod, proč FLEK existuje, a zákazník ji má mít na očích i v náhledu na mapě, u dalších časů, v platebním okně a ve svých rezervacích (tam ze snímku při rezervaci). Vždy stejně: přeškrtnutá, malá a tlumená, s červenou linkou (`OriginalPrice`), aby nekonkurovala ceně, kterou zákazník platí. Špendlík na mapě ji nenese: druhá částka by ho rozšířila skoro na dvojnásobek (šířka se počítá z délky popisku), rozmístění by dřív přepínalo na malé firemní špendlíky a ceny by zmizely úplně. Běžnou cenu špendlíku říká jeho popis pro čtečku a ukáže ji náhled po klepnutí.

## Průvodce pro podniky — 24. 9. 2026

- **Průvodce, ne prohlídka.** Nic se samo neotevírá a nic nepřekrývá stránku: žádná okna ani bubliny s „dalším krokem“. Průvodce je karta na Přehledu, rozbaluje jen jeden krok, který jde udělat teď (proč a tlačítko), zbytek je řádek. Kdo ví, co dělá, může skočit na kterýkoli krok rovnou.
- **Průvodce sám odejde.** Mizí, jakmile jsou hotové povinné kroky. Doporučené řádky ho nikdy nedrží; starý seznam měl „Zobrazit jako zákazník“ mezi povinnými, takže u podniku, který svou stránku neotevřel, visel napořád.
- **Povinné kroky kopírují server.** Zveřejnění hlídá `publish_flek`: schválený podnik, Stripe s povolenými platbami (`require_payments_ready`), aktivní služba. Tlačítko „Přidat volný termín“ se ukáže jen tehdy; dřív otevřelo formulář, který skončil chybou `STRIPE_NOT_CONNECTED` nebo „nejdřív přidejte službu“. Údaje pro výplaty jsou krok navíc, protože bez IČO podnik neschválíme a bez účtu nejsou výplaty.
- **Nový podnik vidí jen průvodce.** Tři nuly a dva prázdné seznamy rezervací odsouvaly jedinou věc, kterou má udělat, pod ohyb. Přehled se ukáže celý po prvním FLEKu.
- **Nápověda jen na vyžádání.** „Jak FLEK funguje“ (kroky, ukázka žádosti, lhůty, peníze, kontakt) je v postranním panelu, v nabídce „Další“ a v průvodci, nikdy se neotevře sama. Kroky i ukázka žádosti jsou stejné jako na stránce pro podniky před registrací (`PartnerHelp.tsx`), aby podnik po registraci nečetl jiný příběh.
- **Žádný nový záznam v prohlížeči.** Průvodce počítá stav ze serveru a ze zařízení (oznámení); jediný uložený údaj je dosavadní `flek.merchant.previewed.<id>`. Zásady se proto nemění.

## WhatsApp: stav a dokončení z administrace — 24. 9. 2026

- **Stav kanálu se čte od Mety, ne odhaduje.** Rozšířená `whatsapp-templates-setup` vrací, které tajné klíče jsou vyplněné (jen jména), co Meta ví o čísle (`display_phone_number`, `verified_name`, `name_status`, `webhook_configuration`), kdo odebírá zprávy účtu (`/{WABA}/subscribed_apps`) a profil. Administrace z toho skládá kontrolní seznam; hodnoty klíčů ani token do prohlížeče nejdou.
- **Webhook se v konzoli Mety nastavuje ručně.** Přes API by to šlo jen tokenem aplikace (`{app-id}|{app-secret}`) nebo náhradní adresou u účtu, která podle Mety předpokládá už fungující odběr; obojí bez možnosti to odsud vyzkoušet. Panel proto ukáže přesnou adresu ke zkopírování a ověří výsledek.
- **Číslo FLEKu bere admin od Mety.** Tlačítko uloží přesně to číslo, které Meta vrátila, v E.164, přes auditovanou `admin_set_whatsapp_display_number`; dřív ho agent psal ručně SQL podle zprávy v chatu.
- **Profil ve stejných slovech jako aplikace.** Texty profilu jsou v kódu funkce bez oslovení (čte je zákazník i podnik) a říkají pravdu: na běžné zprávy se neodpovídá, rezervace jsou v aplikaci. Fotka profilu a ikona aplikace se generují z `public/icon-maskable.svg`, takže v kruhovém ořezu zůstane celý špendlík.
- **Zpřístupnění zůstává ruční.** Tlačítko se odemkne až při zeleném stavu (číslo uložené, webhook míří na FLEK, odběr, všechny šablony schválené, povinné klíče), ale kanál zapne až člověk po vlastní zkoušce na telefonu.
- **Funkci pro WhatsApp smí volat i databáze.** Aby šlo nastavení dokončit bez přihlášení v prohlížeči, přijímá `whatsapp-templates-setup` kromě JWT admina i tajný klíč workeru z `private.notification_config` (stejně jako `notification-delivery` a `content-moderation`). Brána proto JWT neověřuje (`verify_jwt = false`); funkce ověří jedno nebo druhé sama a bez toho vrátí 403. Neplatný JWT neprojde, protože `is_admin()` přes PostgREST podpis ověří. Token Mety ani App Secret funkci nikdy neopustí; webhook aplikace se nastavuje tokenem aplikace `ID|App Secret` jen uvnitř funkce.
- **Webhook a logo tlačítkem, ne v konzoli Mety.** Webhook aplikace se nastavuje přes `/{app}/subscriptions` tokenem aplikace a logo přes nahrávací API Mety (sezení u aplikace, soubor, handle do profilu). ID aplikace funkce zjistí z tokenu (`/app`), takže ho nikdo nezadává. Seznam odběrů účtu k tomu nestačí: u testovacího čísla je v něm i aplikace Mety „WA DevX Webhook Events 1P App“ a první verze funkce by vzala ji. Logo je `public/icon-maskable-512.png` z webu FLEKu: čtverec bez průhlednosti s celým špendlíkem uvnitř kruhového ořezu, stejný jako ikona na ploše telefonu.
- **CORS i u funkce pro WhatsApp.** Panel ji volá z www.app-flek.eu na doméně Supabase; bez odpovědi na předletový dotaz ji prohlížeč vůbec nezavolal. Hlavičky jsou sdílené s ostatními funkcemi volanými z aplikace (`_shared/stripe.ts`) a povolují jen adresy FLEKu.
- **Šablony věcně jako potvrzení transakce.** Meta zamítla `flek_business_confirmed` jako `INCORRECT_CATEGORY` („Máte novou potvrzenou rezervaci… Vy dostanete: 586 Kč“ podle ní zní jako nabídka). Nové znění „Rezervace na {{1}} je potvrzená… Částka k výplatě: {{3}}“ drží stejné parametry ve stejném pořadí, takže se nemění `claim_whatsapp_deliveries` ani názvy v Supabase. Zamítnutá šablona se upravuje pod stejným názvem (`POST /{id}`), ne zakládá znovu.
- **Token Mety musí být trvalý.** Dočasný token z „API Setup“ nebo Graph Exploreru přestane platit po 24 hodinách nebo odhlášením z Facebooku; 24. 9. právě proto WhatsApp nejel. Do Supabase patří token systémového uživatele s platností „Nikdy“.
