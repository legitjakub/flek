# VOLNO

**Rozpracovaný projekt, zatím bez uživatelského rozhraní.** Přesný stav a postup pokračování jsou v `HANDOFF.md`; integrační testy zatím nebyly spuštěny.

České tržiště zlevněných termínů služeb na poslední chvíli. Pilot ověřuje, zda provozovny opakovaně zveřejňují nevyužitou kapacitu a zákazníci skutečně přicházejí. Platba probíhá na místě; aplikace neobsahuje platební bránu.

## Lokální spuštění

Požadavky: Node.js 22.12+ a běžící Docker. Přesné ověřené verze knihoven jsou v `package.json`, původ verzí v `DEPENDENCIES.md`.

```sh
npm ci
npm run db:start
npm run db:types
npm test
npm run dev
```

`db:start` spustí skutečný PostgreSQL, Supabase Auth, REST API a Storage. Zapíše jen veřejnou URL a anon klíč do ignorovaného `.env.local`. Prohlížeč nikdy nedostává service-role klíč. Obrazovky používají uložená data, ne místní simulaci.

Na tomto počítači se lokální Docker spouští v dočasném Lima VM `volno`. `scripts/local.mjs` automaticky rozpozná jeho socket. Po restartu počítače jej lze spustit:

```sh
LIMA_HOME=/private/tmp/volno-lima-state /private/tmp/volno-runtime/bin/limactl start volno
npm run db:start
```

Adresář `/private/tmp` může operační systém vyčistit. Pro trvalé vývojové prostředí použijte běžnou instalaci Docker Desktop nebo Lima a znovu `npm run db:start`. Zdrojové soubory i migrace jsou v tomto repozitáři.

## Databáze, migrace a testy

SQL migrace jsou v `supabase/migrations`, demonstrace v `supabase/seed.sql`. První start aplikuje migrace a seed. `npm run db:reset` smaže **lokální** databázi tohoto projektu a vytvoří ji znovu; nepoužívejte jej pro uchovávání pilotních dat. Všechny demo termíny vycházejí z databázového `now()`.

`npm test` vyžaduje běžící skutečný lokální Supabase. Chybějící backend testy nepřeskakuje. Service role vytváří pouze izolovaná testovací data; ověření oprávnění a rezervace používají přihlášení přes Auth a skutečné JWT. Testy odstraňují jen vlastní účty a provozovny. Časové testy samostatně: `npm run test:unit`.

`src/types/database.ts` se generuje ze živého schématu příkazem `npm run db:types`. Po změně migrací aktualizujte typy.

## Lokální demo účty

Všechny účty níže mají **pouze pro lokální vývoj** heslo `VolnoDemo2026!`. Demo seed nikdy nenasazujte do produkce.

| Účet | Účel |
|---|---|
| demo-customer@volno.test | Zákazník s historií rezervací |
| demo-merchant@volno.test | Schválená provozovna Studio Dobrá hodina |
| demo-merchant2@volno.test | Provozovna čekající na schválení |
| demo-admin@volno.test | Správa provozoven |

Seed obsahuje dalších osm technických demo účtů pro vlastníky a obsazenost. Všech 15 provozoven je fiktivních.

## Bezpečnostní model

- PostgreSQL je jedinou autoritou pro cenu, čas, kapacitu a oprávnění.
- RLS chrání každou aplikační tabulku; přímé zápisy do rezervací a kapacity jsou zakázané všem klientským rolím.
- Rezervace ubírá místo jedním podmíněným `UPDATE`; unikátní částečný index a zámek zákazníka chrání před dvojklikem a souběhem limitů.
- Zámek provozovny koordinuje schválení a pozastavení s rezervacemi. Zrušení rezervace obnovuje kapacitu ve stejné transakci.
- Veřejné nabídky jsou veřejné i pro ostatní obchodníky. Soukromé nabídky, zákaznické profily a cizí rezervace přístupné nejsou.
- Účast lze potvrdit pouze po začátku termínu a pouze členem jeho provozovny.
- Peníze jsou celá čísla v haléřích; vstup i zobrazení jsou celé Kč. Den a čas používají Europe/Prague.
- Bucket logos/covers povoluje pouze JPEG, PNG a WebP do 5 MB; zápis je omezen na složku vlastní provozovny.

## Produkční Supabase

V novém projektu aplikujte pouze migrace, nikoli demo seed. Nastavte veřejné připojení podle `.env.example`, správné Auth Site URL a redirect URLs pro nasazenou doménu. Admin roli přidělí správce databáze v `user_roles`, nikdy registrační formulář. Lokální zvýšený limit přihlášení v `config.toml` slouží souběžným testům; produkce má používat odpovídající limity Auth a ověřování e-mailů.

Aktuální stav dokončení a konkrétní důkazy jsou v `VERIFICATION.md`. Zbývající omezení jsou v `LIMITATIONS.md`; konflikty zadání a jejich řešení v `DECISIONS.md`.

## Další verze

Až pilot prokáže opakované publikování a docházku: nejlepší úsilí při e-mailových oznámeních, oblíbené provozovny a export rezervace do kalendáře. Platby ani jiné funkce mimo zadání nejsou součástí této verze.
