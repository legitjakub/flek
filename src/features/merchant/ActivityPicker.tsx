import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Image, PenLine, Store, Upload } from 'lucide-react';
import { listServicePhotos, uploadServicePhoto } from '../../lib/api';
import { cx, Skeleton } from '../../components/ui';
import { useSnapCarousel } from '../../components/useSnapCarousel';
import { IllustrativePhotoLabel } from '../../components/IllustrativePhotoLabel';
import { isIllustrativeServiceImage, SERVICE_PLACEHOLDER } from '../../lib/serviceIllustrations';
import { ACTIVITY_GALLERIES, activityForName, activityPhotoSrcSet } from '../../lib/activityGalleries';

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

/** One selected preview and a carousel that always settles on a whole thumbnail. */
export function ServicePhotoPicker({
  businessId,
  categorySlug,
  templateSlug,
  serviceName,
  value,
  venueCover,
  onPick,
  onUploadingChange,
}: {
  businessId: string;
  categorySlug: string;
  templateSlug: string | null;
  serviceName: string;
  value: string | null;
  venueCover: string | null;
  onPick: (imageUrl: string | null) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const photos = usePhotos();
  const uploadId = useId();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const choices = useMemo<PhotoOption[]>(() => {
    const catalogue = photos.data ?? [];
    const inferred = [...catalogue]
      .filter((photo) => photo.category_slug === categorySlug && serviceName.toLocaleLowerCase('cs-CZ').includes(photo.label_cs.toLocaleLowerCase('cs-CZ')))
      .sort((a, b) => b.label_cs.length - a.label_cs.length)[0]?.slug;
    const activity = templateSlug && templateSlug !== 'custom' ? templateSlug : (inferred ?? activityForName(serviceName, categorySlug));
    const reference = catalogue.find((photo) => photo.slug === activity);
    const gallery = activity ? (ACTIVITY_GALLERIES[activity] ?? (reference?.image_url ? [reference.image_url] : [])) : [];
    const options: PhotoOption[] = [
      { key: 'placeholder', label: 'Univerzální FLEK', imageUrl: SERVICE_PLACEHOLDER, value: null },
    ];
    if (venueCover) {
      options.push({ key: 'venue', label: 'Fotka provozovny', imageUrl: venueCover, fallback: <Store size={26} aria-hidden="true" />, value: venueCover });
    }
    gallery.forEach((imageUrl, index) => options.push({
      key: `${activity}-${index}`,
      label: `${reference?.label_cs ?? (serviceName || 'Fotka služby')} · ${index + 1}`,
      imageUrl,
      value: imageUrl,
    }));
    if (value && !gallery.includes(value)) {
      const pending = value.startsWith('moderation-pending://');
      options.push({
        key: 'current',
        label: pending ? 'Nová fotografie · čeká na kontrolu' : 'Současná fotka',
        imageUrl: pending ? pendingPreview : value,
        value,
      });
    }
    return options;
  }, [photos.data, categorySlug, serviceName, templateSlug, value, venueCover, pendingPreview]);
  const selectedIndex = Math.max(0, choices.findIndex((choice) => choice.value === value));
  const selected = choices[selectedIndex] ?? choices[0];
  const carousel = useSnapCarousel<HTMLDivElement>(choices.length, `${categorySlug}:${templateSlug ?? serviceName}`, (nextIndex) => {
    const next = choices[nextIndex];
    if (next && next.value !== value) onPick(next.value);
  });

  useEffect(() => {
    carousel.goTo(selectedIndex, 'auto');
  }, [selectedIndex]);

  useEffect(() => () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
  }, [pendingPreview]);

  async function upload(file: File | undefined) {
    if (!file || uploading) return;
    setUploadError(null);
    setUploading(true);
    onUploadingChange?.(true);
    const preview = URL.createObjectURL(file);
    try {
      const uploaded = await uploadServicePhoto(businessId, file);
      setPendingPreview(preview);
      onPick(uploaded);
    } catch (error) {
      URL.revokeObjectURL(preview);
      setUploadError(error instanceof Error ? error.message : 'Fotku se nepodařilo nahrát. Zkuste to znovu.');
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  }

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

      <div className="mt-3 rounded-2xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink">Vlastní fotografie</span>
            <span className="mt-0.5 block text-xs text-muted">Po bezpečnostní kontrole má vždy přednost před ilustračními fotkami. JPG, PNG nebo WebP, nejvýše 5 MB.</span>
          </span>
          <label
            htmlFor={uploadId}
            aria-busy={uploading || undefined}
            className={cx(
              'inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-card px-3 text-sm font-bold text-ink hover:border-accent',
              uploading && 'pointer-events-none opacity-55',
            )}
          >
            <Upload size={17} aria-hidden="true" />
            {uploading ? 'Nahrávám…' : 'Nahrát fotku'}
          </label>
          <input
            id={uploadId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={uploading}
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        {uploadError ? <p role="alert" className="mt-2 text-sm font-medium text-danger">{uploadError}</p> : null}
      </div>

      <div className="relative mt-3 overflow-hidden rounded-2xl bg-line/45">
        {selected?.imageUrl ? (
          <>
            <img src={selected.imageUrl} srcSet={activityPhotoSrcSet(selected.imageUrl)} sizes="(min-width: 768px) 560px, 100vw" alt="" className="aspect-[16/9] max-h-52 w-full object-cover" />
            {isIllustrativeServiceImage(selected.imageUrl) ? <IllustrativePhotoLabel className="top-2 left-2" /> : null}
          </>
        ) : (
          <span className="flex aspect-[16/9] max-h-52 items-center justify-center text-muted">{selected?.fallback ?? <Image size={28} aria-hidden="true" />}</span>
        )}
        <span className="glass-ink absolute right-2 bottom-2 rounded-lg px-2 py-1 text-xs font-bold text-card">{selected?.label}</span>
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
        <>
          <img src={imageUrl} srcSet={activityPhotoSrcSet(imageUrl)} sizes="96px" alt="" loading="lazy" className="aspect-square w-full object-cover" />
          {isIllustrativeServiceImage(imageUrl) ? <IllustrativePhotoLabel compact className="bottom-[2.05rem] left-1" /> : null}
        </>
      ) : (
        <span className="flex aspect-square items-center justify-center bg-line/45 text-muted">{fallback ?? <Image size={22} aria-hidden="true" />}</span>
      )}
      {active ? <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-brand text-brand-ink"><Check size={14} aria-hidden="true" /></span> : null}
      <span className="block truncate px-2 py-1.5 text-xs font-bold text-ink">{label}</span>
    </button>
  );
}
