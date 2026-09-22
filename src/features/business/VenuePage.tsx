import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MapPin } from 'lucide-react';
import { businessOffers, businessPublic } from '../../lib/api';
import { useServerNow } from '../../lib/clock';
import { DEFAULT_POINT, storedPoint } from '../../lib/geo';
import { navigationHref } from '../../lib/maps';
import { EmptyState, ErrorState, LoadingList, Skeleton } from '../../components/ui';
import { Link, useRouter } from '../../app/router';
import { OfferCard } from '../discovery/OfferCard';
import { groupSlots } from '../discovery/slots';
import { FavoriteButton } from '../favorites/FavoriteButton';
import { GooglePlaceRating } from '../ratings/GooglePlaceRating';
import { BusinessReviews, FlekRatingSummary } from '../ratings/FlekReviews';
import { ProviderLine } from '../legal/ProviderLine';
import { ReportContent } from '../legal/ReportContent';

/**
 * A venue and everything free at it.
 *
 * This page is the destination the product kept implying and never had. Favourites told a
 * customer "3 volných termínů" at a place they follow and then had nowhere to send them: the
 * row was not a link, my_favorites returns only counts, and no route for a business existed.
 * "Nové u tvých míst" was no help either — it lists only offers published since the last
 * visit, and opening the list moves that mark forward, so an older offer that was still
 * open had no card anywhere in the app.
 */
export function VenuePage({ businessId }: { businessId: string }) {
  const { search } = useRouter();
  const now = useServerNow();
  const point = storedPoint() ?? DEFAULT_POINT;

  const venue = useQuery({
    queryKey: ['business', businessId],
    queryFn: () => businessPublic(businessId),
    staleTime: 5 * 60_000,
  });
  const offers = useQuery({
    queryKey: ['business-offers', businessId, point.lat, point.lng],
    queryFn: () => businessOffers(businessId, point),
    refetchOnWindowFocus: true,
  });

  // Where "back" goes: whoever linked here says so, otherwise the favourites list, which is
  // where this page is reached from most often.
  const origin = search.get('from') ?? '/oblibene';
  const backTo = origin.startsWith('/') && !origin.startsWith('//') ? origin : '/oblibene';

  if (venue.isPending) {
    return (
      <main className="page-container py-5">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-3 h-5 w-1/2" />
        <div className="mt-6">
          <LoadingList rows={3} />
        </div>
      </main>
    );
  }

  if (venue.isError) {
    return (
      <main className="page-container py-6">
        <ErrorState error={venue.error} onRetry={() => venue.refetch()} />
      </main>
    );
  }

  // A venue that was suspended, or never approved, must not leak through a shared link.
  if (!venue.data) {
    return (
      <main className="page-container py-10 text-center">
        <p className="text-base font-bold text-ink">Tenhle podnik na FLEKu nenajdeme.</p>
        <Link to="/" className="mt-4 inline-block text-base font-bold underline underline-offset-4">
          Objevit volné FLEKy
        </Link>
      </main>
    );
  }

  const business = venue.data;
  const rows = offers.data ?? [];
  // One card per service; its other times are listed on the card.
  const services = groupSlots(rows);

  return (
    <main className="page-container py-4 pb-10">
      <Link
        to={backTo}
        className="my-2 inline-flex min-h-11 items-center gap-2 text-base font-bold text-muted hover:text-accent"
      >
        <ArrowLeft size={18} aria-hidden="true" />
        Zpět
      </Link>

      {/*
        The venue's own photograph, once the check has published it. It is a real picture of a real
        place, so it carries no "ilustrační foto" label; venues without one keep the page as it was.
      */}
      {business.cover_url && !business.cover_url.startsWith('moderation-pending://') ? (
        <div className="-mx-4 mb-3 sm:mx-0">
          <img
            src={business.cover_url}
            alt=""
            loading="lazy"
            className="aspect-[16/9] w-full object-cover sm:rounded-2xl md:aspect-[3/1]"
          />
        </div>
      ) : null}

      <h1 className="text-xl leading-tight font-extrabold tracking-tight md:text-2xl [overflow-wrap:anywhere]">
        {business.display_name}
      </h1>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <a
          href={navigationHref(business)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 font-bold text-muted hover:text-accent"
        >
          <MapPin size={15} aria-hidden="true" />
          {business.address_line}
          {business.district ? `, ${business.district}` : `, ${business.city}`}
        </a>
        <GooglePlaceRating businessId={business.id} placeId={business.google_place_id} withSeparator />
        {business.rating_count > 0 ? <span aria-hidden="true">·</span> : null}
        <FlekRatingSummary businessId={business.id} average={business.rating_avg} count={business.rating_count} />
      </p>

      {business.description ? (
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-ink">{business.description}</p>
      ) : null}

      <ProviderLine businessId={business.id} className="mt-2 max-w-2xl" />

      <div className="mt-4">
        <FavoriteButton businessId={business.id} businessName={business.display_name} />
      </div>

      <section className="mt-7" aria-labelledby="volne-terminy">
        <h2 id="volne-terminy" className="mb-3 text-lg font-extrabold tracking-tight">
          Volné FLEKy
          <span className="tnum ml-2 text-sm font-normal text-muted">
            {rows.length} {rows.length === 1 ? 'nabídka' : rows.length < 5 ? 'nabídky' : 'nabídek'}
          </span>
        </h2>

        {offers.isPending ? <LoadingList rows={3} /> : null}
        {offers.isError ? <ErrorState error={offers.error} onRetry={() => offers.refetch()} /> : null}

        {offers.isSuccess && rows.length === 0 ? (
          <EmptyState
            title="Teď tu nic volného není."
            body="Dej si tenhle podnik mezi oblíbené a nové termíny uvidíš v Oblíbených."
          />
        ) : null}

        {rows.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/*
              compact drops the photograph — the prop OfferCard already documents for exactly
              this. On a venue's own page every card would otherwise repeat the same picture
              and the same name nine times over, which buries the only things that differ:
              the service, the time and the price.
            */}
            {services.map((group) => (
              <OfferCard key={group.key} offer={group.lead} slots={group.slots} now={now} compact />
            ))}
          </div>
        ) : null}
      </section>

      <BusinessReviews
        businessId={business.id}
        average={business.rating_avg}
        count={business.rating_count}
      />

      <div className="mt-8 border-t border-line pt-2">
        <ReportContent businessId={business.id} />
      </div>
    </main>
  );
}
