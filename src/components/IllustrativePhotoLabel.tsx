import { cx } from './ui';

/** A quiet disclosure for generated and catalogue imagery used to illustrate a service. */
export function IllustrativePhotoLabel({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        'pointer-events-none absolute z-[1] font-medium leading-none text-white/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.9)]',
        compact ? 'text-[8px]' : 'text-[10px]',
        className,
      )}
    >
      ilustrační foto
    </span>
  );
}
