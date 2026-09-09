import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Heart } from 'lucide-react';
import { myFavorites, toggleFavorite } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { cx } from '../../components/ui';
import { useSession } from '../auth/session';
import { useRouter } from '../../app/router';

/** Following a venue is the only way to hear about its next slot, so the ask is one tap. */
export function FavoriteButton({
  businessId,
  businessName,
  variant = 'chip',
}: {
  businessId: string;
  businessName: string;
  /** 'overlay' is the icon-only circle that sits on a photo; it carries no label. */
  variant?: 'chip' | 'overlay';
}) {
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
    <span className={variant === 'overlay' ? 'relative inline-block' : 'contents'}>
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
          'inline-flex items-center font-bold transition-colors',
          variant === 'overlay'
            ? // On a photo the control cannot rely on the page background: it brings its own
              // opaque disc, so the heart stays legible over a bright image or a dark one.
              'size-11 justify-center rounded-full bg-card/90 text-ink shadow-card backdrop-blur-sm hover:bg-card'
            : cx(
                'min-h-11 gap-2 rounded-xl border px-3 text-sm',
                isFavorite
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line bg-card text-ink hover:border-accent',
              ),
        )}
      >
        <Heart
          size={variant === 'overlay' ? 20 : 17}
          aria-hidden="true"
          className={cx(isFavorite && 'fill-current', variant === 'overlay' && isFavorite && 'text-accent')}
        />
        {variant === 'overlay' ? null : isFavorite ? 'Sleduji' : 'Sledovat'}
      </button>
      {failure ? (
        <p
          role="alert"
          className={cx(
            'text-sm font-medium text-danger',
            // Over a photo the message needs its own ground, or it lands on the image.
            variant === 'overlay'
              ? 'absolute top-full right-0 mt-1 w-max max-w-[60vw] rounded-lg bg-card px-2 py-1 shadow-card'
              : 'mt-1',
          )}
        >
          {failure}
        </p>
      ) : null}
    </span>
  );
}
