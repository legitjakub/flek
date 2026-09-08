import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Heart, MapPin } from 'lucide-react';
import { markFavoritesSeen, myFavorites, newAtFavorites } from '../../lib/api';
import { useServerNow } from '../../lib/clock';
import { Button, EmptyState, ErrorState, LoadingList, Rating } from '../../components/ui';
import { Link } from '../../app/router';
import { OfferCard } from '../discovery/OfferCard';
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
                className="inline-flex min-h-11 items-center rounded-xl bg-action px-4 font-bold text-accent-ink"
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
                className="inline-flex min-h-11 items-center rounded-xl bg-action px-4 font-bold text-accent-ink"
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
              <li
                key={place.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4"
              >
                <div className="min-w-0">
                  <p className="text-base font-bold">{place.display_name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin size={15} aria-hidden="true" />
                      {place.district || place.city}
                    </span>
                    <Rating average={place.rating_avg} count={place.rating_count} />
                  </p>
                </div>
                <p className="tnum text-base font-bold">
                  {place.open_offers > 0 ? `${place.open_offers} volných termínů` : 'Teď nic volného'}
                  {place.new_offers > 0 ? (
                    <span className="ml-2 rounded-md bg-accent-soft px-2 py-0.5 text-accent">
                      {place.new_offers} nové
                    </span>
                  ) : null}
                </p>
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
          <Link to="/">
            <Button variant="secondary">Objevit další místa</Button>
          </Link>
        </div>
      ) : null}
    </main>
  );
}
