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
- Barevnost je odvozená z loga: značková tyrkysová kreslí znak, tmavší odstín je vyhrazený pro hlavní CTA. Slevový odznak je tmavý, aby s CTA nesoutěžil.
