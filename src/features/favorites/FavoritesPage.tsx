import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ChevronRight, Heart, MapPin } from 'lucide-react';
import { markFavoritesSeen, myFavorites, newAtFavorites } from '../../lib/api';
import { useServerNow } from '../../lib/clock';
import { EmptyState, ErrorState, LoadingList } from '../../components/ui';
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
      <main className="page-container py-8">
        <h1 className="text-2xl font-extrabold tracking-tight">Oblíbená místa</h1>
        <div className="mt-5">
          <EmptyState
            title="Sleduj místa, kam se rád vracíš."
            body="Dáme ti vědět, jakmile u nich přibude volný termín."
            action={
              <Link
                to="/prihlaseni?returnTo=%2Foblibene"
                className="btn-primary"
              >
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
            title="Zatím nesleduješ žádné místo."
            body="U nabídky klepni na Sledovat a dáme ti vědět, až tam přibude volný termín."
            action={
              <Link
                to="/"
                className="btn-primary"
              >
                Objevit nabídky
              </Link>
            }
          />
        </div>
      ) : null}

      {news.length > 0 ? (
        <section className="mt-8" aria-labelledby="nove">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 id="nove" className="text-lg font-extrabold tracking-tight">Nové u tvých míst</h2>
            <span className="tnum shrink-0 text-sm text-muted">{news.length}</span>
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
          <h2 id="mista" className="mb-4 text-lg font-extrabold tracking-tight">Sleduješ</h2>
          <ul className="flex flex-col gap-3">
            {places.map((place) => (
              <li key={place.id}>
                {/*
                  The whole row is the link. It used to be a bare <li>: it announced
                  "3 volných termínů" and offered nothing to press, and the single clickable
                  thing on it — the Google rating chip — left the app entirely.
                */}
                <Link
                  to={`/podnik/${place.id}?from=%2Foblibene`}
                  className="group flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-card p-4 shadow-card transition-colors hover:bg-surface"
                >
                  <span className="min-w-0">
                    <span className="block text-base font-bold text-ink">{place.display_name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin size={15} aria-hidden="true" />
                        {place.district || place.city}
                      </span>
                    </span>
                  </span>
                  <span className="tnum inline-flex shrink-0 items-center gap-2 text-base font-bold">
                    {place.open_offers > 0 ? (
                      <span className="text-ink">
                        {place.open_offers} {place.open_offers === 1 ? 'volný termín' : place.open_offers < 5 ? 'volné termíny' : 'volných termínů'}
                      </span>
                    ) : (
                      <span className="text-muted">Teď nic volného</span>
                    )}
                    {place.new_offers > 0 ? (
                      <span className="rounded-md bg-accent-soft px-2 py-0.5 text-sm text-accent">
                        {place.new_offers} nové
                      </span>
                    ) : null}
                    <ChevronRight size={18} className="text-muted group-hover:text-accent" aria-hidden="true" />
                  </span>
                </Link>
                {/* Kept out of the link: it is a second destination (Google Maps), and an
                    anchor inside an anchor is invalid. */}
                <span className="mt-1 ml-4 inline-block">
                  <GooglePlaceRating businessId={place.id} placeId={place.google_place_id} mapsUri />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {places.length > 0 && news.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 text-base text-muted">
          <Heart size={16} aria-hidden="true" />U sledovaných míst zatím nic nového nepřibylo.
        </p>
      ) : null}

      {places.length > 0 ? (
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center rounded-xl border border-line bg-card px-4 text-sm font-bold text-ink hover:bg-surface"
          >
            Objevit další místa
          </Link>
        </div>
      ) : null}
    </main>
  );
}
