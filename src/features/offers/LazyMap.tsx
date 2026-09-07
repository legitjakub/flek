import { Suspense, lazy } from 'react';
import { Skeleton } from '../../components/ui';
import type { MapMarker } from './OfferMap';

const MapCanvas = lazy(() => import('./OfferMap').then((m) => ({ default: m.MapCanvas })));

/** MapLibre is ~1 MB, so it loads only on the screens that actually draw a map. */
export function LazyMap(props: {
  center: { lat: number; lng: number };
  zoom?: number;
  markers: MapMarker[];
  onSelect?: (id: string) => void;
  className?: string;
  interactive?: boolean;
  ariaLabel: string;
}) {
  return (
    <Suspense fallback={<Skeleton className={props.className} />}>
      <MapCanvas {...props} />
    </Suspense>
  );
}
