import { ArrowLeft, CalendarDays, CalendarPlus, ChevronDown, Clock3, MapPin, Banknote, Check } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getOfferDetail, setFavorite } from '../../lib/api';
import { track } from '../../lib/analytics';
import { relativeTime, useServerNow } from '../../lib/clock';
import { money, distance as formatDistance } from '../../lib/format';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { DEFAULT_POINT, storedPoint } from '../../lib/geo';
import { Button, ErrorState, Skeleton, cx } from '../../components/ui';
import { bookingIcs, icsHref } from '../../lib/calendar';
import { Link, useRouter } from '../../app/router';
import { BookingSheet, cancellationDeadline } from '../bookings/BookingSheet';
import { Voucher } from '../bookings/Voucher';
import { FavoriteButton } from '../favorites/FavoriteButton';
import { useSession } from '../auth/session';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { navigationHref } from '../../lib/maps';
import { LazyMap } from './LazyMap';
import { ShareOfferButton } from './ShareOfferButton';
import { UnavailableOfferRecovery } from './UnavailableOfferRecovery';
import { unavailableReason } from './unavailable';
import { GooglePlaceRating } from '../ratings/GooglePlaceRating';

export function OfferDetailPage({ offerId }: { offerId: string }) {
  const { search, navigate } = useRouter();
  const origin = search.get('from') ?? '/';
  const returnTo = /^(\/|\/mapa)(\?.*)?$/.test(origin) ? origin : '/';
  const now = useServerNow(15_000);
  const point = storedPoint() ?? DEFAULT_POINT;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [followed, setFollowed] = useState(false);
  const { userId } = useSession();
  const queryClient = useQueryClient();

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

  /*
   * The same principle for following. set_favorite states the value rather than flipping it,
   * so this replay cannot unfollow a venue the person had already followed — which is exactly
   * what a toggle would have done here. The parameter is stripped afterwards so a refresh or
   * a shared URL does not silently follow anything.
   */
  useEffect(() => {
    if (search.get('sledovat') !== '1' || !userId || !offer) return;
    let cancelled = false;
    void setFavorite(offer.business_id, true)
      .then(async () => {
        if (cancelled) return;
        setFollowed(true);
        await queryClient.invalidateQueries({ queryKey: ['favorites'] });
      })
      .catch(() => undefined)
      .finally(() => {
        const next = new URLSearchParams(search);
        next.delete('sledovat');
        navigate(`${window.location.pathname}${next.size ? `?${next}` : ''}`, { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [search, userId, offer?.business_id]);

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
  const reason = unavailableReason(offer, now);

  return (
    <main className={cx('page-container md:pb-10', offer.bookable ? 'pb-32' : 'pb-10')}>
      {/* Above a photo the back arrow rides on the image itself, the way every booking app
          does it: a text link there costs a whole row of height and pushes the price down.
          Without a photo there is nothing to ride on, so the link comes back. */}
      {hasPhoto ? null : (
        <Link to={returnTo} className="my-4 inline-flex min-h-11 items-center gap-2 text-base font-bold text-muted hover:text-accent"><ArrowLeft size={18} aria-hidden="true" />Zpět na nabídky</Link>
      )}
      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_320px] md:gap-6 lg:gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {hasPhoto ? (
            /* Full-bleed on a phone. Inset behind the page gutter it read as one more card
               on a page already made of cards; edge to edge it reads as the subject. */
            <div className="relative -mx-4 mb-3 md:mx-0 md:mb-4">
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
          {/*
            Three lines, each with one job: what it is, who does it and how well, where it is
            and how far. It used to be four, and they climbed 32 → 20 → 16 → 16 px with two
            extra-bold blocks stacked on top of each other — the jump read as shouting. The
            district also duplicated the address, which already contains it.
          */}
          <div className="flex items-center justify-between gap-3">
            <h1 className="min-w-0 text-xl leading-tight font-extrabold tracking-tight md:text-2xl [overflow-wrap:anywhere]">
              {offer.service_name}
            </h1>
            <ShareOfferButton offer={offer} now={now} compact />
          </div>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold [overflow-wrap:anywhere]">
            {offer.business_name}
            <GooglePlaceRating
              businessId={offer.business_id}
              placeId={offer.google_place_id}
              mapsUri
              withSeparator
            />
          </p>

          {/* The address is a link to the map already on this page, the way a booking app
              treats it — an address you cannot act on is just a string to read past. */}
          <a
            href="#kde-to-je"
            className="inline-flex min-h-11 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted hover:text-accent"
          >
            <MapPin size={15} aria-hidden="true" className="shrink-0" />
            <span>
              {offer.address_line}
              {offer.district ? `, ${offer.district}` : `, ${offer.city}`}
            </span>
            {offer.distance_m != null ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="tnum">{formatDistance(offer.distance_m)}</span>
              </>
            ) : null}
          </a>

          {/* Without a photograph, following needs a control below the venue details. */}
          {hasPhoto ? null : (
            <div className="mt-1">
              <FavoriteButton businessId={offer.business_id} businessName={offer.business_name} />
            </div>
          )}
          {followed ? (
            <p role="status" className="mt-3 text-base font-bold text-positive">
              Hotovo. {offer.business_name} teď sleduješ — nové FLEKy uvidíš v Oblíbených.
            </p>
          ) : null}
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
          className="rounded-2xl bg-card p-4 shadow-card md:sticky md:top-24 md:col-start-2 md:row-start-1 md:row-span-2 md:p-5"
          aria-label="Vybraný termín"
        >
          <h2 className="sr-only md:not-sr-only md:mb-3 md:block md:text-base md:font-extrabold">Tvůj termín</h2>

          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <CalendarDays size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="tnum text-base leading-5 font-bold">
                {dayLabel(offer.start_at, now)} · {clockTime(offer.start_at)}–{clockTime(offer.end_at)}
              </p>
              <p className="tnum mt-1 flex items-center gap-1.5 text-sm leading-5 text-muted">
                <Clock3 size={14} aria-hidden="true" />
                {duration(offer.start_at, offer.end_at)} min
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 empty:hidden">
            {minutesAway > 0 && minutesAway <= 120 ? (
              <span className="tnum mt-2 text-sm font-bold text-accent">Začíná {relativeTime(offer.start_at, now)}</span>
            ) : null}
            {/* Scarcity belongs next to the time it applies to, not on a row of its own
                three screens away from the button. */}
            {lastSeat ? (
              <span className="mt-2 rounded-lg bg-warning-soft px-2 py-1 text-sm font-bold text-warning">
                Poslední místo
              </span>
            ) : null}
          </div>

          {offer.bookable && cutoffMinutes > 0 && cutoffMinutes <= 60 ? (
            <p className="tnum mt-2 text-sm text-muted">Rezervovat lze ještě <span className="font-bold text-ink">{cutoffMinutes} min</span></p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-line pt-3">
            {/* The scale in styles.css assigns xl/800 to prices and times and 2xl/800 to the
                page heading. At 2xl the price was the largest thing on the screen, louder
                than the title of the thing being bought. */}
            <span className="tnum text-xl font-extrabold tracking-tight">{money(offer.deal_price_cents)}</span>
            <s className="tnum text-sm text-muted">{money(offer.original_price_cents)}</s>
            <span className="tnum rounded-lg bg-accent-soft px-2 py-0.5 text-sm font-extrabold text-accent">
              −{offer.discount_pct} %
            </span>
          </div>
          <p className="tnum mt-0.5 text-sm text-muted">Ušetříš <span className="font-bold text-positive">{money(savings)}</span></p>

          {/* An unusually low price invites suspicion, and suspicion is what stops a first
              booking. Progressive disclosure: one line, opened only by someone who wondered. */}
          <details className="group mt-1">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-muted hover:text-accent">
              Proč je to levnější?
              <ChevronDown size={15} aria-hidden="true" className="transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Podniku zůstal volný termín, který by jinak propadl. Přes FLEK ho proto může nabídnout za
              výhodnější cenu. Dostaneš úplně stejnou službu jako za plnou cenu.
            </p>
          </details>

          {/* No sticky bar when there is nothing to book: a permanently disabled button is a
              dead end, and the recovery block below offers what is actually still possible. */}
          {offer.bookable ? (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:mt-5 md:border-0 md:bg-transparent md:p-0">
            {/*
              Price beside the action, not inside its label. "Chytit FLEK · 375 Kč" crammed a
              brand verb and a sum into one string joined by a floating dot, and neither half
              could breathe. Every booking app splits these: the amount is a fact you read,
              the button is a thing you press. On desktop the card above already carries the
              price, so only the button remains.
            */}
            <div className="flex items-center gap-4">
              <div className="min-w-0 md:hidden">
                <p className="tnum text-lg leading-none font-extrabold">{money(offer.deal_price_cents)}</p>
                <p className="tnum mt-1 text-xs text-muted">
                  místo <s>{money(offer.original_price_cents)}</s>
                </p>
              </div>
              <Button size="lg" className="flex-1" onClick={() => setSheetOpen(true)}>
                Chytit FLEK
              </Button>
            </div>
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
          ) : null}
        </aside>
        <div className="min-w-0 md:col-start-1">
          {!offer.bookable && reason ? (
            <div className="mb-8">
              <UnavailableOfferRecovery offer={offer} reason={reason} now={now} point={point} />
            </div>
          ) : null}
          <div className="mb-8 border-t border-line pt-6">
            <h2 className="text-lg font-extrabold">O službě</h2>
            <p className="mt-3 text-base leading-relaxed">{offer.description || `${offer.service_name} v podniku ${offer.business_name}. Délka služby ${duration(offer.start_at, offer.end_at)} minut.`}</p>
            {offer.business_description ? <p className="mt-3 text-base leading-relaxed">{offer.business_description}</p> : null}
          </div>
          <h2 id="kde-to-je" className="scroll-mt-24 text-lg font-extrabold">Kde to je</h2>
          <LazyMap className="mt-4 h-56 w-full overflow-hidden rounded-2xl border border-line" center={{ lat: offer.latitude, lng: offer.longitude }} zoom={14} interactive={false} markers={[{ id: offer.id, lat: offer.latitude, lng: offer.longitude, label: offer.business_name }]} ariaLabel={`Mapa: ${offer.business_name}, ${offer.address_line}`} />
          <a className="mt-2 inline-flex min-h-11 items-center gap-2 text-base font-bold text-accent" href={navigationHref(offer)} target="_blank" rel="noreferrer"><MapPin size={17} aria-hidden="true" />Navigovat</a>
          {/* Terms for a booking that can still be made. On a slot nobody can book any more
              they described a deadline that cannot be used — noise at best, misleading at worst. */}
          {offer.bookable ? (
            <>
              <h2 className="mt-6 text-lg font-extrabold">Zrušení</h2>
              <p className="mt-2 text-base leading-relaxed text-muted">Zrušit můžeš zdarma do {clockTime(cancellationDeadline(offer.start_at, offer.cancellation_window_minutes))} a vrátíme ti celou částku. Když rezervuješ později, máš na zrušení 10 minut od rezervace.</p>
            </>
          ) : null}
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
      {/* The number that makes the product worth coming back to, said once, plainly, at the
          moment it is true. Computed from this booking, not from a running total. */}
      {offer.original_price_cents > offer.deal_price_cents ? (
        <p className="tnum mt-1 text-base font-bold text-ink">
          Ušetřil jsi {money(offer.original_price_cents - offer.deal_price_cents)}
        </p>
      ) : null}
      <p className="tnum mt-4 text-base font-bold text-ink">
        {dayLabel(offer.start_at, now)} {clockTime(offer.start_at)} · {offer.business_name}
      </p>
      <p className="text-base text-muted">
        {offer.address_line}, {offer.city}
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <a
          className="btn-primary"
          href={navigationHref(offer)}
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

      {/* One retention ask, after the booking is safely done rather than during it. The offer
          itself is usually gone now — the seat was just taken — so the ask is about the venue,
          not about re-sharing a slot nobody else can have. */}
      <div className="mt-8 border-t border-line pt-6">
        <p className="text-base font-bold text-ink">Chceš vědět, až sem přibude další FLEK?</p>
        <div className="mt-3">
          <FavoriteButton variant="cta" businessId={offer.business_id} businessName={offer.business_name} />
        </div>
        <p className="mt-2 text-sm text-muted">Nové FLEKy uvidíš v Oblíbených.</p>
      </div>

      <div className="mt-6">
        <InstallPrompt />
      </div>
    </main>
  );
}
