import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { merchantCancelOffer, merchantOffers, updateOffer } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayLabel } from '../../lib/time';
import { serverNow, useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, Field, Input, LoadingList, Sheet, Tabs } from '../../components/ui';
import { MerchantShell } from './MerchantShell';
import { Link } from '../../app/router';
import { Plus } from 'lucide-react';
import { CreateOfferSheet, cutoffFor, type OfferDraft } from './CreateOfferSheet';
import { localInput, localToInstant } from '../../lib/time';
import { useServices } from './useBusiness';
import { StatusBadge } from '../../components/StatusBadge';
import { discountPct, priceProblem, quote } from '../../lib/pricing';
import type { MerchantOffer } from '../../types/database';

type Tab = 'active' | 'upcoming' | 'ended';

export function MerchantOffersPage() {
  return (
    <MerchantShell>
      {(business) => (
        <Offers businessId={business.id} approved={business.status === 'approved'} />
      )}
    </MerchantShell>
  );
}

function Offers({ businessId, approved }: { businessId: string; approved: boolean }) {
  const now = useServerNow();
  const [tab, setTab] = useState<Tab>('active');
  const [draft, setDraft] = useState<OfferDraft>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [published, setPublished] = useState<string | null>(null);
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
      {published ? (
        <div className="mb-4">
          <Banner tone="success">
            Nabídka je aktivní. <span className="tnum">{published}</span>{' '}
            <button type="button" onClick={() => setPublished(null)} className="font-bold underline underline-offset-4">Skrýt</button>
          </Banner>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">Nabídky</h1>
        <Button
          size="lg"
          className="w-full sm:w-auto"
          disabled={!approved || services.isPending}
          onClick={() => {
            setDraft(null);
            setSheetOpen(true);
          }}
        >
          <Plus size={20} aria-hidden="true" />Přidat volný termín
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
          title="V tomto přehledu zatím nemáte žádnou nabídku."
          body="Prázdný termín zveřejníte za půl minuty."
          action={
            approved ? (
              <Button onClick={() => setSheetOpen(true)}><Plus size={20} aria-hidden="true" />Přidat volný termín</Button>
            ) : undefined
          }
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.map((offer) => (
          <li key={offer.id} className="rounded-2xl bg-card shadow-card p-5 xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center xl:gap-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-bold text-ink">{offer.service_name}</p>
                <p className="tnum text-sm text-muted">
                  {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}–{clockTime(offer.end_at)}
                </p>
                {/* The merchant's number first — what they are paid per booked seat — and the
                    price customers actually see beside it, so neither is a surprise later. */}
                <p className="tnum mt-1 text-sm text-muted">
                  Vy dostanete <span className="text-base font-extrabold text-ink">{money(offer.merchant_price_cents)}</span>
                  {' · '}zákazník platí <span className="font-bold text-ink">{money(offer.deal_price_cents)}</span>
                  {' · '}ušetří {discountPct(offer.original_price_cents, offer.deal_price_cents)} %
                </p>
              </div>
              {/*
                One row, and a badge in the shared colours. On a phone this column wrapped under
                the price and its right-aligned "Aktivní" drifted to a stray indent; and
                "Neaktivní" did not say why — sold out and closed for booking look the same.
              */}
              <div className="flex flex-wrap items-center gap-2">
                <p className="tnum text-sm font-bold text-ink">
                  {offer.booked}/{offer.capacity_total} obsazeno
                </p>
                {offer.pending_requests ? (
                  <Link to="/partner/rezervace" className="tnum inline-flex min-h-11 items-center rounded-full px-1 text-sm font-bold text-brand underline underline-offset-4">
                    {requestsWaiting(offer.pending_requests)}
                  </Link>
                ) : null}
                {offer.status === 'cancelled' ? (
                  <StatusBadge status="cancelled" />
                ) : offer.bookable ? (
                  <StatusBadge status="published" label="Aktivní" />
                ) : (
                  <StatusBadge status="draft" label={offer.capacity_remaining === 0 ? 'Vyprodáno' : 'Uzavřeno'} />
                )}
              </div>
            </div>

            {offer.cancellation_reason ? (
              <p className="mt-2 text-sm text-accent">Důvod zrušení: {offer.cancellation_reason}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2 xl:mt-0">
              {/* Not on a suspended or unapproved venue: the sheet opened, the form filled
                  in, and the publish then failed with BUSINESS_NOT_APPROVED. */}
              {approved ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDraft({
                      service_id: offer.service_id,
                      merchant_price_cents: offer.merchant_price_cents,
                      start_at: offer.start_at,
                      capacity_total: offer.capacity_total,
                    });
                    setSheetOpen(true);
                  }}
                >
                  Zopakovat
                </Button>
              ) : null}
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

      {sheetOpen ? <CreateOfferSheet onPublished={setPublished}
        key={draft?.service_id ?? 'new'}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        services={services.data ?? []}
        draft={draft}
      /> : null}
      <CancelOfferSheet offer={toCancel} onClose={() => setToCancel(null)} />
      {/*
        Keyed and mounted only with an offer. The sheet read `offer` in useState initialisers
        while it was still null on first mount, so the first offer edited in a session opened
        with empty fields and "Nyní …" hints against blank inputs.
      */}
      {toEdit ? <EditOfferSheet key={toEdit.id} offer={toEdit} onClose={() => setToEdit(null)} /> : null}
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
    onError: (error) => setFailure(errorMessage(error, 'merchant')),
  });

  return (
    <Sheet
      open={Boolean(offer)}
      onClose={onClose}
      title="Zrušit nabídku"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Nechat</Button>
          <Button variant="danger" className="flex-[2]" loading={cancel.isPending} disabled={reason.trim().length < 3} onClick={() => cancel.mutate()}>Zrušit nabídku</Button>
        </div>
      }
    >
      {offer && offer.booked > 0 ? (
        <Banner tone="warning">
          Nabídka má {offer.booked} potvrzených rezervací. Zrušením je zrušíte i zákazníkům a uvidí váš důvod.
        </Banner>
      ) : null}
      {offer?.pending_requests ? (
        <div className={offer.booked > 0 ? 'mt-2' : undefined}>
          <Banner tone="warning">
            {requestsWaiting(offer.pending_requests)}. Zrušením nabídky je odmítnete a zákazníkům uvolníme blokaci částky na kartě.
          </Banner>
        </div>
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

function requestsWaiting(count: number): string {
  if (count === 1) return '1 žádost čeká na potvrzení';
  if (count >= 2 && count <= 4) return `${count} žádosti čekají na potvrzení`;
  return `${count} žádostí čeká na potvrzení`;
}

/** Live "zákazník uvidí" under the edited merchant price, the same preview as publishing. */
function editHint(price: string, offer: MerchantOffer): string {
  if (Number(price) * 100 === offer.merchant_price_cents) return `Zákazník uvidí ${money(offer.deal_price_cents)} · ušetří ${discountPct(offer.original_price_cents, offer.deal_price_cents)} %`;
  const q = /^\d+$/.test(price) ? quote(Number(price) * 100, offer.original_price_cents) : null;
  if (!q) return `Nyní dostáváte ${money(offer.merchant_price_cents)}`;
  const problem = priceProblem(q);
  return problem ? (problem === 'price_too_low' ? 'Částka je nezvykle nízká. Zkontrolujte ji.' : 'Zákazník by ušetřil méně než 10 %. Snižte částku.') : `Zákazník uvidí ${money(q.customerCents)} · ušetří ${q.discountPct} %`;
}

/** Once a booking exists only capacity may rise; price, time and service stay immutable. */
function EditOfferSheet({ offer, onClose }: { offer: MerchantOffer; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [capacity, setCapacity] = useState(String(offer.capacity_total));
  const [price, setPrice] = useState(String(offer.merchant_price_cents / 100));
  const [start, setStart] = useState(localInput(offer.start_at));
  const [failure, setFailure] = useState<string | null>(null);
  // Frozen by a booking the customer really has; a request that may still fail freezes nothing, but blocks edits while it runs.
  const locked = offer.has_bookings || offer.booked > 0;
  const waiting = (offer.pending_requests ?? 0) > 0;

  const save = useMutation({
    mutationFn: () => {
      if (!/^\d+$/.test(capacity) || Number(capacity) < 1 || Number(capacity) > 50 || (locked && Number(capacity) < offer.capacity_total)) throw new Error('INVALID_CAPACITY');
      if (!locked) {
        const preview = quote(Number(price) * 100, offer.original_price_cents);
        if (!/^\d+$/.test(price) || !preview) throw new Error('VALIDATION_ERROR');
        if (Number(price) * 100 !== offer.merchant_price_cents) {
          const problem = priceProblem(preview);
          if (problem) throw new Error(problem === 'price_too_low' ? 'PRICE_TOO_LOW' : problem === 'no_saving' ? 'NO_CUSTOMER_SAVING' : 'SAVING_TOO_SMALL');
        }
        if (!start) throw new Error('INVALID_START');
      }
      const data: Record<string, unknown> = {};
      if (capacity) data.capacity_total = Number(capacity);
      // Only the merchant's own price is sent; the server adds the fee. Sending it unchanged
      // would also move a legacy offer onto the current fee policy, so only a real change goes.
      if (!locked && price && Number(price) * 100 !== offer.merchant_price_cents) data.merchant_price_cents = Number(price) * 100;
      // Moving a slot was possible on the server all along — update_offer accepts start_at —
      // and impossible in the form, so a merchant running late had to cancel and republish.
      // The cutoff travels with it, clamped, or the server derives start−15 min and rejects
      // its own default for anything under twenty minutes away.
      if (!locked && start && localInput(offer.start_at) !== start) {
        const instant = localToInstant(start);
        data.start_at = instant;
        data.booking_cutoff_at = cutoffFor(instant, serverNow());
      }
      return updateOffer(offer.id, data);
    },
    onSuccess: async () => {
      setFailure(null);
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['merchant-offers'] }),
        queryClient.invalidateQueries({ queryKey: ['merchant-metrics'] }),
        queryClient.invalidateQueries({ queryKey: ['discovery'] }),
      ]);
    },
    onError: (error) => setFailure(errorMessage(error, 'merchant')),
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title="Upravit nabídku"
      footer={
        <Button className="w-full" loading={save.isPending} disabled={waiting} onClick={() => save.mutate()}>
          Uložit změny
        </Button>
      }
    >
      {waiting ? (
        <div className="mb-3">
          <Banner tone="warning">
            {requestsWaiting(offer.pending_requests ?? 0)}. Upravit nabídku půjde, až žádost potvrdíte, odmítnete, nebo vyprší.
          </Banner>
        </div>
      ) : null}
      {locked ? (
        <Banner tone="warning">
          Nabídka už má rezervace. Můžete pouze zvýšit počet míst — cenu a čas už měnit nelze.
        </Banner>
      ) : null}
      <div className="mt-3 flex flex-col gap-3">
        <Field id="edit-capacity" label="Počet míst" hint={`Nyní ${offer.capacity_total}`}>
          <Input
            id="edit-capacity"
            data-autofocus
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value.replace(/\D/g, ''))}
          />
        </Field>
        {!locked ? (
          <>
            <Field id="edit-price" label="Kolik chcete dostat (Kč)" hint={editHint(price, offer)}>
              <Input
                id="edit-price"
                inputMode="numeric"
                value={price}
                onChange={(event) => setPrice(event.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field id="edit-start" label="Začátek">
              <Input
                id="edit-start"
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </Field>
          </>
        ) : null}
        {failure ? <Banner tone="warning">{failure}</Banner> : null}
      </div>
    </Sheet>
  );
}
