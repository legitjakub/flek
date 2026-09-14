import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ChevronRight, Compass, Heart, MapPin } from 'lucide-react';
import { markFavoritesSeen, myFavorites, newAtFavorites } from '../../lib/api';
import { useServerNow } from '../../lib/clock';
import { EmptyState, ErrorState, LoadingList, buttonClass } from '../../components/ui';
import { Link } from '../../app/router';
import { OfferCard } from '../discovery/OfferCard';
import { GooglePlaceRating } from '../ratings/GooglePlaceRating';
import { useSession } from '../auth/session';

/**
 * The point of following a venue is hearing about its next slot. There is no push or e-mail
 * in V1, so this screen is the notification: what has opened at your places since you last
 * looked. Opening it is what marks them seen, so the badge can never lie.
 */
export function FavoritesPage() {
  const { userId } = useSession();
  const now = useServerNow();
  const queryClient = useQueryClient();

  const favorites = useQuery({ queryKey: ['favorites', userId], queryFn: myFavorites, enabled: Boolean(userId) });
  const fresh = useQuery({ queryKey: ['favorites-new', userId], queryFn: newAtFavorites, enabled: Boolean(userId) });

  const seen = useMutation({
    mutationFn: markFavoritesSeen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favorites-count'] }),
  });

  // Marking seen only after the list has actually rendered, and only once.
  const ready = fresh.isSuccess && favorites.isSuccess;
  useEffect(() => {
    if (ready && !seen.isPending && !seen.isSuccess) seen.mutate();
    // The mutation is intentionally fired once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!userId) {
    return (
      <main className="page-container py-6 sm:py-8">
        <h1 className="text-2xl font-extrabold tracking-tight">Oblíbená místa</h1>
        <div className="mt-5">
          <EmptyState
            tone="promo"
            icon={<Heart size={26} />}
            title="Sleduj místa, kam se rád vracíš."
            body="Dáme ti vědět, jakmile u nich přibude volný FLEK."
            action={
              <Link to="/prihlaseni?returnTo=%2Foblibene" className={buttonClass({ size: 'lg', shape: 'pill' })}>
                Přihlásit se
              </Link>
            }
          />
        </div>
      </main>
    );
  }

  const places = favorites.data ?? [];
  const news = fresh.data ?? [];

  return (
    <main className="page-container py-6 sm:py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Oblíbená místa</h1>
      <p className="mt-2 text-base text-muted">Co u nich nově otevřelo, uvidíš tady.</p>

      {favorites.isPending ? <div className="mt-6"><LoadingList /></div> : null}
      {favorites.isError ? <div className="mt-6"><ErrorState error={favorites.error} onRetry={() => favorites.refetch()} /></div> : null}

      {favorites.isSuccess && places.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            tone="promo"
            icon={<Heart size={26} />}
            title="Zatím nesleduješ žádné místo."
            body="U nabídky klepni na Sledovat a dáme ti vědět, až tam přibude volný FLEK."
            action={
              <Link to="/" className={buttonClass({ size: 'lg', shape: 'pill' })}>
                Objevit nabídky
              </Link>
            }
          />
        </div>
      ) : null}

      {news.length > 0 ? (
        <section className="mt-8" aria-labelledby="nove">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 id="nove" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              Nové u tvých míst
              <span className="tnum grid min-h-6 min-w-6 place-items-center rounded-full bg-brand px-1.5 text-xs font-extrabold text-brand-ink">
                {news.length}
              </span>
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {news.map((offer) => (
              <OfferCard key={offer.id} offer={offer} now={now} />
            ))}
          </div>
        </section>
      ) : null}

      {places.length > 0 ? (
        <section className="mt-8" aria-labelledby="mista">
          <h2 id="mista" className="mb-3 px-1 text-lg font-extrabold tracking-tight">Sleduješ</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-3xl bg-card shadow-card">
            {places.map((place) => (
              <li key={place.id}>
                {/*
                  The whole row is the link. It used to be a bare <li>: it announced
                  "3 volných termínů" and offered nothing to press, and the single clickable
                  thing on it — the Google rating chip — left the app entirely.
                */}
                <Link
                  to={`/podnik/${place.id}?from=%2Foblibene`}
                  className="group flex min-h-18 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface"
                >
                  <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-base font-extrabold text-accent">
                    {place.display_name.trim().charAt(0).toLocaleUpperCase('cs-CZ')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-bold text-ink">{place.display_name}</span>
                    <span className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted">
                      <MapPin size={14} aria-hidden="true" className="shrink-0" />
                      {place.district || place.city}
                    </span>
                    {place.open_offers > 0 ? (
                      <span className="tnum block text-sm font-bold text-ink">
                        {place.open_offers} {place.open_offers === 1 ? 'volný FLEK' : place.open_offers < 5 ? 'volné FLEKy' : 'volných FLEKů'}
                      </span>
                    ) : (
                      <span className="block text-sm text-muted">Teď nic volného</span>
                    )}
                  </span>
                  {place.new_offers > 0 ? (
                    <span className="tnum shrink-0 rounded-full bg-brand px-2.5 py-1 text-xs font-extrabold text-brand-ink">
                      {place.new_offers} nové
                    </span>
                  ) : null}
                  <ChevronRight size={18} className="shrink-0 text-muted group-hover:text-ink" aria-hidden="true" />
                </Link>
                {/* Kept out of the link: it is a second destination (Google Maps), and an
                    anchor inside an anchor is invalid. */}
                <GooglePlaceRatingRow businessId={place.id} placeId={place.google_place_id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {places.length > 0 && news.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 px-1 text-base text-muted">
          <Heart size={16} aria-hidden="true" />U sledovaných míst zatím nic nového nepřibylo.
        </p>
      ) : null}

      {places.length > 0 ? (
        <div className="mt-6">
          <Link to="/" className={buttonClass({ variant: 'soft', shape: 'pill' })}>
            <Compass size={17} aria-hidden="true" />
            Objevit další místa
          </Link>
        </div>
      ) : null}
    </main>
  );
}

/** The Google rating under a followed place, indented to the name; renders nothing when off. */
function GooglePlaceRatingRow({ businessId, placeId }: { businessId: string; placeId: string | null }) {
  if (!placeId) return null;
  return (
    <span className="-mt-2 block pb-3 pl-18">
      <GooglePlaceRating businessId={businessId} placeId={placeId} mapsUri />
    </span>
  );
}
