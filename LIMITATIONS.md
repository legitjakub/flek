# Co není hotové

Poctivý seznam. Nic z toho není obejité mockem ani vydávané za hotové.

## 1. `npm test` (lokální integrační sada) nespuštěná

Na tomto počítači není Docker ani PostgreSQL (`docker`, `colima`, `podman`, `limactl` ani `brew` nejsou k dispozici), takže lokální Supabase nešlo spustit a sada `tests/integration.test.ts` neběžela.

Migrace, seed i chování aplikace ale **jsou** ověřené proti skutečnému hostovanému PostgreSQL 17 s PostGIS — viz `npm run test:acceptance`, 27/27 prošlo, včetně souběžných rezervací a RLS. Obsahově se obě sady překrývají; lokální varianta navíc sahá přímo do databáze (`pg`), což hostovaná cesta neumí.

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

## 10. Vědomě mimo V1

Platby, zálohy, výplaty · předplatné · věrnostní programy a kupony · recenze · chat · push a SMS · dynamické ceny · integrace na rezervační systémy · vícejazyčné rozhraní · nativní aplikace · fakturace · QR skenování.

Z P2 je hotový jen export do kalendáře (.ics u potvrzení). Zbytek ne: e-mailová oznámení, oblíbené podniky ani zakládání provozovny administrátorem s pozvánkou vlastníka. P0 a P1 mají přednost a P2 se nebude vydávat za hotové.
