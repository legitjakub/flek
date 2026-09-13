import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crosshair, List } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { listCategories } from '../../lib/api';
import { money, distance } from '../../lib/format';
import { DiscountBadge, OriginalPrice } from '../../components/Price';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { ErrorState, Spinner, cx } from '../../components/ui';
import { LazyMap } from '../offers/LazyMap';
import { LocationChip } from './LocationChip';
import { FilterBar, plural } from './FilterBar';
import { useDiscoveryState } from './useDiscoveryState';
import { useDiscovery } from './useDiscovery';
import { groupMapOffers } from './mapOffers';
import { MapPreviewCard } from './MapPreviewCard';
import { locate } from '../../lib/geo';
import { serviceIllustration } from '../../lib/serviceIllustrations';
import { thumbnail } from '../../lib/thumbnail';
import type { SearchRow } from '../../types/database';

const markerTime = new Intl.DateTimeFormat('cs-CZ', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Prague',
});

/*
 * Free space the camera keeps around the results. On a phone the search controls float over
 * the top of the map and the tab bar over its bottom; a pin framed underneath either could
 * not be tapped.
 */
const PHONE_FRAME = { top: 170, right: 40, bottom: 120, left: 40 };
const WIDE_FRAME = { top: 150, right: 72, bottom: 64, left: 72 };
/* What the preview card and the controls cover while a pin is open, so the pin stays visible. */
const PHONE_FOCUS = { top: 150, bottom: 450 };
const WIDE_FOCUS = { top: 150, bottom: 400 };

/**
 * The map is the screen: full height under the header, search controls floating over its top,
 * service photos as pins. A pin opens a preview card at the bottom; the list beside the map
 * stays for wide screens, where there is room for both.
 */
