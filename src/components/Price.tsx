import { money } from '../lib/format';
import { cx } from './ui';

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
 *
 * Three roles, and every screen uses the same ones: the price you pay is the loudest number,
 * the regular price is a calm grey reference ("běžně", the word the terms use), and the saving
 * is a small gain in the brand's light tint. Red has no part in it: the palette keeps the
 * discount blue so that it never reads as a status, and a red rule said "error" instead.
 */

/** What the customer keeps. Never negative: a deal is never worse than the list price. */
export function savings(originalCents: number, dealCents: number): number {
  return Math.max(0, originalCents - dealCents);
}

/**
 * The brand ultramarine is the promotional highlight; white on it reads at 9.1 : 1.
 * Text links and status labels use the darker tone of the same ultramarine family.
 */
export function DiscountBadge({
  pct,
  size = 'sm',
  className = '',
}: {
  pct: number;
  /** `lg` is the pill that sits in the corner of a photograph, beside the time. */
  size?: 'sm' | 'lg';
  className?: string;
}) {
  if (pct <= 0) return null;
  return (
    <span
      className={`tnum inline-flex items-center bg-brand font-extrabold text-brand-ink ${size === 'lg' ? 'rounded-full px-2.5 py-1.5 text-sm leading-none' : 'rounded-lg px-2 py-0.5 text-xs'} ${className}`}
    >
      −{pct} %
    </span>
  );
}

/**
 * The regular price, for comparison. It used to be struck with a 2 px rule in the danger red,
 * on 11–12 px grey: the rule sat across the middle of the digits, the number was hard to read,
 * and the one detail a discount service wants you to enjoy looked like a correction. Now it is
 * grey with a thin grey rule, never smaller than 12 px, and the paid price above it carries
 * the weight.
 *
 * Screen readers do not announce a strike, so "1 200 Kč 750 Kč" was two prices with no
 * meaning. The word "běžně" is always there: visible when `label` is given (where the width
 * allows it), otherwise only for assistive technology.
 */
export function OriginalPrice({
  cents,
  label,
  tone = 'muted',
  className = '',
}: {
  cents: number;
  /** A visible word before the amount, usually "běžně". */
  label?: string;
  /** `onBrand` for the filled ultramarine surfaces, where grey would disappear. */
  tone?: 'muted' | 'onBrand';
  className?: string;
}) {
  return (
    <span className={cx('tnum whitespace-nowrap', tone === 'onBrand' ? 'text-brand-ink/80' : 'text-muted', className)}>
      {label ? `${label} ` : <span className="sr-only">běžně </span>}
      <s className={cx('decoration-[1.5px]', tone === 'onBrand' ? 'decoration-brand-ink/55' : 'decoration-muted/50')}>
        {money(cents)}
      </s>
    </span>
  );
}

/**
 * The saving in crowns, as a small gain rather than a crossed-out loss. Brand tint on light
 * surfaces, a translucent white on the filled ultramarine ones.
 */
export function SavingPill({
  cents,
  tone = 'soft',
  className = '',
}: {
  cents: number;
  tone?: 'soft' | 'onBrand';
  className?: string;
}) {
  if (cents <= 0) return null;
  return (
    <span
      className={cx(
        'tnum inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap',
        tone === 'onBrand' ? 'bg-brand-ink/15 text-brand-ink' : 'bg-brand-soft text-accent',
        className,
      )}
    >
      ušetříš {money(cents)}
    </span>
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
        <p className={`mt-1.5 flex ${row}`}>
          <SavingPill cents={saved} />
        </p>
      ) : null}
    </div>
  );
}
