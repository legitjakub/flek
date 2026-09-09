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
- Hodnocení stojí na `bookings.rating`, ne na samostatné tabulce recenzí. Hodnotit tak může jen ten, kdo má vlastní dokončenou rezervaci — omezení vynucuje datový model, ne aplikace. Průměr se počítá v dotazu; denormalizovaný čítač je jen další věc, která se může rozejít s pravdou.
- Hodnocení se zobrazuje až od tří kusů. Jedna pětihvězdička vypadá jako autorita, i když není.
- Sekce na objevování se musí zasloužit: až od šesti nabídek celkem a jen se dvěma a více položkami. Prázdný karusel je horší než poctivý seznam a pilot začíná s hrstkou termínů.
- Náhled nabídky nad mapou zůstal plovoucí kartou, ne modálním sheetem. Modál by zakryl mapu, ve které si uživatel právě vybírá.
- Mezikrok „Hotovo" po zveřejnění termínu zmizel. Potvrzení patří na stránku za sheetem; jinak partner platí klepnutím navíc za informaci, kterou už vidí.
- Platí se předem přes FLEK, ne na místě. Sedadlo se vydá až proti vypořádaným penězům: `create_booking` odmítne cokoli jiného než platbu ve stavu `paid` a částku porovná s cenou v nabídce, takže změna ceny mezi zaplacením a rezervací nemůže zákazníka přeplatit.
- Poskytovatel platby je za tabulkou `payments`. Ukázka vypořádává přes `demo_confirm_payment`, skutečná brána bude tentýž řádek označovat z webhooku pod service role. Nic jiného ve schématu se tou výměnou nezmění.
- Jedna vypořádaná platba koupí právě jedno sedadlo — hlídá to částečný unikátní index `bookings_one_per_payment`, ne aplikace.
- Zrušení v bezplatném okně vrací celou částku. Storno po lhůtě je odmítnuté už dřív, takže „vrátit jen část" nemá kdy nastat. Výplaty podnikům a provize řeší pilot mimo aplikaci; Stripe Connect je mimo rozsah.
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
- Několik činností v kategorii sdílí jeden snímek záměrně. Jedna pravdivá fotografie je lepší než dvě, z nichž jedna je špatně; kdo chce vlastní prostředí, nahraje si vlastní fotku.
- Výběr se sleduje podle činnosti, ne podle fotky. Porovnávání přes `image_url` rozsvítilo všechny dlaždice, které snímek sdílejí — výběr „Dámský střih" vypadal, jako by bylo vybráno čtvero.
- Název doplněný výběrem jde opravit dalším výběrem, název napsaný rukou ne. Partner, který se překlikne, potřebuje opravit obojí; partner, který prodává „Pánský střih s mytím", chce jen tu fotku.

