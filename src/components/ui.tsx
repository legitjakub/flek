import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { errorMessage } from '../lib/errors';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ wordmark */

/** The single place the VOLNO identity is drawn, so it can be swapped in one edit. */
export function Wordmark({ tone = 'ink', suffix }: { tone?: 'ink' | 'invert'; suffix?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className={cx(
          'text-lg font-extrabold tracking-[-0.06em]',
          tone === 'invert' ? 'text-surface' : 'text-ink',
        )}
      >
        VOLN
        <span className="text-accent">O</span>
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
        variant === 'primary' && 'bg-accent text-accent-ink hover:bg-[#b82809]',
        variant === 'secondary' && 'border border-line bg-card text-ink hover:bg-surface',
        variant === 'ghost' && 'text-ink hover:bg-line/50',
        variant === 'danger' && 'border border-line bg-card text-accent hover:bg-accent-soft',
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
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-accent">
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
    <div className="flex flex-col gap-3" role="status" aria-label="Načítáme nabídky">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-card/60 px-5 py-10 text-center">
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.querySelector<HTMLElement>('[data-autofocus],button,input,select,textarea,a[href]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-card md:max-w-lg md:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Zavřít" className="min-h-11 px-3">
            ✕
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <div className="border-t border-line px-4 py-3">{footer}</div> : null}
      </div>
    </div>
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
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          type="button"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cx(
            'min-h-9 shrink-0 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-colors',
            value === item.value ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
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
        'min-h-10 shrink-0 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors',
        active ? 'border-ink bg-ink text-surface' : 'border-line bg-card text-ink hover:border-ink/40',
      )}
    >
      {children}
    </button>
  );
}
