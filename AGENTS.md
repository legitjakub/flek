# FLEK — pokyny pro AI agenty

Vstupní bod pro každého agenta (Claude Code, Codex, Cursor…). Přečti celý, než začneš měnit kód. Je krátký schválně: podrobnosti jsou v odkazovaných souborech.

## Co to je

FLEK je český marketplace pro volná místa na poslední chvíli. Podnik zveřejní termín, který by jinak propadl, zákazník ho se slevou rezervuje, zaplatí v aplikaci a v podniku ukáže kód. Pilot: Praha, CZK, `Europe/Prague`, platby jdou jen přes Stripe Connect, zatím v testovacím režimu Stripe (žádné skutečné peníze).

- Web: https://www.app-flek.eu (Vercel, automaticky z větve `main`; https://flek-nine.vercel.app funguje dál)
- Databáze: Supabase projekt `yupkrntknbkvmlajwlph`
- Kód: https://github.com/legitjakub/flek

## Kde co hledat

| Potřebuješ | Soubor |
| --- | --- |
| Todolist, fáze, jak to funguje, kde co běží (lidský přehled, zrcadlí se do Notionu) | `docs/NOTION.md` |
| Co zbývá před ostrým spuštěním (co musí udělat člověk, co zvládne agent, postup spuštění) | `docs/PRED_SPUSTENIM.md` |
| Detailní stav implementace, migrace, otevřené body | `docs/PROJECT_STATUS.md` |
| Proč je něco udělané tak, jak je | `DECISIONS.md` |
| Co vědomě chybí nebo je omezené | `LIMITATIONS.md` |
| Důkazy ověření | `VERIFICATION.md` |
| Nastavení, demo účty, testy | `README.md` |
| Původní zadání (pracovní název VOLNO) | `docs/BUILD_BRIEF.md` |
| `HANDOFF.md` | historický stav ze 7. 9. 2026, neřiď se jím |

## Mapa kódu

| Složka | Obsah |
| --- | --- |
| `src/app` | `App.tsx` (tabulka rout), vlastní router nad History API, `CustomerShell.tsx` (hlavička a spodní navigace) |
| `src/features/discovery` | Objevit, mapa, filtry, rozšiřování hledání (`filters.ts`, `useDiscovery.ts`), jedna karta na službu s více časy (`slots.ts`) |
| `src/features/offers` | detail nabídky, výběr času (`TimePicker.tsx`), „Mohlo by se ti líbit“ (`Recommendations.tsx`), `OfferMap.tsx` (MapLibre) |
| `src/features/bookings` | rezervace, platba, voucher s QR |
| `src/features/merchant` | FLEK Partner: provozovna, služby, zveřejnění FLEKu, rezervace, metriky, upozornění |
| `src/features/admin` | administrace, fronta nahlášení (`AdminReports.tsx`), podklad DAC7 (`Dac7Export.tsx`, `dac7.ts`) |
| `src/features/legal` | právní stránky, patička „O FLEKu“, věta o poskytovateli, nahlášení obsahu; vykreslení omezeného markdownu bez HTML (`markdown.tsx`), verze textů (`documents.ts`) |
| `src/content/pravni` | právní texty v markdownu: `podminky.md` (včetně nahlášení obsahu podle DSA), `podminky-podniky.md`, `soukromi.md` |
| `src/features/notifications` | zvonek s upozorněními a nastavení e-mailu, push a WhatsApp (zákazník v Profilu, podnik v Provozovně), zapíná `VITE_NOTIFICATIONS_ENABLED`; `WhatsApp.tsx` ověření čísla jedním klepnutím a výzvy |
| `src/features/{auth,profile,favorites,referral,onboarding,pwa,business,ratings}` | přihlášení (e-mail, `SocialSignIn.tsx` pro Google a Apple, jen když jsou zapnuté v Supabase), profil, oblíbené, pozvánky, intro, instalace, stránka podniku, Google hodnocení |
| `src/components/ui.tsx` | sdílené komponenty (Button, PromoCard, SettingsList, Tabs, Sheet…) |
| `src/lib/api.ts` | všechna volání Supabase RPC |
| `src/lib/pricing.ts` | výpočet ceny a poplatku (zrcadlí SQL, test `tests/fixtures/fee-vector.json`) |
| `src/types/database.ts` | ručně psané typy, **negenerovat** |
| `supabase/functions` | Edge Functions: `stripe-checkout`, `stripe-webhook`, `stripe-connect` (Accounts v2), `stripe-refunds`, `stripe-test-pay` (jen test), `stripe-webhook-setup` (jen admin: doplní události webhooku), `booking-confirmation` (capture nebo uvolnění autorizace po rozhodnutí podniku), sdílené `_shared/stripe.ts`; `notification-delivery` (e-mail přes Resend, Web Push a WhatsApp z fronty), `whatsapp-webhook` (Meta Cloud API, podpis `X-Hub-Signature-256`), `whatsapp-templates-setup` (jen admin: založí u Mety pět šablon podle `_shared/whatsapp.ts`), sdílené `_shared/whatsapp.ts`; `ares-lookup` (IČO v ARES, `_shared/ares.ts`); e-maily skládá `_shared/email.ts` |
| `supabase/migrations` | schéma, RLS a všechny RPC; názvy souborů = verze v hostované DB |
| `tests` | unit testy (Vitest), `integration.test.ts` (potřebuje Docker), `pilot-maintenance.sql`, `stripe-refunds.sql`, `manual-confirmation.sql`, `whatsapp-notifications.sql`, `legal.sql` a `oauth-profile.sql` (SQL v transakci s rollbackem) |
| `scripts` | `acceptance.mjs` (API kontroly), `check-oauth.mjs` (stav přihlášení přes Google a Apple), `sync-notion.mjs`, lokální Supabase |

