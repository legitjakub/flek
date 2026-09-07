import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { listCategories, saveService } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { Banner, Button, EmptyState, Field, Input, LoadingList, Select, Sheet, Textarea } from '../../components/ui';
import { MerchantShell } from './MerchantShell';
import { useServices } from './useBusiness';
import type { Service } from '../../types/database';

export function MerchantServicesPage() {
  return <MerchantShell>{(business) => <Services businessId={business.id} categorySlug={business.category_slug} />}</MerchantShell>;
}

function Services({ businessId, categorySlug }: { businessId: string; categorySlug: string }) {
  const services = useServices(businessId);
  const [editing, setEditing] = useState<Service | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Služby</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          + Přidat službu
        </Button>
      </div>
      <p className="text-sm text-muted">
        Služby se nemažou — nepoužívanou jen deaktivujete, aby zůstala historie rezervací čitelná.
      </p>

      {services.isPending ? <LoadingList /> : null}
      {services.isSuccess && services.data.length === 0 ? (
        <EmptyState
          title="Zatím nemáte žádnou službu"
          body="Přidejte například Pánský střih, 45 min, 650 Kč."
          action={<Button onClick={() => setOpen(true)}>+ Přidat službu</Button>}
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {(services.data ?? []).map((service) => (
          <li key={service.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4">
            <div>
              <p className="text-base font-bold text-ink">{service.name}</p>
              <p className="tnum text-sm text-muted">
                {service.duration_minutes} min · {money(service.normal_price_cents)}
                {service.is_active ? '' : ' · neaktivní'}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(service);
                setOpen(true);
              }}
            >
              Upravit
            </Button>
          </li>
        ))}
      </ul>

      <ServiceSheet
        key={editing?.id ?? 'new'}
        open={open}
        onClose={() => setOpen(false)}
        businessId={businessId}
        service={editing}
        defaultCategory={categorySlug}
      />
    </div>
  );
}

function ServiceSheet({
  open,
  onClose,
  businessId,
  service,
  defaultCategory,
}: {
  open: boolean;
  onClose: () => void;
  businessId: string;
  service: Service | null;
  defaultCategory: string;
}) {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 3_600_000 });
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [category, setCategory] = useState(service?.category_slug ?? defaultCategory);
  const [minutes, setMinutes] = useState(String(service?.duration_minutes ?? 45));
  const [price, setPrice] = useState(service ? String(service.normal_price_cents / 100) : '');
  const [active, setActive] = useState(service?.is_active ?? true);
  const [failure, setFailure] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      saveService(
        businessId,
        {
          name,
          description,
          category_slug: category,
          duration_minutes: Number(minutes),
          normal_price_cents: Number(price) * 100,
          is_active: active,
        },
        service?.id ?? null,
      ),
    onSuccess: async () => {
      setFailure(null);
      onClose();
      await queryClient.invalidateQueries();
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  const valid = name.trim().length >= 2 && /^\d+$/.test(price) && Number(price) > 0 && Number(minutes) >= 5;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={service ? 'Upravit službu' : 'Přidat službu'}
      footer={
        <Button className="w-full" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
          Uložit službu
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field id="s-name" label="Název">
          <Input id="s-name" data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field id="s-category" label="Kategorie">
          <Select id="s-category" value={category} onChange={(event) => setCategory(event.target.value)}>
            {(categories.data ?? []).map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.label_cs}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="s-minutes" label="Délka (min)">
            <Input
              id="s-minutes"
              inputMode="numeric"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field id="s-price" label="Běžná cena (Kč)">
            <Input
              id="s-price"
              inputMode="numeric"
              value={price}
              onChange={(event) => setPrice(event.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </div>
        <Field id="s-description" label="Popis" hint="Nepovinné. Uvidí ho zákazník u nabídky.">
          <Textarea id="s-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        {service ? (
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="size-5" />
            Služba je aktivní
          </label>
        ) : null}
        {failure ? <Banner tone="warning">{failure}</Banner> : null}
      </div>
    </Sheet>
  );
}
