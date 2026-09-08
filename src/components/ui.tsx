import { Dialog } from '@base-ui/react/dialog';
import { Star, X } from 'lucide-react';
import { useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { errorMessage } from '../lib/errors';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ wordmark */

/**
 * The FLEK monogram: the wordmark's own lowercase "f" with the two motion dashes. Used
 * where the full wordmark would be unreadable — favicon, app icon, tight spaces.
 */
export function Mark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={className}>
      <g fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M42 15c-8.6 0-14.5 5.6-14.5 14V50" />
        <path d="M17.5 31.5h19" />
      </g>
      {/* The dashes carry the brand colour; the letter stays ink. */}
      <g fill="none" stroke="var(--color-brand)" strokeWidth="7" strokeLinecap="round">
        <path d="M49.5 20.5 56 13" />
        <path d="M53.5 33.5 60.5 30" />
      </g>
    </svg>
  );
}

/** Two dashes leaving the k — the only decorative part of the identity. */
function Dashes({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className={className}>
      <g fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
        <path d="M6 12 14 3" />
        <path d="M11.5 17 18.5 13.5" />
      </g>
    </svg>
  );
}

/**
 * The single place the FLEK wordmark is drawn, so it can be replaced in one component.
 * Lowercase and tightly set, with the dashes lifting off the k.
 */
export function Wordmark({ tone = 'ink', suffix }: { tone?: 'ink' | 'invert'; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-start">
        <span
          className={cx(
            'text-2xl leading-none font-extrabold lowercase',
            tone === 'invert' ? 'text-surface' : 'text-ink',
          )}
          style={{ letterSpacing: '-0.055em' }}
        >
          flek
        </span>
        <Dashes className="mt-[-3px] ml-0.5 size-3.5 shrink-0 text-brand" />
      </span>
      {suffix ? <span className="text-xs font-semibold tracking-wide text-muted uppercase">{suffix}</span> : null}
    </span>
  );
}

/* -------------------------------------------------------------------- button */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'md', loading, className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        size === 'lg' ? 'min-h-13 px-5 text-base' : 'text-sm',
        variant === 'primary' && 'bg-accent text-accent-ink hover:bg-[#07534d]',
        variant === 'secondary' && 'border border-line bg-card text-ink hover:bg-surface',
        variant === 'ghost' && 'text-ink hover:bg-line/50',
        variant === 'danger' && 'border border-danger/25 bg-card text-danger hover:bg-danger/5',
        className,
      )}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? 'Načítáme'}
      className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

/* ----------------------------------------------------------------- form bits */

export function Field({
  label,
  error,
  hint,
  children,
  id,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        'min-h-11 w-full rounded-xl border border-line bg-card px-3 text-base text-ink placeholder:text-muted/70',
        rest['aria-invalid'] ? 'border-accent' : '',
        className,
      )}
    />
  );
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cx('min-h-24 w-full rounded-xl border border-line bg-card p-3 text-base text-ink', className)}
    />
  );
}

export function Select({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx('min-h-11 w-full rounded-xl border border-line bg-card px-3 text-base text-ink', className)}
    />
  );
}

/* ------------------------------------------------------------------- states */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-xl bg-line/60', className)} />;
}