Routy: zákazník `/`, `/mapa`, `/nabidka/:id`, `/podnik/:id`, `/oblibene`, `/rezervace`, `/profil`, `/prihlaseni`, `/potvrzeni`, `/r/:code`, právní texty `/podminky`, `/podminky-podniky`, `/soukromi`; podnik `/partner` (+ `/nabidky`, `/rezervace`, `/sluzby`, `/provozovna`, `/metriky`, `/registrace`); admin `/admin` (+ `/nabidky`, `/rezervace`, `/uzivatele`, `/metriky`, `/audit`, `/nahlaseni`).

## Pravidla, která se nesmí porušit

- Kapacitu, rezervace, platby a ceny mění jen serverové RPC (`security definer`). Klient nikdy nezapisuje `capacity_remaining` ani finanční sloupce.
- „Vyprodáno“ a „prošlé“ se neukládají; dostupnost počítá `offer_is_bookable(...)` v SQL. Žádná druhá definice v TypeScriptu.
- Peníze jsou celé haléře (`*_cents`). Čas rozhoduje databázový `now()`, v klientovi serverový čas z `useServerNow()`, ne hodiny zařízení.
- Finanční snímek rezervace je po vytvoření neměnný.
- Zákaznická část **tyká**, partnerská **vyká**. Termínu pro zákazníka se říká „FLEK“ („volné FLEKy“).
- Žádná vymyšlená data: falešná hodnocení, jména podniků, e-mail podpory ani právní texty.
- Veřejná data jen přes čtecí RPC. Anon nemá SELECT na doménové tabulky; nový veřejný údaj přidej do RPC, ne grantem na tabulku.
- Každá nová admin mutace zapisuje `private.audit(...)` ve stejné transakci.
- Nová externí doména (API, obrázky, dlaždice) musí do CSP ve `vercel.json`. Žádné `eval`, inline skripty ani `dangerouslySetInnerHTML`.
- Stripe klíče (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) a klíče Meta (`WHATSAPP_*`) žijí jen v Supabase secrets. Místo podniku zaplatí a obsadí jen webhook Stripe; klient nikdy neoznačuje platbu jako zaplacenou.
- Potvrzování rezervací (přepínač `manual_confirmation_enabled`): místo drží už `start_payment`, peníze se jen autorizují a strhne je až `booking-confirmation` po potvrzení podnikem. Rezervaci potvrzuje nebo odmítá jen `private.decide_booking` (aplikace přes `respond_to_booking`, WhatsApp přes `whatsapp_decide`); nový kanál nesmí mít vlastní logiku. Nedohodnutá žádost nikdy neukáže kód a uvolněná autorizace se nikdy nevrací jako vratka. Nová funkce nad `bookings` musí počítat se stavy `pending_payment`, `pending_merchant` a `capturing` (`private.booking_was_agreed`).
- Upozornění na rezervace vytváří jen trigger `booking_notification` nad `bookings`; klient je nezakládá. E-mail zákazníkovi o jeho rezervaci jde vždy (potvrzení smlouvy), předvolby řídí jen ostatní kanály a zprávy podnikům. Zprávy o účtu (stav podniku, blokace, vyřízené nahlášení) jdou jen přes `private.account_notice`. Push nese jen odkaz, žádné detaily rezervace. WhatsApp jde jen na číslo ověřené zprávou z toho čísla (`private.whatsapp_contacts`) a rozhodovat tlačítkem jde jen ze žádosti pro podnik.
- Právní texty jsou v `src/content/pravni` a popisují jen skutečné chování FLEKu. Změna chování, o kterém text mluví (storno, poplatek, platby, data, lhůty), znamená upravit i text. Každá změna zveřejněného textu dostane novou verzi: `version` v `src/features/legal/documents.ts` a nový řádek v `public.legal_documents` migrací (`effective_at` u podmínek pro podniky nejméně 15 dní dopředu), a bod ke kontrole právníkem v `docs/PRED_SPUSTENIM.md`. Souhlas zapisuje jen server (`private.legal_acceptances`); texty se ukážou, až jsou v `private.settings` údaje provozovatele.
- Analytika nic neukládá do prohlížeče (bez cookie lišty). Nový identifikátor v `localStorage`, `sessionStorage` nebo cookie jen nezbytný pro funkci, kterou si člověk vyžádal, a zapsaný v `soukromi.md`.
- Service-role klíč nepatří do prohlížeče ani repozitáře. Hesla (admin, demo účty) se nikdy necommitují; v testech se přihlašuje vložením session, ne psaním hesla do formuláře.

