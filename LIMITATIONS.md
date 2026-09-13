# Omezení pilotu

Aktualizováno 13. 9. 2026. Aktuální implementaci shrnuje [přehled projektu](docs/PROJECT_STATUS.md); důkazy ověření jsou v [VERIFICATION.md](VERIFICATION.md).

## Platby a výplaty

Platby používají `provider=demo`. Potvrzení a vrácení mění databázový stav; skutečné peníze se nestrhávají ani neposílají. Checkout to výslovně uvádí. Nový cenový model a neměnné finanční snímky jsou implementované, ale napojení skutečné brány, refund API, skutečné výplaty a účetní doklady zůstávají mimo pilot.

## Testy a zařízení

77 jednotkových testů a 100 API akceptačních kontrol prošlo. Databázový test údržby, časových hranic a neměnnosti cen prošel v transakci s rollbackem. Lokální sada `npm test` vyžaduje běžící Docker/Supabase; lokální backend nyní neběží. Docker CLI je dostupné, dřívější tvrzení, že na počítači vůbec není Docker, už neplatí.

Mobilní rozměry systémového Chrome ověřují responzivní rozhraní, nenahrazují fyzický iPhone/Safari a test skeneru kamerou. Aktuální průchod a jeho limity uvádí poslední sekce VERIFICATION.md. Kompletní nový audit všech rolí, barev a konkurence je samostatný odložený úkol.

## Typy a historie migrací

`src/types/database.ts` obsahuje aplikační typy spravované ručně. Výstup generátoru Supabase má jinou strukturu; starý skript `db:types` by bez navazující migrace importů aplikaci rozbil. Není součástí postupu pro běžné spuštění.

Migrace aplikované přes MCP mají v hostované historii čas aplikace odlišný od lokálního názvu souboru. Mapování je v PROJECT_STATUS.md. Před prvním CLI `db push` je nutné ověřit a sladit historii podle názvu a obsahu, aby se již aplikované DDL neopakovalo.

## Demo data a účty

Veřejná ukázka obsahuje fiktivní podniky a účty `demo-*@flek.test`. Hesla jsou mimo repozitář, administrátor má vlastní heslo. Skutečný pilot musí oddělit reálná data od ukázkového seedu. Akceptační skript je určen demo prostředí: založené nabídky ruší, ale zanechá zrušenou historii rezervací a plateb. Neběží proti skutečným zákaznickým účtům.

Supabase advisor nadále hlásí vypnutou ochranu proti prolomeným heslům. Oprávnění RPC, finanční a kapacitní změny se ověřují na serveru. Zpráva advisoru o endpointu `security definer` sama neznamená chybu: tyto RPC tvoří úmyslné rozhraní pro autorizované operace.

## Fotografie a Google hodnocení

Lokální ilustrační fotografie existují v `public/images/services` a mají rozlišení podle aktivity; dřívější tvrzení, že sport nemá fotky, už neplatí. Některá ukázková data stále odkazují na Unsplash. Vybraná fotografie podniku má přednost před odvozenou ilustrací. Nahrávání vlastních fotografií přes UI není implementované; historické Storage politiky zůstávají samostatnou oblastí pro kontrolu před ostrým provozem.

Google hodnocení se zobrazí jen pro správně přiřazené Place ID a funkční serverové Places API s billingem. Chybějící odpověď se nenahrazuje fiktivními hvězdičkami. Aktuální test rezervací neověřuje billing ani konfiguraci Google Cloud.

## Upozornění a obsluha podniku

Upozornění podniku funguje přes Realtime s 30sekundovým pollingem v otevřené aplikaci. Zvuk závisí na povolení přehrávání prohlížečem. Při zavřené aplikaci se neposílá web push, SMS ani e-mail. Zákaznické sledování podniku znamená nové nabídky v Oblíbených a odznak navigace, nikoliv push oznámení.

Více provozoven na účet je podporováno přepínačem v partnerské části. Pozvánky personálu a detailnější týmová oprávnění zůstávají mimo tento pilot. Schválení provozovny se oznámí v aplikaci; potvrzovací e-maily registrace účtu zajišťuje Supabase Auth.

## Další vědomé hranice

- Mapový JavaScript je velký; Vite hlásí upozornění na chunk nad 500 kB. Nové měření Lighthouse zatím neproběhlo.
- Doporučení měří atribuci a dokončenou první rezervaci; nevytváří utratitelný kredit.
- Předplatné, chat, dynamická cenotvorba, účetnictví, integrace na externí rezervační systémy a automatické výplaty nejsou součástí V1.
