# Prompt pro AI: modernizace celé aplikace FLEK

Jsi seniorní produktový designér a frontendový inženýr. Proveď promyšlený redesign existující aplikace FLEK a implementuj jej přímo v projektu. Nestačí přebarvit tlačítka: zlepši vizuální hierarchii, práci s prostorem, srozumitelnost nabídek a ovládání na telefonu i desktopu.

## 1. Produkt a cíle

FLEK, v původním zadání nazvaný VOLNO, je české tržiště zlevněných volných termínů na poslední chvíli. Nabízí například střih, masáž, kosmetiku, sport a jógu. Pracujeme s konkrétním termínem, místem a cenou. Zákazník platí na místě.

Dva hlavní toky:
- Zákazník najde vhodný termín poblíž, zarezervuje jej do 60 sekund a dostane rezervační kód.
- Partner se založenou službou zveřejní volný termín do 30 sekund, nejvýše pěti klepnutími a jedním zadáním ceny.

Každou změnu posuzuj podle toho, zda pomáhá těmto tokům a následné docházce. Zachovej současný název FLEK, existující logo se symbolem polohy a hodin i identifikátory rezervací. Všechny texty v rozhraní jsou česky: zákazníkům tykáme, partnerům vykáme.

## 2. Nejdříve prozkoumej skutečný projekt

Přečti README, DECISIONS, LIMITATIONS, VERIFICATION a původní BUILD_BRIEF v docs. Pokud staré zadání obsahuje VOLNO, aktuální značka v projektu je FLEK.

Spusť aplikaci a zachyť výchozí stav hlavních obrazovek na telefonu i desktopu. Projdi zákaznickou část, detail, rezervaci, mapu, profil, partnerskou část i administraci. Rozlišuj skutečně ověřené chování od tvrzení ve starších dokumentech. Neoznačuj historicky uvedené výsledky testů za vlastní nová měření.

Při auditu se zaměř na konkrétní současné slabiny:
- Nabídky používají image_url/cover_url, ale zdokumentovaný seed fotografie nemá. Velké náhradní plochy s logem zvyšují vizuální prázdnotu.
- Objevování obsahuje několik vodorovných řad podobně stylovaných filtrů a další řadu aktivních filtrů.
- Úzké OfferTile karty používají drobný text a ořezávají názvy. Dvě horizontální kolekce znesnadňují porovnání více termínů.
- Zákaznická část má na desktopu převážně šířku max-w-3xl, detail max-w-2xl. Širší obrazovka potřebuje vlastní kompozici.
- Kategorie, časové volby, filtry a štítky mají podobný vzhled. Není zřejmá jejich rozdílná úloha.
- CustomerShell a detail nabídky mají samostatné pevné spodní lišty. Ověř překrytí navigace a rezervačního tlačítka; řeš je společným pravidlem rozložení.
- Mapa nyní začíná s vlastními filtry. Přechod seznam ↔ mapa má zachovat uživatelův výběr.

Tyto body ověř proti aktuálním souborům; pokud už byly opravené, neopakuj práci.

## 3. Reference a jejich použití

Prohlédni si aktuální produktové obrazovky a oficiální reference:
- Fresha: https://www.fresha.com/ — inspirace pro srozumitelný výběr služby, lokality a času a prezentaci služby.
- Treatwell: https://www.treatwell.co.uk/ — inspirace pro objevování služeb a vysvětlení cenově výhodných last-minute/off-peak termínů.
- Booksy Biz: https://biz.booksy.com/features/calendar-scheduling — inspirace pro rychlé přečtení nadcházejících rezervací a ovládání partnerské části na telefonu.

Převezmi pouze vhodné principy interakce a hierarchie. Nepřebírej jejich značky, texty, fotografie ani celé rozložení. Nepřidávej jejich věrnostní programy, hodnocení, platby, čekací listiny nebo rozsáhlý kalendář. FLEK má vlastní identitu a výrazně užší účel. Když referenci nelze otevřít, přiznej to a pokračuj z dostupných podkladů.

## 4. Jeden závazný vizuální směr

Navrhni klidnou, sebevědomou městskou aplikaci. Prémiový dojem vytvoř kvalitním obsahem, čitelnou typografií a přesným zarovnáním. Rozhraní musí fungovat stejně dobře pro barber shop, jógu i sport.

