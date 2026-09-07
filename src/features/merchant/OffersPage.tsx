import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { merchantCancelOffer, merchantOffers, updateOffer } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayLabel } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, Field, Input, LoadingList, Sheet, Tabs } from '../../components/ui';
import { MerchantShell } from './MerchantShell';
import { CreateOfferSheet, type OfferDraft } from './CreateOfferSheet';
import { useServices } from './useBusiness';
import type { MerchantOffer } from '../../types/database';

type Tab = 'active' | 'upcoming' | 'ended';

export function MerchantOffersPage() {
  return <MerchantShell>{(business) => <Offers businessId={business.id} approved={business.status === 'approved'} />}</MerchantShell>;
}

function Offers({ businessId, approved }: { businessId: string; approved: boolean }) {
  const now = useServerNow();
  const [tab, setTab] = useState<Tab>('active');
  const [draft, setDraft] = useState<OfferDraft>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toCancel, setToCancel] = useState<MerchantOffer | null>(null);
  const [toEdit, setToEdit] = useState<MerchantOffer | null>(null);
  const services = useServices(businessId);

  const query = useQuery({
    queryKey: ['merchant-offers', businessId],
    queryFn: () => merchantOffers(businessId),
    refetchOnWindowFocus: true,
  });

  const all = query.data ?? [];
  const rows = all.filter((offer) => {
    const started = Date.parse(offer.start_at) <= Date.parse(now);
    if (tab === 'active') return offer.bookable;
    if (tab === 'upcoming') return !started && offer.status === 'published' && !offer.bookable;
    return started || offer.status === 'cancelled';
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Nabídky</h1>
        <Button
          disabled={!approved}
          onClick={() => {
            setDraft(null);
            setSheetOpen(true);
          }}
        >
          + Přidat volný termín
        </Button>
      </div>

      <Tabs
        label="Nabídky"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'active', label: 'Aktivní' },
          { value: 'upcoming', label: 'Nadcházející' },
          { value: 'ended', label: 'Ukončené' },
        ]}
      />

      {query.isPending ? <LoadingList /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.isSuccess && rows.length === 0 ? (
        <EmptyState
          title="Dnes zatím nemáte žádnou volnou nabídku."
          body="Prázdný termín zveřejníte za půl minuty."
          action={
            approved ? (
              <Button onClick={() => setSheetOpen(true)}>+ Přidat volný termín</Button>
            ) : undefined
          }
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.map((offer) => (
          <li key={offer.id} className="rounded-2xl border border-line bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-bold text-ink">{offer.service_name}</p>
                <p className="tnum text-sm text-muted">
                  {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}–{clockTime(offer.end_at)}
                </p>
                <p className="tnum mt-1 text-sm font-semibold text-ink">
                  {money(offer.deal_price_cents)}{' '}
                  <span className="font-normal text-muted line-through">{money(offer.original_price_cents)}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="tnum text-sm font-semibold text-ink">
                  {offer.booked}/{offer.capacity_total} obsazeno
                </p>
                <p className="text-xs text-muted">
                  {offer.status === 'cancelled' ? 'Zrušeno' : offer.bookable ? 'Aktivní' : 'Neaktivní'}
                </p>
              </div>
            </div>

            {offer.cancellation_reason ? (
              <p className="mt-2 text-sm text-accent">Důvod zrušení: {offer.cancellation_reason}</p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft({ service_id: offer.service_id, deal_price_cents: offer.deal_price_cents });
                  setSheetOpen(true);
                }}
              >
                Zopakovat
              </Button>
              {offer.status === 'published' && Date.parse(offer.start_at) > Date.parse(now) ? (
                <>
                  <Button variant="secondary" onClick={() => setToEdit(offer)}>
                    Upravit
                  </Button>
                  <Button variant="danger" onClick={() => setToCancel(offer)}>
                    Zrušit
                  </Button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <CreateOfferSheet
        key={draft?.service_id ?? 'new'}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        services={services.data ?? []}
        draft={draft}
      />
      <CancelOfferSheet offer={toCancel} onClose={() => setToCancel(null)} />
      <EditOfferSheet offer={toEdit} onClose={() => setToEdit(null)} />
    </div>
  );
}

function CancelOfferSheet({ offer, onClose }: { offer: MerchantOffer | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: () => merchantCancelOffer(offer!.id, reason),
    onSuccess: async () => {
      setReason('');
      setFailure(null);
      onClose();
      await queryClient.invalidateQueries();
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  return (
    <Sheet
      open={Boolean(offer)}
      onClose={onClose}
      title="Zrušit nabídku"
      footer={
        <Button className="w-full" loading={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => cancel.mutate()}>
          Zrušit nabídku
        </Button>
      }
    >
      {offer && offer.booked > 0 ? (
        <Banner tone="warning">
          Nabídka má {offer.booked} potvrzených rezervací. Zrušením je zrušíte i zákazníkům a uvidí váš důvod.
        </Banner>
      ) : null}
      <div className="mt-3">
        <Field id="cancel-reason" label="Důvod (uvidí ho zákazník)" error={failure ?? undefined}>
          <Input
            id="cancel-reason"
            data-autofocus
            value={reason}
            placeholder="Např. nemoc, technická závada"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  );
}

/** Once a booking exists only capacity may rise; price, time and service stay immutable. */
function EditOfferSheet({ offer, onClose }: { offer: MerchantOffer | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [capacity, setCapacity] = useState('');
  const [price, setPrice] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const locked = (offer?.booked ?? 0) > 0 || (offer?.capacity_remaining ?? 0) < (offer?.capacity_total ?? 0);

  const save = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {};
      if (capacity) data.capacity_total = Number(capacity);
      if (!locked && price) data.deal_price_cents = Number(price) * 100;
      return updateOffer(offer!.id, data);
    },
    onSuccess: async () => {
      setCapacity('');
      setPrice('');
      setFailure(null);
      onClose();
      await queryClient.invalidateQueries();
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  return (
    <Sheet
      open={Boolean(offer)}
      onClose={onClose}
      title="Upravit nabídku"
      footer={
        <Button className="w-full" loading={save.isPending} onClick={() => save.mutate()}>
          Uložit změny
        </Button>
      }
    >
      {locked ? (
        <Banner tone="warning">
          Nabídka už má rezervace. Můžete pouze zvýšit počet míst — cenu a čas už měnit nelze.
        </Banner>
      ) : null}
      <div className="mt-3 flex flex-col gap-3">
        <Field id="edit-capacity" label="Počet míst" hint={offer ? `Nyní ${offer.capacity_total}` : undefined}>
          <Input
            id="edit-capacity"
            data-autofocus
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value.replace(/\D/g, ''))}
          />
        </Field>
        {!locked ? (
          <Field id="edit-price" label="Cena v Kč" hint={offer ? `Nyní ${money(offer.deal_price_cents)}` : undefined}>
            <Input
              id="edit-price"
              inputMode="numeric"
              value={price}
              onChange={(event) => setPrice(event.target.value.replace(/\D/g, ''))}
            />
          </Field>
        ) : null}
        {failure ? <Banner tone="warning">{failure}</Banner> : null}
      </div>
    </Sheet>
  );
}
