import { cx } from './ui';

/** A quiet disclosure for generated and catalogue imagery used to illustrate a service. */
export function IllustrativePhotoLabel({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        'pointer-events-none absolute z-[1] rounded-full bg-ink/45 px-1.5 py-[3px] font-medium leading-none text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]',
        compact ? 'text-[8px]' : 'text-[10px]',
        className,
      )}
    >
      ilustrační foto
    </span>
  );
}
