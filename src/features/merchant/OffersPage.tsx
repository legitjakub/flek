import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { merchantCancelOffer, merchantOffers, updateOffer } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { duration } from '../../lib/time';
import { serverNow, useServerNow } from '../../lib/clock';
import { Banner, Button, EmptyState, ErrorState, Field, Input, LoadingList, Sheet, Tabs } from '../../components/ui';
import { MerchantShell } from './MerchantShell';
import { Link } from '../../app/router';
import { BellRing, CalendarPlus, ChevronRight, Pencil, Plus, Repeat2, X } from 'lucide-react';
import { CreateOfferSheet, cutoffFor, type OfferDraft } from './CreateOfferSheet';
import { localInput, localToInstant } from '../../lib/time';
import { useServices } from './useBusiness';
import { recentOffers, repeatDraft } from './offerDraft';
import { StatusBadge, type AppStatus } from '../../components/StatusBadge';
import { discountPct, priceProblem, quote } from '../../lib/pricing';
import type { Business, MerchantOffer } from '../../types/database';
import { SetupNotice, usePublishReadiness } from './SetupGuide';
import { CapacityMeter, CardAction, DayHeading, PageHeader, TimeCard, dayHeading, groupByDay, type Tone } from './partnerUi';

type Tab = 'upcoming' | 'ended';

export function MerchantOffersPage() {
  return (
    <MerchantShell>
      {(business) => <Offers business={business} />}
    </MerchantShell>
  );
}

