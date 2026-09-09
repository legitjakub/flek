import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { googlePlaceRating } from '../../lib/api';

export function GooglePlaceRating({
  businessId,
  placeId,
  mapsUri = false,
  withSeparator = false,
}: {
  businessId: string;
  placeId: string | null | undefined;
  mapsUri?: boolean;
  withSeparator?: boolean;
}) {
  const query = useQuery({
    queryKey: ['google-place-rating', businessId, placeId],
    queryFn: () => googlePlaceRating(businessId),
    enabled: Boolean(placeId),
    staleTime: 0,
    gcTime: 0,
    retry: 0,
    refetchOnWindowFocus: true,
  });

  if (!placeId || !query.data) return null;

  const value = new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(query.data.rating);

  const rating = (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-xs text-ink">
      <Star size={13} aria-hidden="true" className="fill-ink text-ink" />
      <span className="tnum font-bold">{value}</span>
      <span className="tnum text-muted">({query.data.userRatingCount})</span>
      <span aria-hidden="true" className="text-line">|</span>
      <span translate="no" className="whitespace-nowrap text-muted">Google Maps</span>
      <span className="sr-only">Hodnocení z Google Maps</span>
    </span>
  );

  return (
    <>
      {withSeparator ? <span aria-hidden="true">·</span> : null}
      {mapsUri && query.data.googleMapsUri ? (
        <a
          href={query.data.googleMapsUri}
          target="_blank"
          rel="noreferrer"
          className="rounded-md focus-visible:outline-offset-2"
          onClick={(event) => event.stopPropagation()}
        >
          {rating}
        </a>
      ) : rating}
    </>
  );
}
