# Co není hotové

Poctivý seznam. Nic z toho není obejité mockem ani vydávané za hotové.

## 1. Integrační testy a migrace neběžely proti skutečné databázi

Na tomto počítači není Docker, PostgreSQL ani nástroj, kterým by šly nainstalovat (`docker`, `colima`, `podman`, `limactl` ani `brew` nejsou k dispozici). Lokální Supabase proto nešlo spustit.

Důsledek: SQL v `supabase/migrations/` a `supabase/seed.sql` je napsané a typově konzistentní, ale **nikdy nebylo aplikované na běžící PostgreSQL**. Integrační testy v `tests/integration.test.ts` jsou napsané a projdou `tsc`, ale nespouštěly se. Nelze tedy tvrdit, že souběžné rezervace, RLS ani vyhledávání fungují — jen že jsou tak navržené.

Co s tím: na počítači s Dockerem stačí

```sh
npm ci && npm run db:start && npm run db:types && npm test
```

a případné chyby opravit. Nepomáhejte si mockem backendu.

## 2. `src/types/database.ts` je psaný ručně

Zadání chce typy generované ze schématu. Generátor potřebuje běžící databázi, kterou tady nemáme. Soubor proto zrcadlí migrace ručně a je tak označený. `npm run db:types` ho přepíše skutečně vygenerovanou verzí.

## 3. End-to-end průchod nebyl proveden

Akceptační kritéria v sekci 17 zadání popisují průchod dvěma prohlížeči proti skutečnému backendu. Bez databáze ho nešlo projít. V prohlížeči je ověřená jen skořápka aplikace: vykreslení, absence chyb v konzoli a absence vodorovného posunu na 375 px.

## 4. Lighthouse změřený jen na prázdné obrazovce

Objevování na produkčním buildu dává **výkon 90 a přístupnost 100**, tedy nad požadovaným prahem. Měřilo se ale bez běžícího backendu, takže stránka nesla skořápku, ne karty s fotografiemi. Až budou data a obrázky, je potřeba měření zopakovat — obrázky jsou to, co skóre výkonu obvykle srazí. Detail nabídky se bez dat změřit nedá.

## 5. Fotografie nabídek

Karty i detail počítají s `image_url` a `cover_url`, ale repozitář žádné fotografie neobsahuje a seed je nemá vyplněné. Bez nich se vykreslí neutrální plocha se značkou. Pro pilot je potřeba doplnit skutečné fotky provozoven.

## 6. Vědomě mimo V1

Platby, zálohy, výplaty · předplatné · věrnostní programy a kupony · recenze · chat · push a SMS · dynamické ceny · integrace na rezervační systémy · vícejazyčné rozhraní · nativní aplikace · fakturace · QR skenování.

Z P2 nebylo dokončeno nic: e-mailová oznámení, oblíbené podniky, export do kalendáře ani zakládání provozovny administrátorem s pozvánkou vlastníka. P0 a P1 mají přednost a P2 se nebude vydávat za hotové.
