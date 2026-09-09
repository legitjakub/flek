import { ArrowLeft, CalendarDays, CalendarPlus, Clock3, MapPin, Banknote, Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getOfferDetail } from '../../lib/api';
import { track } from '../../lib/analytics';
import { relativeTime, useServerNow } from '../../lib/clock';
import { money, distance as formatDistance } from '../../lib/format';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { DEFAULT_POINT, storedPoint } from '../../lib/geo';
import { Banner, Button, ErrorState, Rating, Skeleton } from '../../components/ui';
import { bookingIcs, icsHref } from '../../lib/calendar';
import { Link, useRouter } from '../../app/router';
import { BookingSheet, cancellationDeadline } from '../bookings/BookingSheet';
import { Voucher } from '../bookings/Voucher';
import { FavoriteButton } from '../favorites/FavoriteButton';
import { LazyMap } from './LazyMap';

export function OfferDetailPage({ offerId }: { offerId: string }) {
  const { search, navigate } = useRouter();
  const origin = search.get('from') ?? '/';
  const returnTo = /^(\/|\/mapa)(\?.*)?$/.test(origin) ? origin : '/';
  const now = useServerNow(15_000);
  const point = storedPoint() ?? DEFAULT_POINT;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['offer', offerId],
    queryFn: () => getOfferDetail(offerId, point),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const offer = query.data ?? null;

  useEffect(() => {
    if (offer) track('offer_viewed', { offer_id: offer.id, business_id: offer.business_id });
  }, [offer?.id]);

  // Returning from authentication with intent intact: reopen the confirmation sheet.
  useEffect(() => {
    if (search.get('rezervovat') === '1' && offer?.bookable) setSheetOpen(true);
  }, [search, offer?.bookable]);

  if (query.isPending) {
    return (
      <main className="page-container py-4">
        <Skeleton className="h-52 w-full" />
        <Skeleton className="mt-4 h-8 w-2/3" />
        <Skeleton className="mt-2 h-5 w-1/2" />
      </main>
    );
  }
  if (query.isError) {
    return (
      <main className="page-container py-6">
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </main>
    );
  }
  if (!offer) {
    return (
      <main className="page-container py-10 text-center">
        <p className="text-base font-bold text-ink">Tento termín už bohužel není volný.</p>
        <Link to="/" className="mt-4 inline-block text-base font-bold underline underline-offset-4">
          Zpět na nabídky
        </Link>
      </main>
    );
  }

  if (code) {
    return <BookingSuccess code={code} offer={offer} now={now} />;
  }

  const image = offer.image_url ?? offer.cover_url;
  const savings = offer.original_price_cents - offer.deal_price_cents;
  const minutesAway = Math.round((Date.parse(offer.start_at) - Date.parse(now)) / 60000);
  const lastSeat = offer.capacity_remaining === 1 && offer.capacity_total > 1;
  const cutoffMinutes = Math.round((Date.parse(offer.booking_cutoff_at) - Date.parse(now)) / 60000);

  const hasPhoto = Boolean(image) && image !== failedPhoto;

  return (
    <main className="page-container pb-32 md:pb-10">
      {/* Above a photo the back arrow rides on the image itself, the way every booking app
          does it: a text link there costs a whole row of height and pushes the price down.
          Without a photo there is nothing to ride on, so the link comes back. */}
      {hasPhoto ? null : (
        <Link to={returnTo} className="my-4 inline-flex min-h-11 items-center gap-2 text-base font-bold text-muted hover:text-accent"><ArrowLeft size={18} aria-hidden="true" />Zpět na nabídky</Link>
      )}
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_320px] lg:gap-12 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {hasPhoto ? (
            /* Full-bleed on a phone. Inset behind the page gutter it read as one more card
               on a page already made of cards; edge to edge it reads as the subject. */
            <div className="relative -mx-4 mb-5 md:mx-0 md:mb-6">
              <img
                src={image!}
                onError={() => setFailedPhoto(image)}
                alt=""
                className="aspect-[16/9] w-full object-cover md:aspect-[2/1] md:rounded-2xl"
              />
              {/* Only under the controls, and only as far as they reach: a scrim over the
                  whole image would dull the photograph for no reason. */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/35 to-transparent md:rounded-t-2xl" />
              <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-3">
                <Link
                  to={returnTo}
                  aria-label="Zpět na nabídky"
                  className="grid size-11 place-items-center rounded-full bg-card/90 text-ink shadow-card backdrop-blur-sm hover:bg-card"
                >
                  <ArrowLeft size={20} aria-hidden="true" />
                </Link>
                <FavoriteButton
                  variant="overlay"
                  businessId={offer.business_id}
                  businessName={offer.business_name}
                />
              </div>
            </div>
          ) : null}
          <h1 className="text-2xl leading-tight font-extrabold tracking-tight [overflow-wrap:anywhere]">
            {offer.service_name}
          </h1>

          {/* One line per idea. The venue owns its own line; everything that merely
              describes it sits together in a single meta row at one size, separated by
              dots — previously the rating was glued to the name and read as part of it. */}
          <p className="mt-3 text-lg font-extrabold [overflow-wrap:anywhere]">{offer.business_name}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-muted">
            {offer.district ? <span>{offer.district}</span> : null}
            {offer.district && offer.distance_m != null ? <span aria-hidden="true">·</span> : null}
            {offer.distance_m != null ? <span className="tnum">{formatDistance(offer.distance_m)}</span> : null}
            <span aria-hidden="true">·</span>
            <Rating average={offer.rating_avg} count={offer.rating_count} />
          </p>
          <p className="mt-1.5 flex items-start gap-2 text-base leading-relaxed text-muted">
            <MapPin size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              {offer.address_line}, {offer.city}
            </span>
          </p>

          {/* With a photo this control already sits on it. Without one it has nowhere else
              to go, and a lone button on its own row is better than no way to follow. */}
          {hasPhoto ? null : (
            <div className="mt-5">
              <FavoriteButton businessId={offer.business_id} businessName={offer.business_name} />
            </div>
          )}
        </div>
        {/*
          One surface for the whole decision. Before this the four things a person weighs —
          when it starts, how long it runs, what it costs, and whether they can back out —
          were spread over three visual bands, and the price block landed underneath the
          fixed bar at the position the page opens at, so the strongest argument for booking
          was painted over by the button. Measured on production: price at y=759, bar from
          y=755. Grouping them fixes the collision by construction, not by nudging offsets.
        */}
        <aside
          className="rounded-2xl bg-card p-4 shadow-card md:sticky md:top-24 md:col-start-2 md:row-start-1 md:row-span-2 md:p-5 lg:p-6"
          aria-label="Vybraný termín"
        >
          <h2 className="sr-only md:not-sr-only md:mb-4 md:block md:text-lg md:font-extrabold">Tvůj termín</h2>

          {/* The same lime chip the card uses, so the time speaks one language everywhere. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="tnum inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-xl font-extrabold text-ink">
              <CalendarDays size={20} aria-hidden="true" />
              {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}
            </p>
            {minutesAway > 0 && minutesAway <= 120 ? (
              <span className="tnum text-base font-bold text-ink">Začíná {relativeTime(offer.start_at, now)}</span>
            ) : null}
            {/* Scarcity belongs next to the time it applies to, not on a row of its own
                three screens away from the button. */}
            {lastSeat ? (
              <span className="rounded-lg bg-warning-soft px-2 py-1 text-sm font-bold text-warning">
                Poslední místo
              </span>
            ) : null}
          </div>

          <dl className="mt-4 divide-y divide-line border-y border-line text-base">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-muted">Konec</dt>
              <dd className="tnum font-bold">{clockTime(offer.end_at)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="inline-flex items-center gap-2 text-muted">
                <Clock3 size={17} aria-hidden="true" />
                Délka služby
              </dt>
              <dd className="tnum font-bold">{duration(offer.start_at, offer.end_at)} min</dd>
            </div>
            {offer.bookable && cutoffMinutes > 0 && cutoffMinutes <= 60 ? (
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-muted">Rezervovat lze ještě</dt>
                <dd className="tnum font-bold">{cutoffMinutes} min</dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="tnum text-2xl font-extrabold tracking-tight">{money(offer.deal_price_cents)}</span>
            <s className="tnum text-base text-muted">{money(offer.original_price_cents)}</s>
            <span className="tnum rounded-lg bg-accent-soft px-2 py-0.5 text-sm font-extrabold text-accent">
              −{offer.discount_pct} %
            </span>
          </div>
          <p className="tnum mt-1 text-base font-bold text-ink">Ušetříš {money(savings)}</p>

          {!offer.bookable ? (
            <div className="mt-4">
              <Banner tone="warning">Tento termín už bohužel není volný.</Banner>
            </div>
          ) : null}

          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:mt-5 md:border-0 md:bg-transparent md:p-0">
            <Button size="lg" className="w-full" disabled={!offer.bookable} onClick={() => setSheetOpen(true)}>
              {offer.bookable ? `Rezervovat za ${money(offer.deal_price_cents)}` : 'Termín není volný'}
            </Button>
            {/* Both facts a person weighs with their thumb already on the button: what the
                payment is, and that it can be undone. The free-cancellation promise used to
                be the last muted paragraph of the page, which is nowhere near the decision. */}
            <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-2">
                <Banknote size={16} aria-hidden="true" />
                Zaplatíš rovnou
              </span>
              {offer.bookable ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1.5 font-bold text-positive">
                    <Check size={15} aria-hidden="true" />
                    Zrušení zdarma do {clockTime(cancellationDeadline(offer.start_at, offer.cancellation_window_minutes))}
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </aside>
        <div className="min-w-0 md:col-start-1">          <div className="mb-8 border-t border-line pt-6">
            <h2 className="text-lg font-extrabold">O službě</h2>
            <p className="mt-3 text-base leading-relaxed">{offer.description || `${offer.service_name} v podniku ${offer.business_name}. Délka služby ${duration(offer.start_at, offer.end_at)} minut.`}</p>
            {offer.business_description ? <p className="mt-3 text-base leading-relaxed">{offer.business_description}</p> : null}
          </div>
          <h2 className="text-lg font-extrabold">Kde to je</h2>
          <LazyMap className="mt-4 h-56 w-full overflow-hidden rounded-2xl border border-line" center={{ lat: offer.latitude, lng: offer.longitude }} zoom={14} interactive={false} markers={[{ id: offer.id, lat: offer.latitude, lng: offer.longitude, label: offer.business_name }]} ariaLabel={`Mapa: ${offer.business_name}, ${offer.address_line}`} />
          <a className="mt-2 inline-flex min-h-11 items-center gap-2 text-base font-bold text-accent" href={`https://www.openstreetmap.org/?mlat=${offer.latitude}&mlon=${offer.longitude}#map=17/${offer.latitude}/${offer.longitude}`} target="_blank" rel="noreferrer"><MapPin size={17} aria-hidden="true" />Navigovat</a>
          <h2 className="mt-6 text-lg font-extrabold">Zrušení</h2>
          <p className="mt-2 text-base leading-relaxed text-muted">Zrušit můžeš zdarma do {clockTime(cancellationDeadline(offer.start_at, offer.cancellation_window_minutes))} a vrátíme ti celou částku. Když rezervuješ později, máš na zrušení 10 minut od rezervace.</p>
        </div>
      </div>

      <BookingSheet
        offer={offer}
        now={now}
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          if (search.get('rezervovat')) { const params = new URLSearchParams(search); params.delete('rezervovat'); navigate(`/nabidka/${offer.id}${params.size ? `?${params}` : ''}`, { replace: true, scroll: false }); }
        }}
        onBooked={(reservationCode) => {
          setSheetOpen(false);
          setCode(reservationCode);
        }}
      />
    </main>
  );
}

function BookingSuccess({
  code,
  offer,
  now,
}: {
  code: string;
  offer: NonNullable<Awaited<ReturnType<typeof getOfferDetail>>>;
  now: string;
}) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10 text-center">
      <span className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-accent-soft text-accent"><Check size={28} aria-hidden="true" /></span><h1 className="text-xl font-extrabold">Máš svůj FLEK.</h1>
      <div className="mt-4">
        <Voucher code={code} />
      </div>
      <p className="tnum mt-3 text-base font-bold text-positive">Zaplaceno {money(offer.deal_price_cents)}</p>
      <p className="tnum mt-4 text-base font-bold text-ink">
        {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)} · {offer.business_name}
      </p>
      <p className="text-base text-muted">
        {offer.address_line}, {offer.city}
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <a
          className="btn-primary"
          href={`https://www.openstreetmap.org/?mlat=${offer.latitude}&mlon=${offer.longitude}#map=17/${offer.latitude}/${offer.longitude}`}
          target="_blank"
          rel="noreferrer"
        >
          Navigovat
        </a>
        <a
          className="inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-xl border border-line bg-card px-5 text-base font-bold text-ink"
          href={icsHref(bookingIcs({ code, serviceName: offer.service_name, businessName: offer.business_name, address: `${offer.address_line}, ${offer.city}`, startAt: offer.start_at, endAt: offer.end_at }))}
          download={`flek-${code}.ics`}
        >
          <CalendarPlus size={18} aria-hidden="true" />Přidat do kalendáře
        </a>
        <Link
          to="/rezervace"
          className="inline-flex min-h-13 w-full items-center justify-center rounded-xl border border-line bg-card px-5 text-base font-bold text-ink"
        >
          Zobrazit rezervaci
        </Link>
      </div>
    </main>
  );
}
