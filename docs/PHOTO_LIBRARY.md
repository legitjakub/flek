# Knihovna ilustračních fotografií FLEK

## Stav 20. 9. 2026

Knihovna obsahuje dvě samostatně generované fotografie pro každou z 36 připravených aktivit a půjčení kola nalezené mezi skutečnými aktivními službami: celkem 74 originálů. Pokrývá vlasy, masáže, krásu, sport, jógu a wellness bez sdílení zavádějícího snímku mezi různými aktivitami.

Jedna varianta ukazuje prostředí, druhá bližší vybavení v jiném prostředí. Jde o realistické lokální české provozovny bez osob, log, textu a tropických resortů. Ilustrace neprezentují skutečné interiéry konkrétních podniků.

## Kompozice a rozlišení

Nová karta používá čtverec a horní karusel 4:5, detail 16:9 na mobilu a 2:1 na desktopu. Motiv je proto ve středu nad spodní třetinou, kterou překrývá informační panel. Originál má 1254 × 1254 px; pro karty existuje 800px a pro mapové body 176px derivát.

## Zapojení

- `src/lib/activityGalleries.ts`: české názvy, rozpoznání vlastní služby a responsive srcset. Každá připravená aktivita má dvě vlastní URL.
- `ActivityPicker`: nabídka fotografií patří pouze k vybrané aktivitě.
- `20260920210547_refresh_activity_photos_and_demo_services.sql`: napojí katalog i existující aktivní služby na správnou aktivitu, doplní chybějící půjčení kola a přidá 24 služeb do výhradně demo provozoven. Obnovovač pak pro nové služby založí ukázkové FLEKy na tři dny dopředu.
- Fotka uložená podnikem má vždy přednost. Migrace nahrazuje jen chybějící obrázek, Unsplash nebo starou ilustraci z `/images/services`; skutečné obrázky ve Storage nepřepisuje.
- `docs/assets/activity-photo-generation.jsonl`: 74 promptů a názvů zdrojových souborů vytvořených vestavěným imagegen nástrojem.

Nejasný název „Individuální lekce“ sám neurčuje sport. Podnik musí vybrat skutečnou aktivitu nebo vlastní fotografii.

## Stav 22. 9. 2026

Osm aktivit ze 37 používá skutečné fotografie z Unsplashe místo generovaných: `vlasy-pansky-strih`, `krasa-manikura`, `wellness-odpocinek`, `sport-pujceni-kola`, `sport-osobni-trenink`, `sport-padel`, `joga-rani-protazeni`, `sport-tenis`. U `vlasy-uprava-vousu` a `masaze-zada-sije` zůstala kreslená sada: hledání pro ně nabídlo jen fotografie osob nebo vágní interiéry a špatná fotografie je horší než kreslená. Velikosti řeší CDN přes parametr `w`, takže tyhle aktivity nemají lokální deriváty. Zbylých 29 aktivit a sada v `public/images/services` zůstávají generované — výměna je druhé kolo.

Adresa každé fotky byla ověřena dotazem `net.http_get` přímo z databáze (stav 200, `image/jpeg`). Fotky s rozpoznatelnou tváří se nepoužívají.

Výběr dělá agent podle popisu, štítků a oblíbenosti — fotografie sám nevidí, protože jeho prostředí nemá přístup ven. Proto se po každém kole ukazuje Jakubovi, co je v aplikaci, a vyměňuje se to, co označí.
