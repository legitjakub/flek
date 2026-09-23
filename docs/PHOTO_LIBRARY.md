# Fotografie aktivit FLEK

## Stav 23. 9. 2026

Katalog má 37 aktivit a dvě nabídnuté varianty na aktivitu. Po vizuální kontrole výřezů je v něm 69 použití 63 různých skutečných fotografií z Unsplashe. Pět pozic používá neutrální značkový obrázek `/images/flek-placeholder.svg`: obě varianty solné jeskyně a druhá varianta squashe, meditace a parní lázně. U nich byly dostupné výsledky zavádějící (jiný sport, běžná jeskyně nebo sauna); neurčitá fotka konkrétní provozovny by byla horší než zřejmý placeholder.

Každý použitý snímek má v [`docs/assets/activity-photo-sources.json`](assets/activity-photo-sources.json) název aktivity, variantu, URL fotografie, zdrojovou stránku, autora a licenci. Stránky fotografií při výběru uváděly „Free to use under the Unsplash License“. Kontaktní listy se kontrolovaly vizuálně; vyřadily se rozpoznatelné tváře, loga, nesouvisející sportoviště a zavádějící wellness interiéry. Fotografie je ilustrativní, ne obraz skutečné místnosti daného podniku. Unsplash [nepřijímá generativní AI obsah](https://help.unsplash.com/en/articles/2534415-unsplash-submission-guidelines); [licence](https://unsplash.com/license) umožňuje komerční použití.

## Zobrazení a přednost

- Nahraná a schválená fotografie podniku či služby má přednost na kartě, mapě, detailu i v partnerském editoru. Katalog se použije jen při chybějící fotce. Neznámé služby dostanou neutrální FLEK místo odhadu celé kategorie.
- CDN nabízí šířky 480, 800 a 1200 px podle místa zobrazení. Samotný detail má na mobilu 180px vysoký výřez; náhled v mapě používá malý ořez. Při chybě načtení se zobrazí značkový placeholder.
- Intro používá stejné ověřené skutečné snímky jako katalog. Staré generované složky `public/images/activities`, `public/images/services` a `public/images/intro` byly odstraněny.
- Migrace `20260923095229_replace_generated_activity_photos.sql` mění pouze přesně známé staré ilustrační URL v katalogu, službách a obálkách. Následná `20260923100358_adjust_wellness_rest_photos.sql` vyměňuje dva snímky odpočinku, které po vizuální kontrole připomínaly resort. URL v Supabase Storage nikdy nemění. Neutrální placeholder se může uložit v katalogu; u služby a obálky jej zastupuje prázdná fotka a frontend vybere neutrální obrázek.

Nejednoznačný název, například „Individuální lekce“, sám neurčuje sport. Podnik vybere aktivitu nebo nahraje vlastní fotografii. Historické prompty generované knihovny zůstávají pouze v `docs/assets/activity-photo-generation.jsonl`, již se nepoužívají.
