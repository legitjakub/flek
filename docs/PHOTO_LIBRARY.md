# Knihovna ilustračních fotografií FLEK

## Stav 20. 9. 2026

Knihovna obsahuje dvě samostatně generované fotografie pro každou z 36 připravených aktivit a půjčení kola nalezené mezi skutečnými aktivními službami: celkem 74 originálů. Pokrývá vlasy, masáže, krásu, sport, jógu a wellness bez sdílení zavádějícího snímku mezi různými aktivitami.

Jedna varianta ukazuje prostředí, druhá bližší vybavení v jiném prostředí. Jde o realistické lokální české provozovny bez osob, log, textu a tropických resortů. Ilustrace neprezentují skutečné interiéry konkrétních podniků.

## Kompozice a rozlišení

Nová karta používá čtverec a horní karusel 4:5, detail 16:9 na mobilu a 2:1 na desktopu. Motiv je proto ve středu nad spodní třetinou, kterou překrývá informační panel. Originál má 1254 × 1254 px; pro karty existuje 800px a pro mapové body 176px derivát.

## Zapojení

- `src/lib/activityGalleries.ts`: české názvy, rozpoznání vlastní služby a responsive srcset. Každá připravená aktivita má dvě vlastní URL.
- `ActivityPicker`: nabídka fotografií patří pouze k vybrané aktivitě.
- Fotka uložená podnikem má vždy přednost. Existující služby ani skutečné fotky provozoven se hromadně nepřepisují.
- `docs/assets/activity-photo-generation.jsonl`: 74 promptů a názvů zdrojových souborů vytvořených vestavěným imagegen nástrojem.

Nejasný název „Individuální lekce“ sám neurčuje sport. Podnik musí vybrat skutečnou aktivitu nebo vlastní fotografii.