- Zachovej Manrope a stávající tyrkysovou identitu. Použij světlý neutrální podklad, bílé plochy a tmavý text. Aktuální tokeny jsou vhodným základem: surface #f6f8f8, ink #253130, brand #17beb2, primary #0a6a62.
- Jasný tyrkys ponech logu; pro hlavní tlačítka použij kontrastní tmavší odstín. Výrazné barevné plochy soustřeď na hlavní akci.
- Základní text 16 px; důležité údaje a ovladače nejméně 14 px. Velikost 12 px jen pro skutečně vedlejší metadata. Cena a začátek termínu nesmí být drobné.
- Nadpisy 24–32 px, výraznější cena 24 px, konzistentní váhy písma. Časy, ceny a kódy používají tabulární číslice.
- Rozestupy odvozuj z 4/8px systému; karty přibližně 16px rohy, tlačítka 12px. Kruhové kapsle používej jen tam, kde pomáhají rozpoznat filtr.
- Jedna úroveň jemného stínu. Oddělení sekcí vytvářej hlavně rozestupy a hierarchií, ne dalšími rámečky uvnitř karet.
- Ikony ze stávajícího Lucide používej funkčně a konzistentně, vždy s textem tam, kde význam není samozřejmý.
- Odstraň dekorativní gradienty a rozmazaná skla. Bez animovaných pozadí, emoji, reklamních carouselů a falešných statistik.
- Krátké přechody kolem 150–200 ms pouze pro zpětnou vazbu; respektuj prefers-reduced-motion.

Charakteristickým prvkem FLEK bude snadno čitelná dvojice konkrétní čas + skutečná cena. Sleva ji doplňuje, nepřekřikuje.

## 5. Zákaznická aplikace

### Objevování a karty

Zachovej krátkou hodnotovou větu „Volné termíny v okolí, levněji.“ a editovatelnou lokalitu. První obrazovka má ukázat reálnou nabídku bez nutnosti projít marketingovým úvodem.

- Nad výsledky zobraz nejvýše dvě kompaktní řady ovládání: časový výběr s tlačítkem Filtry a kategoriální navigaci. Denní dobu, cenu, okruh a podrobné řazení přesuň do přehledného panelu filtrů.
- Kategorie vizuálně odliš od filtrů, například textovými záložkami. Aktivní omezení zobraz stručně a umožni je snadno zrušit; neduplikuj stejnou informaci v několika řadách.
- Hlavní výsledky zobraz na mobilu jako celou šířku zabírající přehledné karty. Služba může mít dva řádky; neusekávej rozhodující část názvu. Fotografie má jednotný rozměr a stabilní místo.
- Anatomie karty: služba → provozovna a čtvrť → výrazný den a čas → délka a vzdálenost → výrazná výsledná cena, vedlejší původní cena a klidný údaj o slevě. Celá karta otevírá detail; uvnitř nesmí být konfliktní vnořené odkazy.
- Ukázkový obsah: „Pánský střih“, „Dnes 18:30“, „45 min · 800 m“, „390 Kč“, původně „650 Kč“, „−40 %“. Za běhu používej skutečná data.
- „Poslední místo“ pouze při capacity_remaining = 1 a capacity_total > 1. Žádná umělá naléhavost.
- Upřednostni snadné porovnání před několika horizontálními kolekcemi. Při aktivním filtru nebo explicitním řazení zobraz jednotný seznam respektující serverové pořadí. Nabídky neduplikuj mezi sekcemi.
- Zachovej poctivé vysvětlení rozšíření vyhledávání a užitečný prázdný stav. Nerozšiřuj potichu jiné uživatelovy filtry.

Na desktopu použij hlavní plochu přibližně do 1200 px a podle prostoru dvě až tři kolony. Mobilní navigaci Objevit · Mapa · Rezervace · Profil zachovej, doplň funkční ikony; na desktopu přesuň tyto odkazy do horní navigace.

### Fotografie

Použij existující oprávněně dostupné fotografie provozoven. Bez fotografie navrhni záměrnou kompaktní kartu s důrazem na text a čas; nevytvářej velký prázdný reklamní panel. Pro fiktivní demo lze doplnit licenčně použitelné ilustrační fotografie do oddělených demo podkladů a uvést původ. Nevydávej ilustrační nebo generovaný interiér za skutečnou provozovnu. Neočekávej, že každá nabídka bude mít fotografii.

### Detail, rezervace a historie

- Detail má rychle ukázat službu, konkrétní termín, místo, cenu a „Ušetříš 260 Kč“. Popisy a mapa následují až poté.
- Na mobilním detailu rezervuj spodní prostor pro jediné pevné CTA „Rezervovat za 390 Kč“ a „Platba na místě“. Běžnou spodní navigaci na této trase skryj; ponech jasný návrat. Ošetři safe area, otevřenou klávesnici a malé displeje.
- Na desktopu dej informace vlevo a přehled rezervace s CTA do pravého sloupce, který zůstává v zorném poli při posunu.
- Přihlášení zachová cílovou nabídku, telefon se doplní v rezervaci. Nepřidávej další potvrzovací kroky.
- Potvrzovací panel: co, kde, kdy, cena, podmínky zrušení a věta „Podnik ti termín drží. Když nemůžeš dorazit, zruš to prosím včas.“ Hlavní tlačítko „Potvrdit rezervaci“ je při odesílání uzamčené.
- Úspěch má dominantní skutečný rezervační kód, termín, adresu a akce Navigovat / Zobrazit rezervaci. Historie a stav rezervace se musí načíst po obnovení stránky.
- Moje rezervace rozděl na Nadcházející / Historie. Kód a čas jsou nejvýše v hierarchii. Storno od podniku vysvětli včetně skutečného důvodu.
- Profil a přihlášení uprav ve stejném systému, s viditelnými popisky a chybami u polí.

