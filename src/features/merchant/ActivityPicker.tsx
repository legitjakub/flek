import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Image, Store } from 'lucide-react';
import { listServicePhotos } from '../../lib/api';
import { cx, Skeleton } from '../../components/ui';

function usePhotos() {
  return useQuery({
    queryKey: ['service-photos'],
    queryFn: listServicePhotos,
    staleTime: 3_600_000,
  });
}

/** Optional shortcut: the merchant remains in control of the editable name. */
export function ActivitySuggestions({
  categorySlug,
  onPick,
}: {
  categorySlug: string;
  onPick: (activity: { slug: string; label: string; imageUrl: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const photos = usePhotos();
  const options = (photos.data ?? []).filter((photo) => photo.category_slug === categorySlug);

  if (photos.isPending) return <Skeleton className="h-11 w-44" />;
  if (!options.length) return null;

  return (
    <div className="rounded-xl bg-surface p-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-bold text-ink"
      >
        <span>
          Nevíte přesný název? <span className="font-medium text-muted">Vyberte z nabídky</span>
        </span>
        <ChevronDown size={17} className={cx('shrink-0 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open ? (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.map((option) => (
            <button
              key={option.slug}
              type="button"
              onClick={() => {
                onPick({ slug: option.slug, label: option.label_cs, imageUrl: option.image_url });
                setOpen(false);
              }}
              className="min-h-11 rounded-lg border border-line bg-card px-3 py-2 text-left text-sm font-bold text-ink hover:border-accent"
            >
              {option.label_cs}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** `null` is an explicit venue-cover choice, never an accidentally selected activity. */
export function ServicePhotoPicker({
  categorySlug,
  value,
  venueCover,
  onPick,
}: {
  categorySlug: string;
  value: string | null;
  venueCover: string | null;
  onPick: (imageUrl: string | null) => void;
}) {
  const photos = usePhotos();
  const choices = useMemo(() => {
    const seen = new Set<string>();
    return (photos.data ?? []).filter((photo) => {
      if (photo.category_slug !== categorySlug || !photo.image_url || seen.has(photo.image_url)) return false;
      seen.add(photo.image_url);
      return true;
    });
  }, [photos.data, categorySlug]);

  if (photos.isPending) return <Skeleton className="h-28 w-full" />;

  return (
    <fieldset>
      <legend className="text-sm font-bold text-ink">Fotka nabídky</legend>
      <p className="mt-0.5 text-sm text-muted">Vyberte ověřenou fotku, nebo použijte hlavní fotku provozovny.</p>
      <div className="rail rail-fade -mx-1 mt-3 flex gap-2 px-1 pb-1">
        <PhotoChoice
          active={value === null}
          label="Fotka provozovny"
          imageUrl={venueCover}
          fallback={<Store size={22} aria-hidden="true" />}
          onClick={() => onPick(null)}
        />
        {choices.map((choice) => (
          <PhotoChoice
            key={choice.image_url}
            active={value === choice.image_url}
            label={choice.label_cs}
            imageUrl={choice.image_url}
            onClick={() => onPick(choice.image_url)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function PhotoChoice({
  active,
  label,
  imageUrl,
  fallback,
  onClick,
}: {
  active: boolean;
  label: string;
  imageUrl: string | null;
  fallback?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'relative w-32 shrink-0 overflow-hidden rounded-xl bg-card text-left transition-shadow',
        active ? 'ring-2 ring-ink' : 'ring-1 ring-line hover:ring-accent',
      )}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
      ) : (
        <span className="flex aspect-[4/3] items-center justify-center bg-line/45 text-muted">
          {fallback ?? <Image size={22} aria-hidden="true" />}
        </span>
      )}
      {active ? (
        <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-ink text-card">
          <Check size={14} aria-hidden="true" />
        </span>
      ) : null}
      <span className="block truncate px-2 py-1.5 text-xs font-bold text-ink">{label}</span>
    </button>
  );
}
