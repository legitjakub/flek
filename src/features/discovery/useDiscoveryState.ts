import { useRouter } from '../../app/router';
import { DEFAULT_POINT, storedPoint, storePoint, type Point } from '../../lib/geo';
import { DEFAULT_FILTERS, DAYPART_LABELS, SORT_LABELS, WHEN_LABELS, type Filters } from './filters';

const FILTER_KEYS = Object.keys(DEFAULT_FILTERS) as (keyof Filters)[];
function numberIn(value: string | null, fallback: number, min: number, max: number) {
  const n = value === null || value === '' ? NaN : Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** URL is the shared source of truth for list/map, reload and browser back. */
export function readDiscoveryState(search: URLSearchParams, fallback: Point = DEFAULT_POINT) {
  const when = search.get('when');
  const part = search.get('daypart');
  const sort = search.get('sort');
  const filters: Filters = {
    when: when && Object.hasOwn(WHEN_LABELS, when) ? when as Filters['when'] : DEFAULT_FILTERS.when,
    daypart: part && Object.hasOwn(DAYPART_LABELS, part) ? part as Filters['daypart'] : null,
    sort: sort && Object.hasOwn(SORT_LABELS, sort) ? sort as Filters['sort'] : DEFAULT_FILTERS.sort,
    radius_m: numberIn(search.get('radius_m'), 5000, 100, 25000),
    // A slug shape, not any 80 characters: an unrecognised category filters to nothing
    // for good — the widening ladder never touches it — so at least keep junk out of it.
    category: /^[a-z0-9-]{1,40}$/.test(search.get('category') ?? '') ? search.get('category') : null,
    min_discount_pct: numberIn(search.get('min_discount_pct'), 0, 0, 100),
    max_price_cents: numberIn(search.get('max_price_cents'), 0, 0, 100_000_000) || null,
  };
  const hasPoint = search.has('lat') && search.has('lng');
  const point: Point = hasPoint ? {
    lat: numberIn(search.get('lat'), fallback.lat, -90, 90),
    lng: numberIn(search.get('lng'), fallback.lng, -180, 180),
    label: search.get('place')?.slice(0, 80) || 'Vybrané místo',
  } : fallback;
  return { filters, point };
}

export function useDiscoveryState() {
  const { search, path, navigate } = useRouter();
  const { filters, point } = readDiscoveryState(search, storedPoint() ?? DEFAULT_POINT);
  function update(nextFilters: Filters, nextPoint: Point) {
    const params = new URLSearchParams();
    FILTER_KEYS.forEach((key) => {
      const value = nextFilters[key];
      if (value !== null && value !== DEFAULT_FILTERS[key]) params.set(key, String(value));
    });
    params.set('lat', String(nextPoint.lat));
    params.set('lng', String(nextPoint.lng));
    params.set('place', nextPoint.label);
    navigate(`${path}?${params}`, { replace: true, scroll: false });
  }
  return { filters, point, setFilters: (next: Filters) => update(next, point), setPoint: (next: Point) => { storePoint(next); update(filters, next); } };
}
