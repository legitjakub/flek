import { money } from '../../lib/format';
import { quote } from '../../lib/pricing';

/*
 * The example is computed, not typed: 788 Kč is whatever the real fee function says for
 * 750 Kč, so this card can never promise a number the product does not charge.
 */
const REGULAR = 100_000;
const EXAMPLE = quote(75_000, REGULAR)!;

/**
 * "A kolik mi teda FLEK vezme?" — answered before the first FLEK exists, in one picture:
 * the merchant names the amount, the customer sees a final price, and the merchant gets
 * exactly what they named.
 */
export function MoneyExplainer({ className = '' }: { className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-card p-4 ${className}`} aria-labelledby="jak-penize">
      <h2 id="jak-penize" className="text-lg font-extrabold tracking-tight text-ink">Jak fungují peníze</h2>
      <p className="mt-1 text-sm text-muted">Vy určujete, kolik chcete za volný termín dostat.</p>

      <dl className="tnum mt-3 flex flex-col gap-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Běžně služba stojí</dt>
          <dd className="text-muted">{money(REGULAR)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Vy chcete dostat</dt>
          <dd className="font-bold text-ink">{money(EXAMPLE.merchantCents)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">FLEK zákazníkovi ukáže</dt>
          <dd className="font-bold text-ink">{money(EXAMPLE.customerCents)}</dd>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2">
          <dt className="text-base font-bold text-ink">Vy dostanete</dt>
          <dd className="text-xl font-extrabold text-ink">{money(EXAMPLE.merchantCents)}</dd>
        </div>
      </dl>

      <p className="mt-3 text-sm leading-relaxed text-muted">
        Servisní poplatek FLEK platí zákazník. Vám z částky, kterou nastavíte, FLEK žádnou provizi nestrhává.
      </p>
    </section>
  );
}
