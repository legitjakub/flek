# Co není hotové

Poctivý seznam. Nic z toho není obejité mockem ani vydávané za hotové.

## 1. `npm test` (lokální integrační sada) nespuštěná

Na tomto počítači není Docker ani PostgreSQL (`docker`, `colima`, `podman`, `limactl` ani `brew` nejsou k dispozici), takže lokální Supabase nešlo spustit a sada `tests/integration.test.ts` neběžela.

Migrace, seed i chování aplikace ale **jsou** ověřené proti skutečnému hostovanému PostgreSQL 17 s PostGIS — viz `npm run test:acceptance` (sada má nyní 76 kontrol), včetně souběžných rezervací a RLS. Obsahově se obě sady překrývají; lokální varianta navíc sahá přímo do databáze (`pg`), což hostovaná cesta neumí.

Na počítači s Dockerem stačí `npm ci && npm run db:start && npm run db:types && npm test`.

## 2. `src/types/database.ts` je psaný ručně

Zadání chce typy generované ze schématu. Soubor je zatím ruční, ale byl **porovnán položku po položce s výstupem generátoru ze živého schématu** — názvy, typy i nullabilita sedí, u `cover_url` a spol. je ruční verze přísnější (`string | null`) než generátor. `npm run db:types` ho kdykoli přepíše skutečně vygenerovanou verzí.

## 3. Ruční klikací průchod UI neproveden

Prohlížeč v tomto prostředí běží na skryté kartě, kde klikání spolehlivě nefunguje. Ověřené je vykreslení všech tras, filtry end-to-end a čtení stromu stránky; sekvence „dva prohlížeče vedle sebe" ze sekce 17 zadání ruční kontrolu ještě potřebuje. Také čas „pod 30 sekund" u zveřejnění nabídky zůstává nezměřený.

## 4. Demo účty v hostované databázi

Do hostovaného projektu je nahraný vývojový seed včetně účtů `demo-*@flek.test` se **společným heslem uvedeným v README**. Pro pilot s reálnými lidmi je potřeba seed odstranit a demo hesla neponechat. V nastavení projektu je také vypnutá ochrana proti prolomeným heslům (Supabase Auth → leaked password protection); před ostrým provozem ji zapněte.

## 5. Fotografie nabídek

Karty i detail počítají s `image_url` a `cover_url`, ale repozitář žádné fotografie neobsahuje a seed je nemá vyplněné. Bez nich se vykreslí neutrální plocha se značkou. Pro pilot je potřeba doplnit skutečné fotky provozoven.

## 6. Fotografie jsou demo obsah z cizího hostitele

Seed ilustruje fiktivní provozovny stock fotkami z `images.unsplash.com`. Pro demo je to v pořádku, pro pilot ne: je to závislost na cizí službě a stojí to zhruba deset bodů výkonu v Lighthouse. Aplikace i Storage buckety jsou připravené na vlastní fotky provozoven — je to obsahová práce, ne vývojová.

## 7. Hodnocení jsou vědomé rozšíření nad V1

Původní zadání recenze z V1 vyřazovalo. Hodnocení jsou přidaná na výslovné rozhodnutí a záměrně v nejmenší poctivé podobě: jen hvězdičky bez textu, hodnotit smí pouze zákazník s vlastní **dokončenou** rezervací, průměr se počítá v dotazu a zobrazí se až od tří hodnocení. Neřešená agenda, kterou to otevírá: moderace, odpovědi podniku, obrana proti zneužití a to, co se stane s hodnocením zrušeného podniku.

## 8. Jeden účet = jedna provozovna

Partnerská část pracuje s první provozovnou účtu. Datový model víc provozoven na účet unese (`business_members`), ale přepínač mezi nimi v rozhraní není. Pro pilot s ručním onboardingem to stačí; jakmile bude mít někdo dvě pobočky, je potřeba ho doplnit.

## 9. Veřejná ukázka a její hranice

<https://flek-nine.vercel.app> je veřejně dostupná bez hesla. Data jsou fiktivní a RLS drží, ale je potřeba vědět:

