# FLEK — předání

> **Neřiď se tímto souborem.** Vstupní bod pro lidi je `docs/NOTION.md`, pro AI agenty `AGENTS.md`. Příkaz `npm run db:types` níže už neplatí: přepsal by ručně psané typy a rozbil aplikaci.
>
> Historické předání z 7. 9. 2026. Níže uvedené počty migrací a neověřené body popisují tehdejší stav. Aktuální stav k 13. 9. 2026 je v [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) a poslední sekci [VERIFICATION.md](VERIFICATION.md). Projekt je verzovaný v Gitu v této složce.

## Co je hotové

- **Databáze:** šest migrací — schéma a omezení, RLS a bezpečnostní pomocné funkce, transakční rezervace a storna, obchodnické a admin operace, PostGIS vyhledávání a čtecí modely, Storage, metriky.
- **Aplikace:** kompletní zákaznická část (objevování, mapa, detail nabídky, rezervace s kódem, moje rezervace, profil), FLEK Partner (přehled, zveřejnění termínu, nabídky, rezervace s vyhledáním podle kódu, služby, provozovna, metriky) a administrace (schvalování, seznamy, uživatelé, metriky pilotu).
- **Testy:** jednotkové testy času a peněz procházejí; integrační testy proti skutečným JWT jsou napsané.
- **Značka:** logo, ikony, paleta a wordmark FLEK.

## Co zbývá

1. **Spustit databázi a testy.** Na tomto počítači není Docker, takže migrace ani integrační testy nikdy neběžely proti PostgreSQL. Toto je nejdůležitější zbývající krok.
2. `npm run db:types` přepíše ručně psaný `src/types/database.ts` skutečně vygenerovaným.
3. Projít akceptační průchod 1–12 z [VERIFICATION.md](VERIFICATION.md) ve dvou prohlížečích.
4. Změřit Lighthouse na objevování a detailu nabídky.
5. Doplnit fotografie provozoven do seedu.

Úplný a poctivý stav je v [VERIFICATION.md](VERIFICATION.md) a [LIMITATIONS.md](LIMITATIONS.md).

## Pokračování na jiném počítači

Potřebujete Node.js ≥ 22.12 a Docker.

```sh
npm ci
npm run db:start
npm run db:types
npm test
npm run dev
```

`npm run db:reset` přestaví lokální databázi. Demo seed ani demo hesla nikdy nenasazujte do produkce.

Původní zadání je zachované v `docs/BUILD_BRIEF.md` — mluví ještě o pracovním názvu VOLNO, jinak platí beze změn.
