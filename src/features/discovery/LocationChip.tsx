import { MapPin, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Button, Chip, Sheet } from '../../components/ui';
import { locate, PRESET_POINTS, storePoint, type Point } from '../../lib/geo';

/** Geolocation is offered, never demanded: denial falls back to a manual pin, no modal. */
export function LocationChip({ point, onChange }: { point: Point; onChange: (next: Point) => void }) {
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
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="inline-flex min-h-11 max-w-full items-center gap-2 text-sm font-bold text-accent"><MapPin size={18} aria-hidden="true" /><span className="truncate">{point.label}</span><ChevronDown size={16} aria-hidden="true" /></button>
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
