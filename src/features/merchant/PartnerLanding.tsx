import { Link } from '../../app/router';
import { MoneyExplainer } from './MoneyExplainer';
import { LegalFooter } from '../legal/LegalFooter';
import { PartnerSteps, RequestPreview } from './PartnerHelp';

const SIGNUP = '/prihlaseni?role=merchant&mode=signup&returnTo=%2Fpartner%2Fregistrace';

const NEEDS = [
  'IČO: název a sídlo doplníme z registru ARES',
  'Bankovní účet pro výplaty',
  'Ověření u Stripe, který platby zpracovává',
];

/**
 * What a business owner reaches from "Pro podniky" when not signed in.
 *
 * It used to be a login form and nothing else: someone curious what FLEK would do for their
 * salon, what it costs and how they get paid learned none of it, and registering was a small
 * "Nemám účet — vytvořit" under the password field.
 */
export function PartnerLanding() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <section>
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight text-ink sm:text-3xl">
          Zaplňte termíny, které by jinak zůstaly prázdné.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted">
          FLEK nabídne vaše volná místa lidem v okolí, kteří hledají službu na poslední chvíli. Zaplatí předem
          v aplikaci, u vás jen ukážou kód.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Link to={SIGNUP} className="btn-primary sm:w-auto">
            Zaregistrovat podnik
          </Link>
          <Link
            to="/prihlaseni?role=merchant&returnTo=%2Fpartner"
            className="inline-flex min-h-13 items-center justify-center rounded-xl border border-line bg-card px-5 text-base font-bold text-ink hover:bg-surface"
          >
            Už mám účet
          </Link>
        </div>
      </section>

      <section aria-labelledby="jak-to-funguje">
        <h2 id="jak-to-funguje" className="text-lg font-extrabold tracking-tight text-ink">Jak to funguje</h2>
        <div className="mt-3"><PartnerSteps /></div>
      </section>

      <RequestPreview />

      <section className="rounded-2xl bg-ink p-5 text-card">
        <p className="text-lg font-extrabold">Z vaší částky si nebereme provizi.</p>
        <p className="mt-1 text-sm text-card/80">
          Servisní poplatek platí zákazník, je součástí konečné ceny. Poplatky za platby kartou hradí FLEK.
        </p>
      </section>

      <MoneyExplainer />

      <section aria-labelledby="co-potrebujete" className="rounded-2xl bg-card p-5 shadow-card sm:p-6">
        <h2 id="co-potrebujete" className="text-lg font-extrabold tracking-tight text-ink">Co budete k registraci potřebovat</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {NEEDS.map((need) => (
            <li key={need} className="flex items-start gap-2.5 text-base text-ink">
              <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-brand" />
              {need}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">Provozovnu před prvním zveřejněním schválíme.</p>
        <Link to={SIGNUP} className="btn-primary mt-5 w-full sm:w-auto">
          Zaregistrovat podnik
        </Link>
      </section>

      <LegalFooter />
    </div>
  );
}