- Demo účty mají vygenerovaná hesla mimo repozitář; administrátorský účet má vlastní, nesdílené. Před dalším sdílením je vhodné je znovu otočit.
- V Supabase je stále **vypnutá ochrana proti prolomeným heslům** (Auth → leaked password protection). Pro cokoli s reálnými uživateli ji zapněte.
- Kdokoli s odkazem si může založit účet a rezervovat. Pro pilot s reálnými podniky je potřeba ukázku buď zaheslovat (Vercel to umí přes Deployment Protection), nebo oddělit demo data od ostrých.

## 10. Výkon po doplnění fotografií a plateb

Lighthouse na objevování se drží kolem 80. Hlavní zátěž není v písmech (ověřeno: subsetting nepomohl), ale v JavaScriptu a v obrázcích z cizího hostitele. Partnerská část a administrace už se načítají odděleně; další velký kus je polyfill Temporalu, který je potřeba hned kvůli pražským dnům a letnímu času.

Kdo v tom bude pokračovat: nejvíc přinese nahrazení Temporalu v zobrazovací cestě (`Intl` to umí nativně) a přesun fotografií do Storage. Měřit se to má na produkci, ne na lokálním `vite preview` — čísla se tam liší i o pět bodů mezi běhy.

## 11. Vědomě mimo V1

Předplatné · psané recenze a jejich moderace · chat · push a SMS · dynamické ceny · integrace na rezervační systémy · vícejazyčné rozhraní · nativní aplikace · fakturace · výplaty podnikům.

Tenhle seznam byl zastaralý a je opravený. Mezitím **přibylo**: platba předem (demo poskytovatel, viz níže), hodnocení hvězdičkami z proběhlých rezervací, oblíbené podniky s odvozeným upozorněním, export do kalendáře, skenování QR u partnera a atribuce doporučení.

## 12. Doporučení nemají odměnu

Atribuce je hotová a měřitelná: kdo koho přivedl a jestli ten člověk opravdu absolvoval svůj první FLEK. Kredit k utracení hotový **není** a záměrně se nikde nezobrazuje.

Důvod je architektonický, ne časový. `create_booking` přijímá jen vypořádanou platbu, jejíž částka odpovídá ceně nabídky. Prosté `profiles.credit_cents += 5000` by tenhle invariant obešlo. Utratitelný kredit vyžaduje, aby platilo „externí vypořádané peníze + atomicky spotřebovaný kredit = cena rezervace", a aby to zvládlo souběžné utrácení, dvojklik, selhání rezervace po rezervaci kredibitu, selhání platby, změnu ceny, vrácení odměny a idempotenci. Do té doby je poctivější měřit atribuci než ukazovat částku, kterou nejde uplatnit.

## 13. Upozornění na nový FLEK není push

„Upozornit na další FLEK" zapne sledování podniku. Nové termíny se pak objeví v Oblíbených a na odznaku v navigaci. Do zařízení nic nedorazí — web push není implementovaný a aplikace proto **nežádá o povolení oznámení**, protože by ho nemohla využít. Texty to říkají doslova: „Nové FLEKy uvidíš v Oblíbených."

Stejně tak dashboard podniku říká, že provozovnu někdo sleduje — nikdy, že jim bylo něco odesláno.

## 14. Fotografie v katalogu jsou právní riziko, ne jen malý výběr

`public.service_photos` má 36 činností, ale jen **12 fotografií** — ověřených tak, že se každá skutečně načte. Uvnitř kategorie proto několik činností sdílí jeden snímek.

Podstatnější je ale licence. Podmínky Unsplash říkají doslova, že licence **nezahrnuje** právo užít „People's images if they are recognizable in the Images", a služba se poskytuje „AS-IS" **bez záruky neporušení práv třetích stran**. Na našich snímcích rozpoznatelní lidé jsou. Pro demo to projde, pro ostrý provoz, kde fotka propaguje službu konkrétního podniku, je to riziko na straně provozovatele FLEKu.

Nahrávání vlastních fotek partnerem bylo zvažováno a **zamítnuto z bezpečnostních důvodů** (obsah bez moderace ve veřejném bucketu). Politika úložiště pro buckety `logos` a `covers` z migrace 202609070005 v databázi ale nadále existuje a dovoluje přihlášenému členovi provozovny zapisovat do složky své provozovny. Aplikace ji nevyužívá; pokud má zůstat zavřená i na úrovni databáze, je potřeba ty INSERT/UPDATE politiky odebrat samostatnou migrací.
