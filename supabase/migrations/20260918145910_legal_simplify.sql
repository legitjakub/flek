/*
 * Zjednodušení právních textů podle srovnání s podobnými službami (Too Good To Go, TasteTown, Fresha, Reservio):
 *
 * - Pravidla obsahu a nahlášení jsou oddílem obchodních podmínek, ne samostatným dokumentem. Verze
 *   content_rules se nikdy nezveřejnila a nikdo s ní nesouhlasil.
 * - Novou verzi podmínek pro podniky oznámíme aspoň 15 dní předem a platí pokračováním ve spolupráci
 *   (nařízení P2B); podnik, který jednou s podmínkami souhlasil, kvůli nové verzi nepřestane zveřejňovat.
 *   Poprvé souhlasit musí dál, banner o nové verzi zůstává.
 */
delete from public.legal_documents where kind = 'content_rules';

/** True while no merchant terms are in force, or once a member of the venue accepted any version of them. */
create or replace function private.merchant_terms_accepted(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_legal_version('merchant_terms') is null
    or exists (select 1 from private.legal_acceptances a where a.business_id = p_business_id and a.kind = 'merchant_terms')
$$;
