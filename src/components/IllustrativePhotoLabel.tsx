import { cx } from './ui';

/** A quiet disclosure for generated and catalogue imagery used to illustrate a service. */
export function IllustrativePhotoLabel({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        'pointer-events-none absolute z-[1] rounded-md bg-ink/72 font-bold leading-none tracking-wide text-card shadow-sm backdrop-blur-sm',
        compact ? 'px-1 py-0.5 text-[8px]' : 'px-1.5 py-1 text-[10px]',
        className,
      )}
    >
      Ilustrační foto
    </span>
  );
}
