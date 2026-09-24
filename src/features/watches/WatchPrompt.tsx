import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellPlus, BellRing, ChevronRight } from 'lucide-react';
import { Link } from '../../app/router';
import { Button, cx } from '../../components/ui';
import { listCategories } from '../../lib/api';
import type { Point } from '../../lib/geo';
import type { Filters } from '../discovery/filters';
import { NOTIFICATIONS_ENABLED } from '../notifications/Notifications';
import { useWatches } from './WatchList';
import { WatchSheet } from './WatchSheet';

/**
 * The watch where a customer finds nothing to do: an empty feed, the end of it, no bookings yet.
 * It starts from the place and filters of the screen it sits on. With a watch already running it
 * only says so and leads to it — a second invitation would read as if the first one had failed.
 */
export function WatchPrompt({ point, filters, className }: { point: Point; filters?: Filters; className?: string }) {
  const watches = useWatches();
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  if (!NOTIFICATIONS_ENABLED || watches.isLoading) return null;
  const running = (watches.data ?? []).filter((watch) => !watch.paused);

  if (running.length) {
    return (
      <div className={className}>
        <Link
          to={`/mapa?hlidac=${running[0].id}`}
          className="flex min-h-16 items-center gap-3 rounded-3xl bg-card px-4 py-3 shadow-card transition-colors hover:bg-surface"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand text-brand-ink" aria-hidden="true">
            <BellRing size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-ink">
              {running.length === 1 ? 'Hlídač běží' : `Běží ${running.length} hlídače`}
            </span>
            <span className="block truncate text-sm text-muted">Ozveme se, až se něco uvolní.</span>
          </span>
          <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
        </Link>
        {note ? <p role="status" className="mt-2 px-1 text-sm text-muted">{note}</p> : null}
      </div>
    );
  }

  return (
    <section aria-labelledby="hlidac-pozvanka" className={cx('rounded-3xl bg-card p-5 shadow-card', className)}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand text-brand-ink" aria-hidden="true">
          <BellPlus size={19} />
        </span>
        <div className="min-w-0">
          <h2 id="hlidac-pozvanka" className="text-base font-extrabold tracking-tight text-ink">Nech si hlídat okolí</h2>
          <p className="text-sm text-muted">Když se kousek od tebe uvolní FLEK podle tvého výběru, pípne ti telefon.</p>
        </div>
      </div>
      <Button variant="brand" shape="pill" className="mt-4" onClick={() => setOpen(true)}>
        Nastavit hlídač
      </Button>
      <WatchSheet
        open={open}
        onClose={() => setOpen(false)}
        mapPoint={{ lat: point.lat, lng: point.lng, label: point.label || 'Moje okolí' }}
        here={null}
        filters={filters}
        categories={categories.data ?? []}
        onSaved={(_id, saved) => setNote(saved)}
      />
    </section>
  );
}
