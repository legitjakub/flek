import { CalendarPlus, HandCoins, MapPin, TicketCheck } from 'lucide-react';
import { Link } from '../../app/router';
import { MoneyExplainer } from './MoneyExplainer';

const STEPS = [
  { icon: CalendarPlus, text: 'Uvolní se vám termín — zrušená rezervace, prázdné odpoledne.' },
  { icon: HandCoins, text: 'Nastavíte, kolik za něj chcete dostat.' },
  { icon: MapPin, text: 'FLEK ho ukáže lidem v okolí, kteří mají zrovna čas.' },
  { icon: TicketCheck, text: 'Když si ho někdo rezervuje, rezervaci během pár minut potvrdíte a dostanete částku, kterou jste nastavili.' },
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
          FLEK nabídne vaše volná místa lidem v okolí, kteří hledají službu na poslední chvíli. Platí předem
          přes FLEK, u vás jen ukážou kód.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Link to="/prihlaseni?role=merchant&mode=signup&returnTo=%2Fpartner%2Fregistrace" className="btn-primary sm:w-auto">
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
        <ol className="mt-3 flex flex-col gap-3">
          {STEPS.map(({ icon: Icon, text }, index) => (
            <li key={text} className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                <Icon size={20} aria-hidden="true" />
              </span>
              <p className="pt-2 text-base text-ink">
                <span className="tnum font-bold">{index + 1}.</span> {text}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl bg-ink p-5 text-card">
        <p className="text-lg font-extrabold">Z vaší FLEK ceny si nebereme provizi.</p>
        <p className="mt-1 text-sm text-card/80">Servisní poplatek je součástí konečné ceny, kterou platí zákazník.</p>
      </section>

      <MoneyExplainer />
    </div>
  );
}
