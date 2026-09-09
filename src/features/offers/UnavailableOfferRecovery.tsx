import { useQuery } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { searchOffers } from '../../lib/api';
import { track } from '../../lib/analytics';
import { Button } from '../../components/ui';
import { Link, useRouter } from '../../app/router';
import { OfferCard } from '../discovery/OfferCard';
import { FavoriteButton } from '../favorites/FavoriteButton';
import { unavailableCopy, type UnavailableReason } from './unavailable';
import type { OfferDetail } from '../../types/database';

/** Below this a "similar" strip is two lonely cards that make the market look empty. */
const MIN_ALTERNATIVES = 2;
const MAX_ALTERNATIVES = 4;

/**
 * A shared link outlives the slot it points at, so most people who open one arrive too late.
 * That arrival used to be a greyed-out button and nothing else — the end of the road for the
 * exact visitor a share was supposed to bring in. Here it becomes the two things still worth
 * doing: hear about the next one, or see what is free right now.
 */
export function UnavailableOfferRecovery({
  offer,
  reason,
  now,
  point,
}: {
  offer: OfferDetail;
  reason: UnavailableReason;
  now: string;
  point: { lat: number; lng: number };
}) {
  const copy = unavailableCopy(reason);
  const { navigate } = useRouter();

  // The same search the rest of the app uses — no second recommendation engine. Same
  // category, same neighbourhood, the whole week ahead, because someone who missed one slot
  // is usually flexible about which day they get instead.
  const similar = useQuery({
    queryKey: ['similar', offer.id, offer.category_slug],
    queryFn: () =>
      searchOffers({
        lat: point.lat,
        lng: point.lng,
        radius_m: 10000,
        category: offer.category_slug,
        from: null,
        until: null,
        min_discount_pct: 0,
        max_price_cents: null,
        sort: 'soonest',
        daypart: null,
        limit: MAX_ALTERNATIVES + 1,
      }),
    staleTime: 60_000,
  });

  const alternatives = (similar.data ?? []).filter((row) => row.id !== offer.id).slice(0, MAX_ALTERNATIVES);
  const discoveryHref = `/?category=${encodeURIComponent(offer.category_slug)}&when=week`;

  return (
    <section aria-labelledby="recovery-title" className="rounded-2xl bg-card p-5 shadow-card">
      <h2 id="recovery-title" className="text-lg font-extrabold tracking-tight">
        {copy.title}
      </h2>
      <p className="mt-2 text-base leading-relaxed text-muted">{copy.body}</p>

      {reason === 'cancelled' && offer.cancellation_reason ? (
        <p className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
          Důvod od podniku: {offer.cancellation_reason}
        </p>
      ) : null}

      <div className="mt-5">
        <FavoriteButton
          variant="cta"
          businessId={offer.business_id}
          businessName={offer.business_name}
        />
        {/* Truthful about what following actually does today: there is no push delivery, so
            we promise the one thing that really happens. */}
        <p className="mt-2 text-center text-sm text-muted">Nové FLEKy uvidíš v Oblíbených.</p>
      </div>

      <div className="mt-4">
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => {
            track('similar_offers_clicked', { offer_id: offer.id, category: offer.category_slug });
            navigate(discoveryHref);
          }}
        >
          <Compass size={18} aria-hidden="true" />
          Najít podobné FLEKy
        </Button>
      </div>

      {alternatives.length >= MIN_ALTERNATIVES ? (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="text-base font-extrabold">Volné právě teď</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {alternatives.map((row) => (
              <OfferCard key={row.id} offer={row} now={now} />
            ))}
          </div>
          <Link
            to={discoveryHref}
            className="mt-4 inline-flex min-h-11 items-center gap-2 text-base font-bold text-accent"
            onClick={() => track('unavailable_recovery_clicked', { offer_id: offer.id })}
          >
            Zobrazit všechny
          </Link>
        </div>
      ) : null}
    </section>
  );
}
