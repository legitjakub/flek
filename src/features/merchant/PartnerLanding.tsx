import { BellRing, CalendarPlus, HandCoins, MapPin, QrCode } from 'lucide-react';
import { Link } from '../../app/router';
import { MoneyExplainer } from './MoneyExplainer';
import { LegalFooter } from '../legal/LegalFooter';

const SIGNUP = '/prihlaseni?role=merchant&mode=signup&returnTo=%2Fpartner%2Fregistrace';

/*
 * The five steps say what the product does today and nothing more; each detail is in the terms
 * for venues (podminky-podniky.md): 7 days ahead, 3 to 10 minutes to confirm, the amount blocked
 * until then, the whole amount kept on a no-show, payouts by Stripe.
 */
const STEPS = [
  {
    icon: CalendarPlus,
    title: 'Zveřejníte volný termín',
    text: 'Zrušená rezervace nebo prázdné odpoledne. Vyberete službu, čas a kolik za termín chcete dostat, nejvýš 7 dní dopředu.',
  },
  {
    icon: MapPin,
    title: 'FLEK ho ukáže lidem v okolí',
    text: 'Na mapě a v aplikaci, se slevou proti vaší běžné ceně. Kdo si poblíž hlídá podobné FLEKy, dostane upozornění, a kdo vás sleduje, uvidí ho v oblíbených.',
  },
  {
    icon: BellRing,
    title: 'Rezervaci potvrdíte jedním klepnutím',
    text: 'Na žádost máte 3 až 10 minut podle toho, jak brzy termín začíná. Do potvrzení je částka zákazníkovi jen zablokovaná na kartě.',
  },
  {
    icon: QrCode,
    title: 'Zákazník u vás ukáže kód',
    text: 'Rezervační kód, nebo QR, který načtete telefonem přímo v aplikaci.',
  },
  {
    icon: HandCoins,
    title: 'Dostanete celou částku, kterou jste nastavili',
    text: 'I když zákazník nedorazí. Peníze vám vyplácí Stripe na bankovní účet.',
  },
];

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
        <ol className="mt-3 flex flex-col gap-4">
          {STEPS.map(({ icon: Icon, title, text }, index) => (
            <li key={title} className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                <Icon size={20} aria-hidden="true" />
              </span>
              <div className="min-w-0 pt-1.5">
                <p className="text-base font-bold text-ink">
                  <span className="tnum">{index + 1}.</span> {title}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ol>
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

/**
 * A booking request as the dashboard shows it, drawn once with sample values so a venue sees
 * the whole job before signing up: a time, what they get, a countdown and two buttons. No
 * venue or customer name, since there is no real one behind it.
 */
function RequestPreview() {
  return (
    <figure className="flex flex-col gap-2">
      <div aria-hidden="true" className="pointer-events-none rounded-2xl bg-card p-4 shadow-card ring-2 ring-brand select-none sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-base font-extrabold text-ink">Nová rezervace</p>
          <p className="tnum text-sm font-bold text-muted">FLEK začíná za 90 minut</p>
        </div>
        <p className="tnum mt-2 text-lg leading-snug font-extrabold text-ink">Dnes 18:30</p>
        <p className="text-base font-bold text-ink">
          Masáž zad <span className="font-normal text-muted">60 min</span>
        </p>
        <p className="mt-2 text-sm">
          <span className="text-muted">Vy dostanete:</span> <span className="tnum font-bold text-ink">450 Kč</span>
        </p>
        <p className="tnum mt-3 text-xl font-extrabold text-ink">Potvrďte do 04:32</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <span className="inline-flex min-h-13 items-center justify-center rounded-xl bg-ink px-3 text-base font-bold text-accent-ink">Potvrdit</span>
          <span className="inline-flex min-h-13 items-center justify-center rounded-xl border border-line bg-card px-3 text-center text-base font-bold text-ink">Nemohu přijmout</span>
        </div>
      </div>
      <figcaption className="px-1 text-sm text-muted">
        Takhle vám přijde žádost o rezervaci. Upozornění dostanete e-mailem nebo oznámením na telefonu.
      </figcaption>
    </figure>
  );
}
