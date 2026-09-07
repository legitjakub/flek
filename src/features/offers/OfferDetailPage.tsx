import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getOfferDetail } from '../../lib/api';
import { track } from '../../lib/analytics';
import { relativeTime, useServerNow } from '../../lib/clock';
import { money, distance as formatDistance } from '../../lib/format';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { DEFAULT_POINT, storedPoint } from '../../lib/geo';
import { Banner, Button, ErrorState, Skeleton } from '../../components/ui';
import { Link, useRouter } from '../../app/router';
import { BookingSheet, cancellationDeadline } from '../bookings/BookingSheet';
import { LazyMap } from './LazyMap';

export function OfferDetailPage({ offerId }: { offerId: string }) {
  const { search, navigate } = useRouter();
  const now = useServerNow(15_000);
  const point = storedPoint() ?? DEFAULT_POINT;
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
      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        <Skeleton className="h-52 w-full" />
        <Skeleton className="mt-4 h-8 w-2/3" />
        <Skeleton className="mt-2 h-5 w-1/2" />
      </main>
    );
  }
  if (query.isError) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </main>
    );
  }
  if (!offer) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10 text-center">
        <p className="text-base font-semibold text-ink">Tento termín už bohužel není volný.</p>
        <Link to="/" className="mt-4 inline-block text-sm font-semibold underline underline-offset-4">
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

  return (
    <main className="mx-auto w-full max-w-2xl pb-36">
      <div className="relative aspect-[16/10] w-full bg-line/50">
        {image ? (
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,var(--color-line),var(--color-surface))]">
            <span className="text-sm font-bold tracking-wide text-muted">FLEK</span>
          </div>
        )}
        <Link
          to="/"
          aria-label="Zpět na nabídky"
          className="absolute top-3 left-3 grid size-10 place-items-center rounded-full bg-card/90 text-lg font-bold text-ink backdrop-blur"
        >
          <span aria-hidden="true">←</span>
        </Link>
        <span className="tnum absolute right-3 bottom-3 rounded-lg bg-ink/90 px-2 py-1 text-sm font-bold text-surface backdrop-blur">
          −{offer.discount_pct} %
        </span>
      </div>

      <div className="px-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {minutesAway > 0 && minutesAway <= 120 ? (
            <span className="tnum rounded-md bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">
              Začíná {relativeTime(offer.start_at, now)}
            </span>
          ) : null}
          {lastSeat ? (
            <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-bold text-ink">Poslední místo</span>
          ) : null}
        </div>

        <h1 className="mt-2 text-2xl leading-tight font-extrabold tracking-tight text-ink">{offer.service_name}</h1>
        <p className="mt-1 text-sm text-muted">
          {offer.business_name}
          {offer.district ? ` · ${offer.district}` : ''}
          {offer.distance_m != null ? ` · ${formatDistance(offer.distance_m)}` : ''}
        </p>

        {!offer.bookable ? (
          <div className="mt-4">
            <Banner tone="warning">Tento termín už bohužel není volný.</Banner>
          </div>
        ) : null}

        <dl className="mt-5 divide-y divide-line rounded-2xl border border-line bg-card px-4">
          <Fact
            label="Kdy"
            value={`${dayLabel(offer.start_at, now)} ${clockTime(offer.start_at)}–${clockTime(offer.end_at)}`}
            note={`${duration(offer.start_at, offer.end_at)} min`}
          />
          <Fact label="Kde" value={offer.address_line} note={offer.city} />
          <Fact label="Cena na místě" value={money(offer.deal_price_cents)} note={`běžně ${money(offer.original_price_cents)}`} />
          <Fact label="Ušetříš" value={money(savings)} highlight />
        </dl>

        {offer.description ? <p className="mt-5 text-sm leading-relaxed text-ink">{offer.description}</p> : null}
        {offer.business_description ? (
          <p className="mt-3 text-sm leading-relaxed text-muted">{offer.business_description}</p>
        ) : null}

        <h2 className="mt-7 text-base font-bold text-ink">Kde to je</h2>
        <LazyMap
          className="mt-3 h-48 w-full overflow-hidden rounded-2xl border border-line"
          center={{ lat: offer.latitude, lng: offer.longitude }}
          zoom={14}
          interactive={false}
          markers={[{ id: offer.id, lat: offer.latitude, lng: offer.longitude, label: '1' }]}
          ariaLabel={`Mapa: ${offer.business_name}, ${offer.address_line}`}
        />
        <a
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4"
          href={`https://www.openstreetmap.org/?mlat=${offer.latitude}&mlon=${offer.longitude}#map=17/${offer.latitude}/${offer.longitude}`}
          target="_blank"
          rel="noreferrer"
        >
          Navigovat
        </a>

        <h2 className="mt-7 text-base font-bold text-ink">Zrušení</h2>
        <p className="mt-1 text-sm text-muted">
          Zrušit můžeš zdarma do {clockTime(cancellationDeadline(offer.start_at))}. Když rezervuješ později, máš na
          zrušení 10 minut od rezervace.
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-col gap-1">
          <Button size="lg" className="w-full" disabled={!offer.bookable} onClick={() => setSheetOpen(true)}>
            {offer.bookable ? `Rezervovat za ${money(offer.deal_price_cents)}` : 'Termín není volný'}
          </Button>
          <p className="text-center text-xs font-semibold text-muted">Platba na místě</p>
        </div>
      </div>

      <BookingSheet
        offer={offer}
        now={now}
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          if (search.get('rezervovat')) navigate(`/nabidka/${offer.id}`, { replace: true });
        }}
        onBooked={(reservationCode) => {
          setSheetOpen(false);
          setCode(reservationCode);
        }}
      />
    </main>
  );
}

function Fact({
  label,
  value,
  note,
  highlight,
}: {
  label: string;
  value: string;
  note?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className="text-right">
        <span className={`tnum font-bold ${highlight ? 'text-positive' : 'text-ink'}`}>{value}</span>
        {note ? <span className="tnum block text-xs text-muted">{note}</span> : null}
      </dd>
    </div>
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
      <p className="text-sm font-semibold text-positive">Rezervace potvrzena</p>
      <p className="tnum mt-4 rounded-2xl border border-line bg-card px-4 py-6 font-mono text-2xl font-extrabold tracking-[0.12em] text-ink">
        {code}
      </p>
      <p className="mt-3 text-sm text-muted">Kód ukaž na místě. Platíš až v podniku.</p>
      <p className="tnum mt-4 text-base font-semibold text-ink">
        {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)} · {offer.business_name}
      </p>
      <p className="text-sm text-muted">
        {offer.address_line}, {offer.city}
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <a
          className="inline-flex min-h-13 w-full items-center justify-center rounded-xl bg-accent px-5 text-base font-semibold text-accent-ink"
          href={`https://www.openstreetmap.org/?mlat=${offer.latitude}&mlon=${offer.longitude}#map=17/${offer.latitude}/${offer.longitude}`}
          target="_blank"
          rel="noreferrer"
        >
          Navigovat
        </a>
        <Link
          to="/rezervace"
          className="inline-flex min-h-13 w-full items-center justify-center rounded-xl border border-line bg-card px-5 text-base font-semibold text-ink"
        >
          Zobrazit rezervaci
        </Link>
      </div>
    </main>
  );
}
