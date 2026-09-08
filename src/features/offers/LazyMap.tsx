import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Skeleton } from '../../components/ui';
import type { MapMarker } from './OfferMap';

const MapCanvas = lazy(() => import('./OfferMap').then((m) => ({ default: m.MapCanvas })));

type Props = {
  center: { lat: number; lng: number };
  zoom?: number;
  markers: MapMarker[];
  onSelect?: (id: string) => void;
  selectedId?: string;
  className?: string;
  interactive?: boolean;
  ariaLabel: string;
  /** Load immediately instead of waiting to be scrolled into view. */
  eager?: boolean;
  /** Frame the results instead of a fixed centre. */
  fitToMarkers?: boolean;
};

/**
 * MapLibre is close to a megabyte, so it is both code-split and deferred until the map is
 * actually about to be seen. On the offer detail page the map sits below the fold, and
 * paying for it up front is what drags the page down.
 */
export function LazyMap({ eager, ...props }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(Boolean(eager));

  useEffect(() => {
    if (visible || !holder.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) {
    return (
      <div ref={holder} className={props.className} role="region" aria-label={props.ariaLabel}>
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  return (
    <Suspense fallback={<Skeleton className={props.className} />}>
      <MapCanvas {...props} />
    </Suspense>
  );
}