export function LoadingList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Načítáme">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-10 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-line bg-accent-soft px-5 py-6 text-center">
      <p className="text-sm font-semibold text-ink">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Zkusit znovu
        </Button>
      ) : null}
    </div>
  );
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'success'; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cx(
        'rounded-xl border px-4 py-3 text-sm',
        tone === 'info' && 'border-line bg-card text-ink',
        tone === 'warning' && 'border-accent/25 bg-accent-soft text-ink',
        tone === 'success' && 'border-positive/25 bg-positive/8 text-positive',
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------- sheet */

/** Bottom sheet on phones, centred dialog from `md` up. Focus-trapped and Esc-closable. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  returnFocus?: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-ink/40 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
          <Dialog.Popup ref={ref} finalFocus={returnFocus} initialFocus={(type) => type === 'touch' ? ref.current : ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? true} className="relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-card text-ink shadow-card outline-none md:max-w-lg md:rounded-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
              <Dialog.Title className="text-lg font-extrabold tracking-tight">{title}</Dialog.Title>
              <Dialog.Close aria-label="Zavřít" className="grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface"><X size={20} aria-hidden="true" /></Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
            {footer ? <div className="border-t border-line px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* --------------------------------------------------------------------- misc */

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  items: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto rounded-xl bg-line/50 p-1">
      {items.map((item, index) => (
        <button
          key={item.value}
          role="tab"
          type="button"
          aria-selected={value === item.value}
          tabIndex={value === item.value ? 0 : -1}
          onKeyDown={(event) => {
            const next = choiceIndex(event.key, index, items.length);
            if (next === null) return;
            event.preventDefault();
            onChange(items[next].value);
            (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
          }}
          onClick={() => onChange(item.value)}
          className={cx(
            'min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-colors',
            value === item.value ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Segmented control for mutually exclusive choices. Reads as one control rather than a
 * loose row of buttons, which is what makes a filter panel feel considered.
 */
export function Segmented<T extends string | number | null>({
  value,
  onChange,
  options,
  label,
  columns,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
  label: string;
  columns?: number;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-1 rounded-xl bg-line/45 p-1"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(event) => {
              const next = choiceIndex(event.key, index, options.length);
              if (next === null) return;
              event.preventDefault();
              onChange(options[next].value);
              (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
            }}
            onClick={() => onChange(option.value)}
            className={cx(
              'min-h-11 rounded-lg px-1.5 text-sm font-semibold transition-colors',
              active ? 'bg-accent text-card shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Removable pill for one applied filter. */
export function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-ink pr-1 pl-3 text-sm font-semibold text-surface">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Zrušit filtr ${label}`}
        className="grid size-11 place-items-center rounded-full text-surface/80 hover:bg-surface/15 hover:text-surface"
      >
        <span aria-hidden="true">×</span>
      </button>
    </span>
  );
}

/** Skeleton shaped like an offer card, so loading does not reflow into content. */
export function CardSkeleton() {
  return (
    <div className="flex min-h-56 flex-col gap-3 rounded-2xl border border-line bg-card p-5" role="status" aria-label="Načítáme nabídku">
      <Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-3 h-10 w-32" /><Skeleton className="mt-auto h-6 w-24" />
    </div>
  );
}

/** Ratings are only shown once enough people have attended for the number to mean something. */
export const RATING_THRESHOLD = 3;

export function Rating({
  average,
  count,
  size = 'sm',
  showNew = true,
}: {
  average: number | null;
  count: number;
  size?: 'sm' | 'md';
  showNew?: boolean;
}) {
  const text = size === 'md' ? 'text-base' : 'text-sm';
  if (average == null || count < RATING_THRESHOLD) {
    return showNew ? <span className={cx(text, 'text-muted')}>Nové na FLEK</span> : null;
  }
  const value = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(average);
  return (
    <span className={cx('tnum inline-flex items-center gap-1 font-semibold', text)}>
      <Star aria-hidden="true" size={size === 'md' ? 17 : 15} className="fill-ink text-ink" />
      {value}
      <span className="font-normal text-muted">({count})</span>
      <span className="sr-only">z 5, {count} hodnocení</span>
    </span>
  );
}

export function Chip({
  active,
  children,
  ...rest
}: { active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      aria-pressed={active}
      className={cx(
        'min-h-11 shrink-0 rounded-xl border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors',
        active ? 'border-ink bg-ink text-surface' : 'border-line bg-card text-ink hover:border-ink/40',
      )}
    >
      {children}
    </button>
  );
}

function choiceIndex(key: string, current: number, length: number): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + length) % length;
  return null;
}
