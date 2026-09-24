import { useEffect, useState } from 'react';
import { BellRing, CalendarPlus, HandCoins, MapPin, QrCode } from 'lucide-react';
import { Sheet } from '../../components/ui';
import { useLegalInfo } from '../legal/useLegal';
import { MoneyExplainer } from './MoneyExplainer';

/*
 * The five steps say what the product does today and nothing more; each detail is in the terms
 * for venues (podminky-podniky.md): 7 days ahead, 3 to 10 minutes to confirm, the amount blocked
 * until then, the whole amount kept on a no-show, payouts by Stripe. Shared by the page a venue
 * sees before signing up and by the help it can open from the console.
 */
export const PARTNER_STEPS = [
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

export function PartnerSteps() {
  return (
    <ol className="flex flex-col gap-4">
      {PARTNER_STEPS.map(({ icon: Icon, title, text }, index) => (
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
  );
}

/**
 * A booking request as the dashboard shows it, drawn once with sample values so a venue sees
 * the whole job before it happens: a time, what they get, a countdown and two buttons. No
 * venue or customer name, since there is no real one behind it.
 */
export function RequestPreview() {
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

/** The confirmation windows, as `private.decide_booking` and the terms for venues set them. */
export function ConfirmationWindows() {
  return (
    <ul className="flex flex-col gap-1 text-sm text-ink">
      <li><span className="font-bold">10 minut</span>, když termín začíná za víc než 2 hodiny,</li>
      <li><span className="font-bold">5 minut</span>, když začíná za 30 minut až 2 hodiny,</li>
      <li><span className="font-bold">3 minuty</span>, když začíná za 15 až 30 minut,</li>
      <li>vždy nejpozději 10 minut před začátkem. Termín, který začíná dřív než za 15 minut, si rezervovat nejde.</li>
    </ul>
  );
}

const OPEN_HELP = 'flek:open-partner-help';

/** Opens "Jak FLEK funguje" from anywhere in the console. It never opens by itself. */
export function openPartnerHelp() {
  window.dispatchEvent(new Event(OPEN_HELP));
}

/**
 * The whole product for a venue on one sheet: the steps, a request, the minutes to answer, the
 * money and who to write to. Mounted once in the console frame and opened only on request, so
 * a venue that knows its way around never sees it again.
 */
export function PartnerHelp() {
  const [open, setOpen] = useState(false);
  const legal = useLegalInfo();
  const email = legal.data?.operator.email;

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_HELP, show);
    return () => window.removeEventListener(OPEN_HELP, show);
  }, []);

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Jak FLEK funguje">
      <div className="flex flex-col gap-6">
        <PartnerSteps />
        <RequestPreview />
        <section aria-labelledby="napoveda-potvrzeni" className="rounded-2xl bg-surface p-4">
          <h3 id="napoveda-potvrzeni" className="text-base font-extrabold text-ink">Kolik máte času na potvrzení</h3>
          <div className="mt-2"><ConfirmationWindows /></div>
        </section>
        <MoneyExplainer />
        {email ? (
          <p className="text-sm text-muted">
            Potřebujete poradit? Napište nám na{' '}
            <a href={`mailto:${email}`} className="font-bold text-accent underline underline-offset-4">{email}</a>.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