export function MapPage() {
  const { point, setPoint, filters, setFilters } = useDiscoveryState();
  const { search } = useRouter();
  const [openGroup, setOpenGroup] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(false);
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const now = useServerNow();
  const discovery = useDiscovery(point, filters);
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const rows = discovery.data?.rows;
  const groups = useMemo(() => groupMapOffers(rows ?? []), [rows]);
  const selectedOffers = groups
    .filter((group) => openGroup.includes(group.id))
    .flatMap((group) => group.offers)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const origin = `/mapa${search.size ? `?${search}` : ''}`;
  const detailHref = useCallback((id: string) => `/nabidka/${id}?from=${encodeURIComponent(origin)}`, [origin]);
  const markers = useMemo(() => groups.map((group) => {
    const first = group.offers[0];
    return {
      id: group.id, lat: group.lat, lng: group.lng,
      label: `${group.offers.length > 1 ? 'od ' : ''}${money(group.minPrice)}`,
      count: group.offers.length, price: group.minPrice,
      image: thumbnail(serviceIllustration(first.service_name, first.image_url, first.cover_url)),
      description: group.offers.length === 1
        ? `${first.service_name}, ${first.business_name}, ${markerTime.format(new Date(first.start_at))}, ${money(group.minPrice)}. Zobrazit náhled.`
        : `${first.business_name}: ${group.offers.length} termíny, od ${money(group.minPrice)}. Zobrazit termíny.`,
    };
  }), [groups]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setPhone(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    setOpenGroup((current) => {
      const available = current.filter((id) => groups.some((group) => group.id === id));
      return available.length === current.length ? current : available;
    });
  }, [groups]);

  const closePreview = useCallback(() => {
    const ids = openGroup;
    setOpenGroup([]);
    // Back to the pin that opened the card, so a keyboard user does not start over at the top.
    const pin = [...document.querySelectorAll<HTMLElement>('[data-map-ids]')].find((element) =>
      ids.some((id) => (JSON.parse(element.dataset.mapIds ?? '[]') as string[]).includes(id)),
    );
    pin?.focus({ preventScroll: true });
  }, [openGroup]);

  async function useMyLocation() {
    setLocating(true);
    setLocateError(false);
    try {
      setPoint(await locate());
    } catch {
      setLocateError(true);
    } finally {
      setLocating(false);
    }
  }

  const empty = discovery.isSuccess && !rows?.length;

  return (
    <main className="map-page map-full relative flex">
      <h1 className="sr-only">Volné FLEKy na mapě</h1>

      {rows?.length ? (
        <section className="hidden w-[360px] shrink-0 flex-col border-r border-line bg-card lg:flex" aria-label="Nabídky na mapě">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-lg font-extrabold">{rows.length} {plural(rows.length)} v okolí</h2>
            <p className="mt-1 text-sm text-muted">Vyber si aktivitu a svůj čas.</p>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain">
            {rows.map((offer) => {
              const group = groups.find((g) => g.offers.some((o) => o.id === offer.id))?.id ?? null;
              return (
                <li key={offer.id} onMouseEnter={() => setHighlighted(group)} onMouseLeave={() => setHighlighted(null)} onFocus={() => setHighlighted(group)} onBlur={() => setHighlighted(null)}>
                  <MapOffer offer={offer} now={now} to={detailHref(offer.id)} />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <LazyMap
          className="absolute inset-0 h-full w-full"
          center={point}
          markers={markers}
          selectedId={openGroup[0] ?? highlighted ?? undefined}
          eager
          fitToMarkers
          framePadding={phone ? PHONE_FRAME : WIDE_FRAME}
          focusId={openGroup.length === 1 ? openGroup[0] : undefined}
          focusArea={phone ? PHONE_FOCUS : WIDE_FOCUS}
          onSelect={(id) => setOpenGroup([id])}
          onSelectGroup={setOpenGroup}
          ariaLabel="Mapa volných FLEKů. Fotka s cenou ukáže náhled, číslo přiblíží mapu."
        />

        {/* Search floats over the map. The wrapper lets taps through to the map between controls. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-3 bg-gradient-to-b from-surface/80 via-surface/40 to-transparent px-3 pt-3 pb-6 md:px-4">
          <div className="pointer-events-auto flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <LocationChip point={point} onChange={setPoint} floating />
            </div>
            <Link
              to={`/${search.size ? `?${search}` : ''}`}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-card px-4 text-sm font-bold text-ink shadow-card lg:hidden"
            >
              <List size={18} aria-hidden="true" />
              Seznam
            </Link>
            <button
              type="button"
              aria-label="Najít nabídky u mojí polohy"
              title="Moje poloha"
              disabled={locating}
              onClick={() => void useMyLocation()}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-card text-ink shadow-card disabled:opacity-60"
            >
              <Crosshair size={19} className={locating ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
          </div>
          <div className="pointer-events-auto">
            <FilterBar
              filters={filters}
              onChange={setFilters}
              categories={categories.data ?? []}
              resultCount={rows?.length ?? 0}
              pending={discovery.isFetching}
              applied={discovery.data?.applied}
              note={discovery.data?.note}
              floating
            />
          </div>
          {locateError ? (
            <p role="status" className="pointer-events-auto self-start rounded-2xl bg-card px-4 py-2.5 text-sm text-ink shadow-card">
              Polohu se nepodařilo zjistit. Vyber místo ručně.
            </p>
          ) : null}
        </div>

        {/* Status and preview sit over the bottom, clear of the floating tab bar on a phone. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-20 flex flex-col items-center md:bottom-4 md:items-start">
          {discovery.isPending ? (
            <p role="status" className="pointer-events-auto mx-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-card px-4 text-sm font-bold text-ink shadow-card">
              <Spinner /> Hledám volné FLEKy…
            </p>
          ) : null}
          {discovery.isError ? (
            <div className="pointer-events-auto mx-3 w-[calc(100%-1.5rem)] max-w-sm rounded-3xl bg-card p-4 shadow-lift">
              <ErrorState error={discovery.error} onRetry={() => discovery.refetch()} />
            </div>
          ) : null}
          {empty ? (
            <div className="pointer-events-auto mx-3 w-[calc(100%-1.5rem)] max-w-sm rounded-3xl bg-card p-5 shadow-lift">
              <p className="text-base font-extrabold text-ink">V okolí teď nic volného není.</p>
              <p className="mt-1 text-sm text-muted">Zkus jiné místo nebo čas nahoře nad mapou.</p>
            </div>
          ) : null}
          {selectedOffers.length ? (
            <MapPreviewCard
              key={openGroup.join(':')}
              offers={selectedOffers}
              now={now}
              detailHref={detailHref}
              onClose={closePreview}
              className="w-full md:max-w-md"
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

/** One appointment in the list beside the map on wide screens. */
function MapOffer({ offer, now, to }: { offer: SearchRow; now: string; to: string }) {
  const photo = thumbnail(serviceIllustration(offer.service_name, offer.image_url, offer.cover_url));
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 p-3 transition-colors hover:bg-surface focus-visible:bg-accent-soft"
    >
      <span className={cx('size-14 shrink-0 overflow-hidden rounded-2xl bg-accent-soft')} aria-hidden="true">
        {photo ? <img src={photo} alt="" loading="lazy" decoding="async" className="size-full object-cover" /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-base leading-snug font-extrabold text-ink">{offer.service_name}</span>
          <span className="tnum shrink-0 text-base leading-snug font-extrabold text-ink">{money(offer.deal_price_cents)}</span>
        </span>
        <span className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-sm text-muted">
            {offer.business_name}
            {offer.district ? ` · ${offer.district}` : ''}
          </span>
          {offer.original_price_cents > offer.deal_price_cents ? (
            <OriginalPrice cents={offer.original_price_cents} className="shrink-0 text-sm" />
          ) : null}
        </span>
        <span className="flex items-baseline gap-3">
          <span className="tnum min-w-0 flex-1 truncate text-sm">
            <span className="font-bold text-ink">
              {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}
            </span>
            <span className="text-muted">
              {' · '}
              {duration(offer.start_at, offer.end_at)} min
              {distance(offer.distance_m) ? ` · ${distance(offer.distance_m)}` : ''}
            </span>
          </span>
          <DiscountBadge pct={offer.discount_pct} className="shrink-0" />
        </span>
      </span>
    </Link>
  );
}
