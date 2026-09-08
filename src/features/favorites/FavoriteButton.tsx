import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Heart } from 'lucide-react';
import { myFavorites, toggleFavorite } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { cx } from '../../components/ui';
import { useSession } from '../auth/session';
import { useRouter } from '../../app/router';

/** Following a venue is the only way to hear about its next slot, so the ask is one tap. */
export function FavoriteButton({ businessId, businessName }: { businessId: string; businessName: string }) {
  const { userId } = useSession();
  const { navigate, path, search } = useRouter();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const favorites = useQuery({
    queryKey: ['favorites', userId],
    queryFn: myFavorites,
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
  const isFavorite = (favorites.data ?? []).some((f) => f.id === businessId);

  const toggle = useMutation({
    mutationFn: () => toggleFavorite(businessId),
    onSuccess: async () => {
      setFailure(null);
      await queryClient.invalidateQueries({ queryKey: ['favorites'] });
      await queryClient.invalidateQueries({ queryKey: ['favorites-new'] });
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  return (
    <>
      <button
        type="button"
        aria-pressed={isFavorite}
        aria-label={isFavorite ? `Přestat sledovat ${businessName}` : `Sledovat ${businessName}`}
        disabled={toggle.isPending}
        onClick={() => {
          if (!userId) {
            const back = `${path}${search.size ? `?${search}` : ''}`;
            navigate(`/prihlaseni?returnTo=${encodeURIComponent(back)}`);
            return;
          }
          toggle.mutate();
        }}
        className={cx(
          'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition-colors',
          isFavorite ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card text-ink hover:border-accent',
        )}
      >
        <Heart size={17} aria-hidden="true" className={isFavorite ? 'fill-accent' : undefined} />
        {isFavorite ? 'Sleduji' : 'Sledovat'}
      </button>
      {failure ? (
        <p role="alert" className="mt-1 text-sm font-medium text-accent">
          {failure}
        </p>
      ) : null}
    </>
  );
}
