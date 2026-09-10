import { money } from '../lib/format';

/**
 * Every price in the product, in one place.
 *
 * It was written by hand at each call site before this, and the two customer-facing discount
 * badges agreed on nothing: 12 px against 14, weight 700 against 800, rounded-md against
 * rounded-lg, px-1.5 against px-2. The struck original appeared in three different forms,
 * once as a `line-through` utility and three times as a bare `<s>`.
 *
 * The hierarchy also had it backwards for a product about discounts. The original price and
 * the percentage were the smallest type on a card — 12 px — and the original sat in exactly
 * the grey used for the district and the distance, so the number the deal is measured against
 * read as metadata. The badge used the generic interactive accent, the same colour as the
 * calendar glyph two columns away. Here the badge is filled and the saving is stated in
 * crowns, because "ušetříš 260 Kč" is a fact and "−40 %" is arithmetic homework.
 */

/** What the customer keeps. Never negative: a deal is never worse than the list price. */
export function savings(originalCents: number, dealCents: number): number {
  return Math.max(0, originalCents - dealCents);
}

/**
 * Filled, and in the deep accent rather than the logo's lime.
 *
 * The lime was tried here — ink on it measures 7.3:1, so legibility was never the question.
 * It simply read as too loud for something that repeats on every card in the feed, on the
 * map and on the detail page at once. White on the accent measures 5.1:1 and is the same
 * green the rest of the interface already speaks in, which is the point: the badge is a
 * fact about the price, not a second logo.
 */
export function DiscountBadge({ pct, className = '' }: { pct: number; className?: string }) {
  if (pct <= 0) return null;
  return (
    <span
      className={`tnum inline-flex items-center rounded-lg bg-accent px-2 py-0.5 text-xs font-extrabold text-accent-ink ${className}`}
    >
      −{pct} %
    </span>
  );
}

/**
 * The list price, struck. The rule is drawn deliberately — the browser's default over 12 px
 * muted text was nearly invisible — and it is drawn in the danger colour because it marks
 * the one number on the card the customer does *not* pay. That is the only place red earns
 * its place in a price.
 */
export function OriginalPrice({ cents, className = '' }: { cents: number; className?: string }) {
  return (
    <s className={`tnum text-muted decoration-danger decoration-2 ${className}`}>{money(cents)}</s>
  );
}

export function Price({
  dealCents,
  originalCents,
  discountPct,
  variant = 'card',
  showSaving = false,
  showBadge = true,
  align = 'left',
  className = '',
}: {
  dealCents: number;
  originalCents: number;
  discountPct: number;
  /** `card` and `detail` stack the two lines; `row` keeps everything on one baseline. */
  variant?: 'card' | 'detail' | 'row';
  showSaving?: boolean;
  /** Off where the badge already sits somewhere louder — the corner of a card's photo. */
  showBadge?: boolean;
  /** The card puts this column hard right, so the wrapped rows have to follow it. */
  align?: 'left' | 'right';
  className?: string;
}) {
  const discounted = originalCents > dealCents;
  const saved = savings(originalCents, dealCents);

  if (variant === 'row') {
    return (
      <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
        <span className="tnum text-base font-extrabold text-ink">{money(dealCents)}</span>
        {discounted ? <OriginalPrice cents={originalCents} className="text-sm" /> : null}
        {discounted && showBadge ? <DiscountBadge pct={discountPct} /> : null}
      </span>
    );
  }

  const row = align === 'right' ? 'justify-end' : '';
  return (
    <div className={className}>
      <p className="tnum text-xl leading-none font-extrabold text-ink">{money(dealCents)}</p>
      {discounted ? (
        <p className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${row}`}>
          <OriginalPrice cents={originalCents} />
          {showBadge ? <DiscountBadge pct={discountPct} /> : null}
        </p>
      ) : null}
      {discounted && showSaving ? (
        <p className="tnum mt-1 text-sm font-bold text-positive">Ušetříš {money(saved)}</p>
      ) : null}
    </div>
  );
}
