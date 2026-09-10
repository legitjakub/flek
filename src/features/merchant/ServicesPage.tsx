import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Check, ChevronDown, ImageOff } from 'lucide-react';
import { listCategories, saveService } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { Banner, Button, Chip, EmptyState, Field, Input, LoadingList, Select, Sheet, Textarea, cx } from '../../components/ui';
import { MerchantShell } from './MerchantShell';
import { ActivitySuggestions, ServicePhotoPicker } from './ActivityPicker';
import { useServices } from './useBusiness';
import type { Business, Service } from '../../types/database';
import { IllustrativePhotoLabel } from '../../components/IllustrativePhotoLabel';
import { serviceIllustration } from '../../lib/serviceIllustrations';

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120] as const;

export function MerchantServicesPage() {
  return <MerchantShell>{(business) => <Services business={business} />}</MerchantShell>;
}

function Services({ business }: { business: Business }) {
  const services = useServices(business.id);
  const [editing, setEditing] = useState<Service | null>(null);
  const [open, setOpen] = useState(false);

  function add() {
    setEditing(null);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Služby</h1>
          <p className="mt-1 text-sm text-muted">Co nabízíte, jak dlouho to trvá a jaká je běžná cena.</p>
        </div>
        <Button onClick={add}>+ Přidat službu</Button>
      </div>

      {services.isPending ? <LoadingList /> : null}
      {services.isSuccess && services.data.length === 0 ? (
        <EmptyState
          title="Zatím nemáte žádnou službu"
          body="Vyberte připravený typ služby, nebo si vytvořte vlastní."
          action={<Button onClick={add}>+ Přidat službu</Button>}
        />
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2">
        {(services.data ?? []).map((service) => {
          const image = serviceIllustration(service.name, service.image_url ?? business.cover_url);
          return (
            <li key={service.id}>
              <button
                type="button"
                onClick={() => {
                  setEditing(service);
                  setOpen(true);
                }}
                className="flex min-h-24 w-full items-center gap-3 rounded-2xl bg-card p-3 text-left shadow-card transition-transform hover:-translate-y-0.5"
              >
                {image ? (
                  <span className="relative size-20 shrink-0 overflow-hidden rounded-xl">
                    <img src={image} alt="" className="size-full object-cover" />
                    <IllustrativePhotoLabel compact className="right-1 bottom-1" />
                  </span>
                ) : (
                  <span className="grid size-20 shrink-0 place-items-center rounded-xl bg-surface text-muted">
                    <ImageOff size={22} aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold text-ink">{service.name}</span>
                  <span className="tnum mt-1 block text-sm text-muted">
                    {service.duration_minutes} min · {money(service.normal_price_cents)}
                  </span>
                  <span className={cx('mt-2 inline-flex rounded-md px-2 py-0.5 text-xs font-bold', service.is_active ? 'bg-positive/10 text-positive' : 'bg-danger-soft text-danger')}>
                    {service.is_active ? 'Aktivní' : 'Neaktivní'}
                  </span>
                </span>
                <span className="text-sm font-bold text-accent">Upravit</span>
              </button>
            </li>
          );
        })}
      </ul>

      <ServiceSheet
        key={editing?.id ?? 'new'}
        open={open}
        onClose={() => setOpen(false)}
        business={business}
        service={editing}
      />
    </div>
  );
}

function ServiceSheet({
  open,
  onClose,
  business,
  service,
}: {
  open: boolean;
  onClose: () => void;
  business: Business;
  service: Service | null;
}) {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [category, setCategory] = useState(service?.category_slug ?? business.category_slug);
  const [minutes, setMinutes] = useState(String(service?.duration_minutes ?? 45));
  const [customDuration, setCustomDuration] = useState(
    service ? !DURATION_PRESETS.includes(service.duration_minutes as (typeof DURATION_PRESETS)[number]) : false,
  );
  const [price, setPrice] = useState(service ? String(service.normal_price_cents / 100) : '');
  const [active, setActive] = useState(service?.is_active ?? true);
  const [imageUrl, setImageUrl] = useState<string | null>(service?.image_url ?? null);
  const [template, setTemplate] = useState<string | null>(service?.template_slug ?? null);
  const [advanced, setAdvanced] = useState(Boolean(service?.description));
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const trimmedName = name.trim();
  const minutesNumber = Number(minutes);
  const priceNumber = Number(price);
  const nameError = trimmedName.length < 2 ? 'Napište název alespoň o 2 znacích.' : undefined;
  const durationError = !/^\d+$/.test(minutes) || minutesNumber < 5 || minutesNumber > 480
    ? 'Zadejte délku od 5 do 480 minut.'
    : undefined;
  const priceError = !/^\d+$/.test(price) || priceNumber <= 0
    ? 'Zadejte běžnou cenu v celých korunách.'
    : undefined;
  const valid = !nameError && !durationError && !priceError;

  const save = useMutation({
    mutationFn: () =>
      saveService(
        business.id,
        {
          name: trimmedName,
          description: description.trim(),
          category_slug: category,
          duration_minutes: minutesNumber,
          normal_price_cents: priceNumber * 100,
          is_active: active,
          image_url: imageUrl,
          template_slug: template === 'custom' ? null : template,
        },
        service?.id ?? null,
      ),
    onSuccess: async () => {
      setFailure(null);
      onClose();
      await queryClient.invalidateQueries({ queryKey: ['services', business.id] });
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  function submit() {
    setAttempted(true);
    setFailure(null);
    if (!valid) {
      const first = nameError ? 's-name' : durationError ? 's-duration' : 's-price';
      window.setTimeout(() => document.getElementById(first)?.focus(), 0);
      return;
    }
    save.mutate();
  }

  const previewImage = serviceIllustration(trimmedName, imageUrl ?? business.cover_url);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={service ? 'Upravit službu' : 'Přidat službu'}
      footer={
        <div>
          {attempted && !valid ? <p className="mb-2 text-center text-sm font-medium text-danger">Doplňte označená pole.</p> : null}
          <Button className="w-full" size="lg" loading={save.isPending} onClick={submit}>
            {service ? 'Uložit změny' : 'Uložit službu'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {!service ? (
          <ActivitySuggestions
            categorySlug={category}
            selected={template}
            onPick={(choice) => {
              setTemplate(choice.slug);
              setName(choice.label);
              if (choice.imageUrl) setImageUrl(choice.imageUrl);
            }}
            onCustom={() => {
              setTemplate('custom');
              setName('');
              window.setTimeout(() => document.getElementById('s-name')?.focus(), 0);
            }}
          />
        ) : null}
        <div>
          <Field
            id="s-name"
            label="Název pro zákazníka"
            hint="Připravený název můžete upravit tak, jak službu skutečně nabízíte."
            error={attempted ? nameError : undefined}
          >
            <Input
              id="s-name"
              data-autofocus={service ? '' : undefined}
              placeholder="Např. Pánský střih s mytím"
              value={name}
              aria-invalid={attempted && Boolean(nameError) || undefined}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
        </div>

        <fieldset>
          <legend className="text-sm font-bold text-ink">Délka služby</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {DURATION_PRESETS.map((preset) => (
              <Chip
                key={preset}
                active={!customDuration && minutesNumber === preset}
                onClick={() => {
                  setCustomDuration(false);
                  setMinutes(String(preset));
                }}
              >
                {preset} min
              </Chip>
            ))}
            <div className="col-span-3 [&>button]:w-full">
              <Chip
                active={customDuration}
                onClick={() => {
                  if (!customDuration) setMinutes('');
                  setCustomDuration(true);
                }}
              >
                Jiná délka
              </Chip>
            </div>
          </div>
          {customDuration ? (
            <div className="relative mt-3 max-w-48">
              <Input
                id="s-duration"
                inputMode="numeric"
                placeholder="Např. 75"
                value={minutes}
                aria-invalid={attempted && Boolean(durationError) || undefined}
                className="pr-14"
                onChange={(event) => setMinutes(event.target.value.replace(/\D/g, ''))}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-bold text-muted">min</span>
            </div>
          ) : null}
          {attempted && durationError ? <p className="mt-2 text-sm font-medium text-danger">{durationError}</p> : null}
        </fieldset>

        <Field
          id="s-price"
          label="Běžná cena"
          hint="Cena bez slevy. Slevu nastavíte až při zveřejnění konkrétního volného termínu."
          error={attempted ? priceError : undefined}
        >
          <div className="relative">
            <Input
              id="s-price"
              inputMode="numeric"
              placeholder="Např. 650"
              value={price}
              aria-invalid={attempted && Boolean(priceError) || undefined}
              className="pr-12 text-lg font-bold"
              onChange={(event) => setPrice(event.target.value.replace(/\D/g, ''))}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-bold text-muted">Kč</span>
          </div>
        </Field>

        <ServicePhotoPicker
          categorySlug={category}
          templateSlug={template}
          serviceName={trimmedName}
          value={imageUrl}
          venueCover={business.cover_url}
          onPick={setImageUrl}
        />

        <section aria-labelledby="service-preview-title">
          <h2 id="service-preview-title" className="text-sm font-bold text-ink">Náhled pro zákazníka</h2>
          <div className="mt-2 flex overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
            {previewImage ? (
              <span className="relative h-28 w-28 shrink-0">
                <img src={previewImage} alt="" className="size-full object-cover" />
                <IllustrativePhotoLabel compact className="right-1.5 bottom-1.5" />
              </span>
            ) : (
              <span className="grid h-28 w-28 shrink-0 place-items-center bg-line/50 text-muted"><ImageOff size={22} aria-hidden="true" /></span>
            )}
            <div className="min-w-0 flex-1 p-3">
              <p className="truncate text-sm font-bold text-muted">{business.display_name}</p>
              <p className="mt-1 line-clamp-2 text-base font-extrabold text-ink">{trimmedName || 'Název služby'}</p>
              <p className="tnum mt-2 text-sm text-muted">
                {minutes && !durationError ? `${minutes} min` : 'Délka'} · {price && !priceError ? `${price} Kč` : 'Cena'}
              </p>
            </div>
          </div>
        </section>

        <div className="rounded-xl border border-line">
          <button
            type="button"
            aria-expanded={advanced}
            onClick={() => setAdvanced((value) => !value)}
            className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left text-sm font-bold text-muted"
          >
            Popis a kategorie <span className="font-medium">nepovinné</span>
            <ChevronDown size={17} className={cx('transition-transform', advanced && 'rotate-180')} aria-hidden="true" />
          </button>
          {advanced ? (
            <div className="flex flex-col gap-4 border-t border-line p-3">
              <Field id="s-description" label="Popis" hint="Krátce vysvětlete, co je v ceně.">
                <Textarea id="s-description" value={description} onChange={(event) => setDescription(event.target.value)} />
              </Field>
              <Field id="s-category" label="Kategorie" hint="Předvyplněná podle vaší provozovny.">
                <Select
                  id="s-category"
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setImageUrl(null);
                    setTemplate(null);
                  }}
                >
                  {(categories.data ?? []).map((item) => <option key={item.slug} value={item.slug}>{item.label_cs}</option>)}
                </Select>
              </Field>
            </div>
          ) : null}
        </div>

        {service ? (
          <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-surface px-3 text-sm font-bold text-ink">
            <span>
              Služba je aktivní
              <span className="mt-0.5 block text-xs font-medium text-muted">Neaktivní služba zůstane v historii, ale nepůjde nabídnout.</span>
            </span>
            <span className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', active ? 'bg-positive' : 'bg-line')}>
              <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="peer sr-only" />
              <span className={cx('absolute top-1 grid size-5 place-items-center rounded-full bg-card shadow-sm transition-transform', active ? 'translate-x-6' : 'translate-x-1')}>
                {active ? <Check size={12} aria-hidden="true" /> : null}
              </span>
            </span>
          </label>
        ) : null}
        {failure ? <Banner tone="danger">{failure}</Banner> : null}
      </div>
    </Sheet>
  );
}
