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

  return (
    <main className="page-container pb-32 md:pb-10">
      <Link to={returnTo} className="my-4 inline-flex min-h-11 items-center gap-2 text-base font-bold text-muted hover:text-accent"><ArrowLeft size={18} aria-hidden="true" />Zpět na nabídky</Link>
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_320px] lg:gap-12 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {image && image !== failedPhoto ? <img src={image} onError={() => setFailedPhoto(image)} alt="" className="mb-6 aspect-[2/1] w-full rounded-2xl object-cover" /> : null}
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

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <FavoriteButton businessId={offer.business_id} businessName={offer.business_name} />
            {lastSeat ? (
              <span className="rounded-xl border border-line bg-card px-3 py-2 text-base font-bold">
                Poslední místo
              </span>
            ) : null}
          </div>
        </div>
        <aside className="rounded-2xl bg-card p-5 shadow-card md:sticky md:top-24 md:col-start-2 md:row-start-1 md:row-span-2 lg:p-6" aria-label="Vybraný termín">
          <h2 className="text-lg font-extrabold">Tvůj termín</h2>
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-accent-soft p-4 text-accent">
            <CalendarDays size={22} aria-hidden="true" className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="tnum text-xl leading-tight font-extrabold">
                {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)}
              </p>
              <p className="tnum mt-1 text-base">Do {clockTime(offer.end_at)}</p>
              {minutesAway > 0 && minutesAway <= 120 ? (
                <p className="tnum mt-2 text-base font-bold">Začíná {relativeTime(offer.start_at, now)}</p>
              ) : null}
            </div>
          </div>
          <p className="mt-4 flex items-center justify-between gap-3 text-base">
            <span className="inline-flex items-center gap-2 text-muted">
              <Clock3 size={17} aria-hidden="true" />
              Délka služby
            </span>
            <span className="tnum font-bold">{duration(offer.start_at, offer.end_at)} min</span>
          </p>
          {offer.bookable && cutoffMinutes > 0 && cutoffMinutes <= 60 ? (
            <p className="tnum mt-2 text-base text-muted">Rezervovat lze ještě {cutoffMinutes} min</p>
          ) : null}
          <div className="mt-5 flex flex-wrap items-baseline gap-2 border-t border-line pt-5"><span className="tnum text-2xl font-extrabold tracking-tight">{money(offer.deal_price_cents)}</span><s className="tnum text-base text-muted">{money(offer.original_price_cents)}</s></div>
          <p className="tnum mt-2 text-base font-bold text-ink">
            Ušetříš {money(savings)} · −{offer.discount_pct} %
          </p>
          {!offer.bookable ? <div className="mt-4"><Banner tone="warning">Tento termín už bohužel není volný.</Banner></div> : null}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:mt-5 md:border-0 md:p-0">
            <Button size="lg" className="w-full" disabled={!offer.bookable} onClick={() => setSheetOpen(true)}>{offer.bookable ? `Rezervovat za ${money(offer.deal_price_cents)}` : 'Termín není volný'}</Button>
            <p className="mt-2 flex items-center justify-center gap-2 text-base text-muted"><Banknote size={16} aria-hidden="true" />Zaplatíš rovnou, v podniku jen ukážeš kód</p>
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
