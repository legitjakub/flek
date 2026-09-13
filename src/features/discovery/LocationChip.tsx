import { MapPin, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button, Chip, Sheet } from '../../components/ui';
import { locate, PRESET_POINTS, storePoint, type Point } from '../../lib/geo';

/** Geolocation is offered, never demanded: denial falls back to a manual pin, no modal. */
export function LocationChip({
  point,
  onChange,
  floating = false,
}: {
  point: Point;
  onChange: (next: Point) => void;
  /** A white pill with a shadow, for the top of the full-screen map. */
  floating?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [denied, setDenied] = useState(false);

  function pick(next: Point) {
    storePoint(next);
    onChange(next);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={
          floating
            ? 'inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-full bg-card pr-3 pl-3.5 text-sm font-bold text-ink shadow-card'
            : 'inline-flex min-h-11 max-w-full items-center gap-2 text-sm font-bold text-accent'
        }
      >
        <MapPin size={18} aria-hidden="true" className={floating ? 'shrink-0 text-accent' : undefined} />
        <span className="truncate">{point.label}</span>
        <ChevronDown size={16} aria-hidden="true" className="shrink-0" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Kde hledáš?">
        <div className="flex flex-col gap-3">
          <Button
            variant="secondary"
            loading={pending}
            data-autofocus
            onClick={async () => {
              setPending(true);
              setDenied(false);
              try {
                pick(await locate());
              } catch {
                setDenied(true);
              } finally {
                setPending(false);
              }
            }}
          >
            Použít moji polohu
          </Button>
          {denied ? (
            <p className="text-sm text-muted">
              Polohu se nepodařilo zjistit. Vyber místo ručně — nabídky se zobrazí stejně.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {PRESET_POINTS.map((preset) => (
              <Chip key={preset.label} active={preset.label === point.label} onClick={() => pick(preset)}>
                {preset.label}
              </Chip>
            ))}
          </div>
        </div>
      </Sheet>
    </>
  );
}
