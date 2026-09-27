import type { ReactNode } from 'react';
import { IconTile, cx } from '../../components/ui';
import { calendarDay, clockTime, dayKey, dayLabel } from '../../lib/time';

/*
 * The partner console's own pieces, in the brand the customer app set: white cards on the cool
 * ground, a coloured strip that says the state before any word does, times in a column like an
 * agenda and actions along the bottom of a card instead of three outlined buttons in a pile.
 */

/** A page's heading, what it is for, and its one main action. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Rows grouped under their Prague day, in the order they came. */
export function groupByDay<T>(rows: T[], startOf: (row: T) => string): { key: string; start: string; rows: T[] }[] {
  const days: { key: string; start: string; rows: T[] }[] = [];
  for (const row of rows) {
    const key = dayKey(startOf(row));
    const last = days[days.length - 1];
    if (last?.key === key) last.rows.push(row);
    else days.push({ key, start: startOf(row), rows: [row] });
  }
  return days;
}

/** "Dnes · pátek 25. 9." or "Sobota 27. 9.": the day a group of cards belongs to. */
export function dayHeading(instant: string, now: string): string {
  const relative = dayLabel(instant, now);
  const { long } = calendarDay(instant);
  if (relative === 'Dnes' || relative === 'Zítra') return `${relative} · ${long}`;
  return long.charAt(0).toLocaleUpperCase('cs-CZ') + long.slice(1);
}

export function DayHeading({ instant, now }: { instant: string; now: string }) {
  const relative = dayLabel(instant, now);
  const { long } = calendarDay(instant);
  return (
    <h2 className="px-1 text-sm font-extrabold text-ink">
      {relative === 'Dnes' || relative === 'Zítra' ? (
        <>
          {relative}
          <span aria-hidden="true" className="mx-1.5 text-muted">·</span>
          <span className="font-bold text-muted">{long}</span>
        </>
      ) : (
        dayHeading(instant, now)
      )}
    </h2>
  );
}

/** A card's heading with its glyph, and whatever sits opposite it (a state, a link). */
export function SectionTitle({
  id,
  icon,
  tone = 'brand',
  title,
  aside,
}: {
  id?: string;
  icon: ReactNode;
  tone?: 'brand' | 'accent' | 'positive' | 'warning' | 'danger';
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h2 id={id} className="flex min-w-0 items-center gap-3 text-lg font-extrabold tracking-tight text-ink">
        <IconTile icon={icon} tone={tone} />
        {title}
      </h2>
      {aside}
    </div>
  );
}

/** A reservation code as the customer shows it, quiet enough to sit in a line of text. */
export function CodeChip({ code, tone = 'light' }: { code: string; tone?: 'light' | 'onBrand' }) {
  return (
    <span
      className={cx(
        'tnum inline-flex items-center rounded-lg px-2 py-1 font-mono text-xs font-bold tracking-[0.08em]',
        tone === 'onBrand' ? 'bg-card/15 text-brand-ink' : 'bg-surface text-ink',
      )}
    >
      {code}
    </span>
  );
}

export type Tone = 'brand' | 'positive' | 'warning' | 'muted' | 'danger';

const STRIP: Record<Tone, string> = {
  brand: 'bg-brand',
  positive: 'bg-positive',
  warning: 'bg-warning',
  muted: 'bg-line',
  danger: 'bg-danger',
};

/**
 * A card for one time: the state as a strip down its left edge, the time in a column beside the
 * content, and the actions, if any, along the bottom.
 */
export function TimeCard({
  start,
  end,
  tone,
  children,
  actions,
  dimmed = false,
}: {
  start: string;
  end: string;
  tone: Tone;
  children: ReactNode;
  actions?: ReactNode;
  dimmed?: boolean;
}) {
  return (
    <article className="relative overflow-hidden rounded-3xl bg-card shadow-card">
      <span aria-hidden="true" className={cx('absolute inset-y-0 left-0 w-1.5', STRIP[tone])} />
      {/* A card that is over reads quieter by its time and its grey edge, not by fading: faded
          grey text fell below AA contrast. */}
      <div className="flex gap-4 py-4 pr-4 pl-5 sm:py-5 sm:pr-5 sm:pl-6">
        <div className="tnum w-12 shrink-0 pt-0.5">
          <p className={cx('text-lg leading-none font-extrabold', dimmed ? 'text-muted' : 'text-ink')}>{clockTime(start)}</p>
          <p className="mt-1.5 text-xs font-bold text-muted">{clockTime(end)}</p>
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {actions ? <div className="flex border-t border-line [&>*+*]:border-l [&>*+*]:border-line">{actions}</div> : null}
    </article>
  );
}

/** One action along the bottom of a card: an icon and a word, the whole cell a 44 px target. */
export function CardAction({
  icon,
  label,
  onClick,
  tone = 'ink',
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'ink' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 text-sm font-bold transition-colors',
        tone === 'danger' ? 'text-danger hover:bg-danger/5' : 'text-ink hover:bg-surface',
      )}
    >
      <span aria-hidden="true" className="inline-flex">{icon}</span>
      {label}
    </button>
  );
}

/** "1 z 2 obsazeno" with a thin bar, so a half-full slot reads at a glance. */
export function CapacityMeter({ booked, total }: { booked: number; total: number }) {
  const share = total > 0 ? Math.min(1, booked / total) : 0;
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <span className="tnum text-xs font-bold text-muted">{booked} z {total} obsazeno</span>
    </div>
  );
}
