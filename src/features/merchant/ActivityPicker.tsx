import { useEffect, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Image, PenLine, Store } from 'lucide-react';
import { listServicePhotos } from '../../lib/api';
import { cx, Skeleton } from '../../components/ui';
import { useSnapCarousel } from '../../components/useSnapCarousel';

function usePhotos() {
  return useQuery({
    queryKey: ['service-photos'],
    queryFn: listServicePhotos,
    staleTime: 3_600_000,
  });
}

/** Prepared names are the first decision; the editable field follows underneath. */
export function ActivitySuggestions({
  categorySlug,
  selected,
  onPick,
  onCustom,
}: {
  categorySlug: string;
  selected: string | null;
  onPick: (activity: { slug: string; label: string; imageUrl: string | null }) => void;
  onCustom: () => void;
}) {
  const photos = usePhotos();
  const options = (photos.data ?? []).filter((photo) => photo.category_slug === categorySlug);

  return (
    <fieldset>
      <legend className="text-base font-extrabold text-ink">Co nabízíte?</legend>
      <p className="mt-1 text-sm text-muted">Vyberte nejbližší možnost. Název pak můžete upravit.</p>
      {photos.isPending ? <Skeleton className="mt-3 h-28 w-full" /> : (
        <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Typ služby">
          {options.map((option, index) => {
            const active = selected === option.slug;
            return (
              <button
                key={option.slug}
                type="button"
                role="radio"
                aria-checked={active}
                data-autofocus={index === 0 ? '' : undefined}
                onClick={() => onPick({
                  slug: option.slug,
                  label: option.label_cs,
                  imageUrl: ACTIVITY_GALLERIES[option.slug]?.[0] ?? option.image_url,
                })}
                className={cx(
                  'relative flex min-h-14 items-center rounded-xl border px-3 py-2 text-left text-sm font-bold transition-colors',
                  active ? 'border-ink bg-ink text-card' : 'border-line bg-card text-ink hover:border-accent',
                )}
              >
                <span className="min-w-0 flex-1">{option.label_cs}</span>
                {active ? <Check size={17} className="ml-2 shrink-0" aria-hidden="true" /> : null}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={selected === 'custom'}
            data-autofocus={!options.length ? '' : undefined}
            onClick={onCustom}
            className={cx(
              'flex min-h-14 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-bold transition-colors',
              selected === 'custom' ? 'border-ink bg-ink text-card' : 'border-line bg-surface text-ink hover:border-accent',
            )}
          >
            <PenLine size={17} className="shrink-0" aria-hidden="true" />
            Vlastní služba
          </button>
        </div>
      )}
    </fieldset>
  );
}

type PhotoOption = {
  key: string;
  label: string;
  imageUrl: string | null;
  fallback?: ReactNode;
  value: string | null;
};

/** Local, activity-specific imagery. Category-wide rails caused unrelated sports to mix. */
const ACTIVITY_GALLERIES: Record<string, string[]> = {
  'sport-padel': ['/images/services/padel-prague.jpg'],
  'sport-tenis': ['/images/services/tennis-prague.jpg'],
  'sport-squash': ['/images/services/squash-prague.jpg'],
  'sport-badminton': ['/images/services/badminton-prague.jpg'],
  'sport-osobni-trenink': ['/images/services/personal-training-prague.jpg'],
  'sport-skupinova-lekce': ['/images/services/group-class-prague.jpg'],
};

/** One selected preview and a carousel that always settles on a whole thumbnail. */
export function ServicePhotoPicker({
  categorySlug,
  templateSlug,
  serviceName,
  value,
  venueCover,
  onPick,
}: {
  categorySlug: string;
  templateSlug: string | null;
  serviceName: string;
  value: string | null;
  venueCover: string | null;
  onPick: (imageUrl: string | null) => void;
}) {
  const photos = usePhotos();
  const choices = useMemo<PhotoOption[]>(() => {
    const catalogue = photos.data ?? [];
    const inferred = [...catalogue]
      .filter((photo) => photo.category_slug === categorySlug && serviceName.toLocaleLowerCase('cs-CZ').includes(photo.label_cs.toLocaleLowerCase('cs-CZ')))
      .sort((a, b) => b.label_cs.length - a.label_cs.length)[0]?.slug;
    const activity = templateSlug && templateSlug !== 'custom' ? templateSlug : inferred;
    const reference = catalogue.find((photo) => photo.slug === activity);
    const gallery = activity ? (ACTIVITY_GALLERIES[activity] ?? (reference?.image_url ? [reference.image_url] : [])) : [];
    const options: PhotoOption[] = [
      { key: 'venue', label: 'Fotka provozovny', imageUrl: venueCover, fallback: <Store size={26} aria-hidden="true" />, value: null },
    ];
    gallery.forEach((imageUrl, index) => options.push({
      key: `${activity}-${index}`,
      label: reference?.label_cs ?? (serviceName || 'Fotka služby'),
      imageUrl,
      value: imageUrl,
    }));
    if (!activity && value && !gallery.includes(value)) {
      options.push({ key: 'current', label: 'Současná fotka', imageUrl: value, value });
    }
    return options;
  }, [photos.data, categorySlug, serviceName, templateSlug, value, venueCover]);
  const selectedIndex = Math.max(0, choices.findIndex((choice) => choice.value === value));
  const selected = choices[selectedIndex] ?? choices[0];
  const carousel = useSnapCarousel<HTMLDivElement>(choices.length, `${categorySlug}:${templateSlug ?? serviceName}`, (nextIndex) => {
    const next = choices[nextIndex];
    if (next && next.value !== value) onPick(next.value);
  });

  useEffect(() => {
    carousel.goTo(selectedIndex, 'auto');
  }, [selectedIndex]);

  if (photos.isPending) return <Skeleton className="h-52 w-full" />;

  return (
    <fieldset>
      <div className="flex items-end justify-between gap-3">
        <span>
          <legend className="text-sm font-bold text-ink">Fotka nabídky</legend>
          <span className="mt-0.5 block text-sm text-muted">Vyberte fotku, která službu vystihuje.</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="tnum mr-1 text-xs font-bold text-muted" aria-live="polite">{selectedIndex + 1} / {choices.length}</span>
          <button type="button" aria-label="Předchozí fotka" disabled={selectedIndex === 0} onClick={() => carousel.goTo(selectedIndex - 1)} className="grid size-9 place-items-center rounded-xl border border-line bg-card text-ink disabled:opacity-30">
            <ChevronLeft size={17} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Další fotka" disabled={selectedIndex === choices.length - 1} onClick={() => carousel.goTo(selectedIndex + 1)} className="grid size-9 place-items-center rounded-xl border border-line bg-card text-ink disabled:opacity-30">
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </span>
      </div>

      <div className="relative mt-3 overflow-hidden rounded-2xl bg-line/45">
        {selected?.imageUrl ? (
          <img src={selected.imageUrl} alt="" className="aspect-[16/9] max-h-52 w-full object-cover" />
        ) : (
          <span className="flex aspect-[16/9] max-h-52 items-center justify-center text-muted">{selected?.fallback ?? <Image size={28} aria-hidden="true" />}</span>
        )}
        <span className="absolute right-2 bottom-2 rounded-lg bg-ink/85 px-2 py-1 text-xs font-bold text-card backdrop-blur-sm">{selected?.label}</span>
      </div>

      <div
        ref={carousel.viewportRef}
        tabIndex={choices.length > 1 ? 0 : -1}
        onScroll={carousel.onScroll}
        onKeyDown={carousel.onKeyDown}
        className="rail rail-fade -mx-1 mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-1 py-1 touch-pan-x"
        aria-label="Dostupné fotografie"
      >
        {choices.map((choice, index) => (
          <PhotoChoice
            key={choice.key}
            active={index === selectedIndex}
            label={choice.label}
            imageUrl={choice.imageUrl}
            fallback={choice.fallback}
            onClick={() => {
              onPick(choice.value);
              carousel.goTo(index);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function PhotoChoice({ active, label, imageUrl, fallback, onClick }: {
  active: boolean;
  label: string;
  imageUrl: string | null;
  fallback?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-snap-item
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={cx(
        'relative w-24 shrink-0 snap-start snap-always overflow-hidden rounded-xl bg-card text-left transition-shadow',
        active ? 'ring-2 ring-ink' : 'ring-1 ring-line hover:ring-accent',
      )}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" loading="lazy" className="aspect-square w-full object-cover" />
      ) : (
        <span className="flex aspect-square items-center justify-center bg-line/45 text-muted">{fallback ?? <Image size={22} aria-hidden="true" />}</span>
      )}
      {active ? <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-brand text-ink"><Check size={14} aria-hidden="true" /></span> : null}
      <span className="block truncate px-2 py-1.5 text-xs font-bold text-ink">{label}</span>
    </button>
  );
}
