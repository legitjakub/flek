import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, MapPin } from 'lucide-react';
import { Link } from '../../app/router';
import { Button, cx } from '../../components/ui';
import { listCategories, myWatches, saveWatch } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import type { Category, FlekWatch } from '../../types/database';
import { useSession } from '../auth/session';
import { DAYPART_LABELS } from '../discovery/filters';
import { NOTIFICATIONS_ENABLED } from '../notifications/Notifications';
import { radiusLabel, travelSentence } from './travel';
import { WatchSheet } from './WatchSheet';

export function useWatches() {
  const { userId } = useSession();
  return useQuery({
    queryKey: ['watches', userId],
    queryFn: myWatches,
    enabled: NOTIFICATIONS_ENABLED && Boolean(userId),
    staleTime: 60_000,
  });
}

/** „do 20 min pěšky · Masáže · do 500 Kč · večer" — the watch in one line. */
export function watchSummary(watch: FlekWatch, categories: Category[]): string {
  return [
    `${travelSentence(watch.travel_mode, watch.travel_minutes)} (${radiusLabel(watch.radius_m)})`,
    watch.category ? categories.find((category) => category.slug === watch.category)?.label_cs ?? null : null,
    watch.max_price_cents ? `do ${money(watch.max_price_cents)}` : null,
    watch.min_discount_pct ? `−${watch.min_discount_pct} % a víc` : null,
    watch.daypart ? DAYPART_LABELS[watch.daypart].toLocaleLowerCase('cs-CZ') : null,
  ].filter(Boolean).join(' · ');
}

/** „je 1 FLEK", „jsou 3 FLEKy", „je 7 FLEKů" — Czech agrees the verb with the count too. */
function fleksNow(count: number): string {
  if (count === 1) return 'je 1 FLEK';
  return count < 5 ? `jsou ${count} FLEKy` : `je ${count} FLEKů`;
}

/** The customer's watches in Profile: what each one covers, and pause, edit or look at it on the map. */
export function WatchList() {
  const { userId } = useSession();
  const watches = useWatches();
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<FlekWatch | null>(null);
  const [error, setError] = useState('');

  if (!NOTIFICATIONS_ENABLED || !userId) return null;

  async function togglePause(watch: FlekWatch) {
    setError('');
    try {
      const { id, radius_m: _r, created_at: _c, last_alert_at: _l, matching_now: _m, ...input } = watch;
      await saveWatch({ ...input, paused: !watch.paused }, id);
      await queryClient.invalidateQueries({ queryKey: ['watches'] });
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  const list = watches.data ?? [];

  return (
    <section className="flex flex-col gap-3" aria-labelledby="hlidac">
      <h2 id="hlidac" className="px-1 text-lg font-extrabold tracking-tight text-ink">Hlídač FLEKů</h2>
      {watches.isPending ? null : list.length === 0 ? (
        <div className="rounded-3xl bg-card p-5 shadow-card">
          <p className="flex items-start gap-3 text-base text-ink">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand text-brand-ink" aria-hidden="true">
              <BellRing size={19} />
            </span>
            <span>
              <strong className="block">Nech si hlídat okolí</strong>
              <span className="text-sm text-muted">Když se kousek od tebe uvolní FLEK podle tvého výběru, pípne ti telefon.</span>
            </span>
          </p>
          <Link to="/mapa" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-bold text-brand-ink hover:bg-accent">
            Nastavit na mapě
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-3xl bg-card shadow-card">
          {list.map((watch) => (
            <li key={watch.id} className="p-4">
              <div className="flex items-start gap-3">
                <span
                  className={cx('grid size-10 shrink-0 place-items-center rounded-2xl', watch.paused ? 'bg-surface text-muted' : 'bg-brand text-brand-ink')}
                  aria-hidden="true"
                >
                  <BellRing size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate pt-0.5 font-extrabold text-ink">{watch.label}</p>
                  <p className="text-sm text-muted">{watchSummary(watch, categories.data ?? [])}</p>
                  <p className={cx('tnum mt-1 text-sm font-bold', watch.paused ? 'text-muted' : 'text-accent')}>
                    {watch.paused
                      ? 'Pozastavený'
                      : watch.matching_now
                        ? `Teď tu ${fleksNow(watch.matching_now)}`
                        : 'Teď tu nic není — ozveme se'}
                  </p>
                </div>
                {/* On and off is a switch, not a third button: three did not fit on one row of a phone. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={!watch.paused}
                  aria-label={`Hlídač ${watch.label}`}
                  onClick={() => void togglePause(watch)}
                  className="-mt-1.5 -mr-1.5 grid min-h-11 min-w-11 shrink-0 place-items-center"
                >
                  <span className={cx('relative h-7 w-12 rounded-full transition-colors', watch.paused ? 'bg-line' : 'bg-brand')} aria-hidden="true">
                    <span className={cx('absolute top-1 size-5 rounded-full bg-card shadow-sm transition-[left]', watch.paused ? 'left-1' : 'left-6')} />
                  </span>
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to={`/mapa?hlidac=${watch.id}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent-soft px-4 text-sm font-bold text-accent hover:bg-brand-soft"
                >
                  <MapPin size={16} aria-hidden="true" /> Na mapě
                </Link>
                <Button variant="secondary" shape="pill" onClick={() => setEditing(watch)}>Upravit</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="px-1 text-sm text-danger">{error}</p> : null}
      <WatchSheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        watch={editing}
        mapPoint={editing ? { lat: editing.lat, lng: editing.lng, label: editing.label } : { lat: 50.0875, lng: 14.4213, label: 'Praha' }}
        here={null}
        categories={categories.data ?? []}
      />
    </section>
  );
}
