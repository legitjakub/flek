import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Upload } from 'lucide-react';
import { listServicePhotos, uploadServiceImage } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { cx, Skeleton } from '../../components/ui';

/**
 * Which activity this service is, chosen from a list rather than typed into a box.
 *
 * The photograph is the reason this exists. Nothing in the merchant app ever set
 * services.image_url, so a customer saw whatever the category happened to carry — a yoga
 * class illustrated with a facial, a sauna with a gym floor. Picking the activity picks the
 * picture, and the merchant sees the picture while picking, so a mismatch is their choice
 * rather than an accident.
 */
export function ActivityPicker({
  businessId,
  categorySlug,
  value,
  onPick,
}: {
  businessId: string;
  categorySlug: string;
  /** The currently attached image_url, so a service being edited shows what it already has. */
  value: string | null;
  onPick: (photo: { label: string; imageUrl: string }) => void;
}) {
  /*
   * Selection is tracked by activity, not by photograph. Several activities deliberately
   * share one image, so comparing image_url lit up every tile that shared it — picking
   * "Dámský střih" appeared to select four things at once.
   */
  const [pickedSlug, setPickedSlug] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const photos = useQuery({
    queryKey: ['service-photos'],
    queryFn: listServicePhotos,
    staleTime: 3_600_000,
  });

  if (photos.isPending) return <Skeleton className="h-28 w-full" />;

  const options = (photos.data ?? []).filter((p) => p.category_slug === categorySlug);
  // Editing an existing service: nothing was picked in this session, so the first activity
  // using its photograph stands in — enough to show which picture is currently in use.
  const currentSlug = pickedSlug ?? options.find((p) => p.image_url === value)?.slug ?? null;
  // A category with nothing catalogued yet must not render an empty, unexplained box.
  if (options.length === 0) return null;

  return (
    <div>
      <p className="text-sm font-bold text-ink">Co to je za službu?</p>
      <p className="mt-0.5 text-sm text-muted">Vyberte a doplní se název i fotka, kterou uvidí zákazník.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((photo) => {
          const active = currentSlug === photo.slug;
          return (
            <button
              key={photo.slug}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setPickedSlug(photo.slug);
                onPick({ label: photo.label_cs, imageUrl: photo.image_url });
              }}
              className={cx(
                'relative overflow-hidden rounded-xl text-left transition-shadow',
                active ? 'ring-2 ring-ink' : 'ring-1 ring-line hover:ring-accent',
              )}
            >
              <img
                src={photo.image_url}
                alt=""
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
              {active ? (
                <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-ink text-accent-ink">
                  <Check size={14} aria-hidden="true" />
                </span>
              ) : null}
              <span className="block px-2 py-1.5 text-sm font-bold text-ink">{photo.label_cs}</span>
            </button>
          );
        })}
      </div>

      {/*
        The stock set is small and several activities share a picture, so a venue that wants
        its own room in the photograph must be able to say so. Uploads land in the folder
        named after the business, which is exactly what the storage policy allows.
      */}
      <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-card px-3 text-sm font-bold text-ink hover:border-accent">
        <Upload size={16} aria-hidden="true" />
        {uploading ? 'Nahrávám…' : 'Nahrát vlastní fotku'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={uploading}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            // Clearing the input lets the same file be chosen again after a failure.
            event.target.value = '';
            if (!file) return;
            setUploading(true);
            setUploadError(null);
            try {
              const url = await uploadServiceImage(businessId, file);
              setPickedSlug(null);
              onPick({ label: '', imageUrl: url });
            } catch (error) {
              setUploadError(errorMessage(error));
            } finally {
              setUploading(false);
            }
          }}
        />
      </label>
      {uploadError ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {uploadError}
        </p>
      ) : null}

      {/* Own photograph in use: no tile is lit, so show what was actually uploaded. */}
      {value && currentSlug === null ? (
        <div className="mt-3 flex items-center gap-3">
          <img src={value} alt="" className="size-16 rounded-lg object-cover" />
          <p className="text-sm text-muted">Vlastní fotka služby.</p>
        </div>
      ) : null}
    </div>
  );
}