function Offers({ business }: { business: Business }) {
  const businessId = business.id;
  const readiness = usePublishReadiness(business);
  const now = useServerNow();
  const [tab, setTab] = useState<Tab>('upcoming');
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
  /*
   * Everything still ahead is one diary, day by day: what customers can book, what is full and
   * what closed, each marked on its card. Split across "Aktivní" and "Nadcházející", tomorrow's
   * schedule sat in two tabs.
   */
  const tabOf = (offer: MerchantOffer): Tab | null => {
    const started = Date.parse(offer.start_at) <= Date.parse(now);
    if (!started && offer.status === 'published') return 'upcoming';
    return started || offer.status === 'cancelled' ? 'ended' : null;
  };
  // The server sends the newest first. What is still ahead reads like a diary, soonest at the top.
  const rows = all.filter((offer) => tabOf(offer) === tab);
  if (tab === 'upcoming') rows.reverse();
  const count = (which: Tab) => all.filter((offer) => tabOf(offer) === which).length;
  const addOffer = () => {
    setDraft(null);
    setSheetOpen(true);
  };

  return (
    <div className="flex flex-col gap-5">
      {published ? (
        <Banner tone="success">
          Nabídka je aktivní. <span className="tnum">{published}</span>{' '}
          <button type="button" onClick={() => setPublished(null)} className="inline-flex min-h-11 items-center font-bold underline underline-offset-4">Skrýt</button>
        </Banner>
      ) : null}
      <PageHeader
        title="Nabídky"
        subtitle="Volné termíny, které teď zákazníci vidí, a ty, které už proběhly."
        action={readiness.canPublish ? (
          <Button variant="brand" size="lg" className="w-full sm:w-auto" onClick={addOffer}>
            <Plus size={20} aria-hidden="true" />Přidat volný termín
          </Button>
        ) : null}
      />
      {/* A button that opened a sheet only to fail at the end said nothing about why; this says what is missing. */}
      <SetupNotice business={business} />

      {/* Three tabs over nothing at all only asked which empty list to look at. */}
      {query.isSuccess && all.length === 0 ? null : (
        <Tabs
          label="Nabídky"
          pill
          value={tab}
          onChange={setTab}
          items={[
            { value: 'upcoming', label: 'Nadcházející', count: query.isSuccess ? count('upcoming') : undefined },
            { value: 'ended', label: 'Ukončené' },
          ]}
        />
      )}

      {query.isPending ? <LoadingList /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {query.isSuccess && rows.length === 0 ? (
        all.length === 0 && !readiness.canPublish ? (
          <EmptyState icon={<CalendarPlus size={24} />} title="Zatím tu nejsou žádné FLEKy." body="Až dokončíte nastavení, zveřejníte volný termín za půl minuty." />
        ) : (
          <EmptyState
            icon={<CalendarPlus size={24} />}
            title={tab === 'upcoming' ? 'Teď nemáte žádný nadcházející FLEK.' : 'Zatím tu nic není.'}
            body={tab === 'upcoming' ? 'Prázdný termín zveřejníte za půl minuty.' : 'Proběhlé a zrušené nabídky se objeví tady.'}
            action={
              readiness.canPublish && tab === 'upcoming' ? (
                <Button variant="brand" onClick={addOffer}><Plus size={20} aria-hidden="true" />Přidat volný termín</Button>
              ) : undefined
            }
          />
        )
      ) : null}

      {groupByDay(rows, (offer) => offer.start_at).map((day) => (
        <section key={day.key} className="flex flex-col gap-3" aria-label={dayHeading(day.start, now)}>
          <DayHeading instant={day.start} now={now} />
          <ul className="grid gap-3 xl:grid-cols-2">
            {day.rows.map((offer) => {
              const ahead = offer.status === 'published' && Date.parse(offer.start_at) > Date.parse(now);
              const state = offerState(offer, now);
              return (
                <li key={offer.id}>
                  <TimeCard
                    start={offer.start_at}
                    end={offer.end_at}
                    tone={state.tone}
                    dimmed={state.tone === 'muted' || state.tone === 'danger'}
                    actions={readiness.canPublish || ahead ? (
                      <>
                        {/* Not on a suspended or unapproved venue: the sheet opened, the form filled
                            in, and the publish then failed with BUSINESS_NOT_APPROVED. */}
                        {readiness.canPublish ? (
                          <CardAction
                            icon={<Repeat2 size={18} />}
                            label="Zopakovat"
                            onClick={() => {
                              setDraft(repeatDraft(offer));
                              setSheetOpen(true);
                            }}
                          />
                        ) : null}
                        {ahead ? (
                          <>
                            <CardAction icon={<Pencil size={17} />} label="Upravit" onClick={() => setToEdit(offer)} />
                            <CardAction icon={<X size={18} />} label="Zrušit" tone="danger" onClick={() => setToCancel(offer)} />
                          </>
                        ) : null}
                      </>
                    ) : undefined}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-base leading-snug font-extrabold text-ink">{offer.service_name}</h3>
                        <p className="tnum text-sm text-muted">{duration(offer.start_at, offer.end_at)} min</p>
                      </div>
                      {/* "Neaktivní" did not say why: sold out and closed for booking look the same. */}
                      <StatusBadge status={state.status} label={state.label} />
                    </div>
                    {/* The merchant's number first — what they are paid per booked seat — and the
                        price customers actually see beside it, so neither is a surprise later. */}
                    <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
                      <p className="flex flex-col">
                        <span className="text-xs font-bold text-muted">Vy dostanete</span>
                        <span className="tnum text-xl leading-tight font-extrabold text-ink">{money(offer.merchant_price_cents)}</span>
                      </p>
                      <p className="tnum pb-0.5 text-sm text-muted">
                        zákazník platí <span className="font-bold text-ink">{money(offer.deal_price_cents)}</span>
                        {' · '}ušetří {discountPct(offer.original_price_cents, offer.deal_price_cents)} %
                      </p>
                    </div>
                    <div className="mt-3">
                      <CapacityMeter booked={offer.booked} total={offer.capacity_total} />
                    </div>
                    {offer.pending_requests ? (
                      <Link
                        to="/partner/rezervace"
                        className="tnum mt-3 flex min-h-11 items-center gap-2 rounded-2xl bg-brand-soft px-3 py-2 text-sm font-bold text-accent hover:bg-promo"
                      >
                        <BellRing size={16} aria-hidden="true" className="shrink-0" />
                        <span className="min-w-0 flex-1">{requestsWaiting(offer.pending_requests)}</span>
                        <ChevronRight size={16} aria-hidden="true" className="shrink-0" />
                      </Link>
                    ) : null}
                    {offer.cancellation_reason ? (
                      <p className="mt-2 text-sm text-danger">Důvod zrušení: {offer.cancellation_reason}</p>
                    ) : null}
                  </TimeCard>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {sheetOpen ? <CreateOfferSheet onPublished={setPublished}
        key={draft?.service_id ?? 'new'}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        services={services.data ?? []}
        draft={draft}
        recent={recentOffers(all, services.data ?? [])}
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

/** What an offer's card says about it, in words and in the colour of its edge. */
function offerState(offer: MerchantOffer, now: string): { status: AppStatus; label?: string; tone: Tone } {
  if (offer.status === 'cancelled') return { status: 'cancelled', tone: 'danger' };
  if (offer.bookable) return { status: 'published', label: 'Aktivní', tone: 'brand' };
  if (offer.capacity_remaining === 0) return { status: 'confirmed', label: 'Vyprodáno', tone: 'positive' };
  if (Date.parse(offer.end_at) <= Date.parse(now)) return { status: 'draft', label: 'Proběhlo', tone: 'muted' };
  if (Date.parse(offer.start_at) <= Date.parse(now)) return { status: 'draft', label: 'Probíhá', tone: 'muted' };
  return { status: 'draft', label: 'Uzavřeno', tone: 'muted' };
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