### Mapa

Seznam a mapa sdílejí lokalitu a filtry, ideálně přes URL. Přepnutí je nezmění. Značky mohou ukazovat výslednou cenu; zvolená značka má jednoznačný stav a odpovídající náhled nabídky. Na mobilu náhled zobraz nad spodní navigací, na desktopu využij mapu vedle seznamu. Zachovej odložené načítání MapLibre.

## 6. Partner a administrace

Partner používá stejnou značku a typografii, ale úspornější pracovní rozložení.

- Přehled: dominantní „+ Přidat volný termín“, tři stručná dnešní čísla, nejbližší rezervace, poté docházka čekající na vyřízení. Hlavní obrazovku nezaplňuj grafy.
- Publikace zůstává jediný panel: služba, rychlá volba času, sleva −20 / −30 / −40 %, cena, publikovat. Více míst a uzávěrka zůstávají sbalené. Nepřidávej průvodce ani obrazovku náhledu navíc.
- Na telefonu udrž publikaci dosažitelnou palcem. Upozornění na souběžný termín a potvrzení publikace jsou stručné a čitelné.
- Nabídky a rezervace na desktopu skenovatelné řádky, na telefonu kompaktní karty. Každá akce musí mít jednoznačný kontext. Zopakovat, Upravit a Zrušit zachovají dnešní pravidla.
- „Zákazník dorazil“ a „Nedorazil“ musí být odlišitelné textem i stylem a dostupné až podle oprávnění serveru.
- Služby, provozovna a metriky používají stejná pole, rozestupy a zpětnou vazbu. Zachovej výnos ze skutečných dokončených rezervací.
- Desktop partnera může použít boční navigaci. Na mobilu upřednostni Přehled, Nabídky a Rezervace; ostatní existující sekce mohou být v přístupném menu Další.
- Administrace zůstává účelná: přehledná fronta, čitelné stavy, kontakty a jasné následky pozastavení. Neinvestuj do dekorací na úkor zákaznického a partnerského toku.

## 7. Technické hranice

Pracuj nad existujícími komponentami, routami a stackem React + TypeScript + Vite + Tailwind + TanStack Query + Supabase. Rozšiř společné tokeny a opakovaně použitelné komponenty. Nevytvářej druhý paralelní designový systém.

Zachovej RLS, RPC, autentizaci, ceny v celočíselných haléřích, čas Europe/Prague a serverovou autoritu nad dostupností. Nepřepisuj backend jen kvůli designu, neměň schéma ani nepouštěj reset hostované databáze. Prezentační změny smějí upravit rozložení a sdílení stavu filtrů, nikoli rozhodovat o rezervovatelnosti podle hodin zařízení.

Žádné mockové rezervace, smyšlené recenze, počty uživatelů, nová platební brána, chat, věrnostní program ani funkce P2. Započatý redesign neobchází existující nedokončené technické kontroly; ty pravdivě ponech v LIMITATIONS.

## 8. Provedení a důkazy

Nejdříve napiš stručný audit pěti největších problémů. Zvol výše uvedený směr a pokračuj implementací bez čekání na potvrzení rutinních rozhodnutí. Nejdříve ověř reprezentativní kombinaci Objevování → detail → rezervace → publikace partnera, potom ji důsledně rozšiř na zbytek aplikace.

Ověř:
- 375, 768 a 1280 px; žádné ořezané hlavní údaje a žádný nechtěný horizontální posun stránky. Overflow nezakrývej pomocí overflow-x:hidden jako náhradou opravy.
- Dotykové cíle nejméně 44 × 44 px, kontrast WCAG AA, viditelný focus, klávesnicové ovládání panelů a vrácení focusu po zavření. Změř i kontrast méně výrazných popisků.
- Každou hlavní obrazovku v běžném, prázdném, načítacím a chybovém stavu; detail také jako vyprodaný a rezervaci při výpadku sítě.
- Úplný zákaznický a partnerský tok, zachování filtrů při přepínání mapy, obnovení stránky a dlouhé české názvy.
- Skutečně změř čas publikace a počet klepnutí; odhad neuváděj jako výsledek měření.
- Produkční build, TypeScript a relevantní dostupné testy. Na discovery a detailu měř Lighthouse na produkčním sestavení se skutečným obsahem: výkon nejméně 80, přístupnost nejméně 90. Fotografie nesmějí způsobovat skoky rozložení.

Výstup: implementované změny, snímky před/po ve stejných rozměrech, stručné zdůvodnění zásadních rozhodnutí, skutečné výsledky kontrol a přesný seznam neověřeného. Neprohlašuj design za hotový, pokud zásadní části nebyly vykreslené a zkontrolované.
