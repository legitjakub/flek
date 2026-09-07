# VOLNO — předání rozpracovaného projektu

Stav k 7. 9. 2026. Projekt je uložen přímo v této složce; není to hotová aplikace.

## Co už je uložené

- Přesné původní zadání: `docs/BUILD_BRIEF.md`.
- React/Vite/TypeScript závislosti, ověřené stabilní verze a npm lockfile.
- Pět SQL migrací: schéma a omezení, RLS, transakční rezervace a storna, obchodnické/admin operace, PostGIS vyhledávání a pravidla pro Storage.
- Lokální seed: 15 fiktivních provozoven, 30 služeb, 38 termínů relativně k `now()`, demo účty a historie rezervací.
- Integrační testy skutečných JWT pro souběh, autorizaci, kapacitu, storna, nedostavení, kolize kódů a změny nabídky.
- Sdílené validace, české chybové zprávy a funkce pro čas a peníze.
- README, DECISIONS, LIMITATIONS, VERIFICATION a tento předávací záznam.

## Co je skutečně ověřené

- `npm run test:unit`: 6 testů prošlo.
- `npx tsc --noEmit`: dosavadní zdrojové soubory a testy prošly.
- Instalace závislostí: dokončená.

## Co ještě není hotové

1. Spustit skutečný Supabase a ověřit migrace i seed. Integrační testy dosud neběžely, takže SQL není ověřené běžícím PostgreSQL.
2. Opravit případná selhání `npm test`; neobcházet je a nevytvářet mock backend.
3. Vygenerovat `src/types/database.ts` ze živé databáze přes `npm run db:types`.
4. Implementovat P0 obrazovky a první celý tok publikace → rezervace → docházka. Zatím není `index.html`, React vstup ani vykreslitelná aplikace; `npm run dev`/`build` proto nejsou hotovým produktem.
5. Teprve po P0 pokračovat P1, vizuální úpravou a úplným QA podle zadání.
6. Dodat logo: v poslední zprávě nebyl dostupný soubor s logem. `public/favicon.svg` je původní soubor ze scaffoldu, nikoli schválené logo VOLNO; před dokončením jej nahradit.

## Pokračování na jiném počítači

Rozbalte `volno-handoff.zip`, otevřete složku v editoru a přečtěte `docs/BUILD_BRIEF.md` a `DECISIONS.md`. Nainstalujte Node.js a Docker, poté:

```sh
npm ci
npm run db:start
npm run db:types
npm test
```

`npm run db:reset` přestaví lokální databázi a smaže její obsah. Pro produkci nepoužívejte demo seed ani demo hesla.

Na původním Macu je rozpracovaný izolovaný Lima VM v `/private/tmp/volno-lima-state`; není součástí balíčku a není nutný na jiném počítači s Dockerem. Skript `scripts/local.mjs` umí tento lokální socket rozpoznat, jinak používá standardní Docker prostředí.

Balíček neobsahuje `node_modules`, Git historii, přístupové klíče, lokální `.env` ani databázové/VM soubory. `.env.example` obsahuje pouze veřejné konfigurační položky. V repozitáři není nastavený Git remote, takže nebyl proveden push na vzdálený server.