## Jak pracovat

- Ověření před commitem: `npm run build` (včetně `tsc`) a `npm run test:unit`; totéž běží v CI (`.github/workflows/ci.yml`). UI změny projdi v prohlížeči na 375/390 px a desktopu (bez přetečení, dotykové plochy ≥ 44 px, kontrast AA).
- Nasazení: push do `main` → Vercel sestaví sám a Supabase nasadí Edge Functions uvedené v `supabase/config.toml` (GitHub integrace). Proměnné `VITE_*` musí být ve Vercelu při sestavení. Funkci mimo `config.toml` nasaď přes MCP.
- Migrace: aplikuj přes Supabase MCP, pak **přejmenuj soubor** na verzi, kterou databáze zapsala do `supabase_migrations.schema_migrations`, jinak by ji `supabase db push` spustil znovu.
- **Nespouštěj** `npm run db:types` (přepíše ručně psané typy a rozbije importy).
- `npm run test:acceptance` mění demo data v hostované DB; jen proti demo účtům.
- Commity česky, stručně proč; git push přes `git -c credential.helper='' -c credential.helper='!gh auth git-credential' push origin main`.

## Po každé změně aktualizuj dokumentaci

1. `docs/PROJECT_STATUS.md`: řádek do „Historie posledních změn“, případně „Aktuálně implementované“ nebo „Ověření a otevřené body“.
2. `docs/NOTION.md`: odškrtni nebo přidej úkol v todolistu, uprav fázi, „Kde co běží“ a historii, pokud se změnily.
3. `LIMITATIONS.md` a `DECISIONS.md`, pokud vzniklo nové omezení nebo rozhodnutí.
4. Notion stránku „FLEK — přehled projektu“ přepiš obsahem `docs/NOTION.md` (vložením v prohlížeči, nebo `npm run notion`, pokud je v `.env.local` token).
