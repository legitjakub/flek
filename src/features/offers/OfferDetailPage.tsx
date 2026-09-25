import { ArrowLeft, CalendarDays, CalendarPlus, ChevronDown, Clock3, Info, MapPin, Check, ShieldCheck, Ban } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { activityPhotoSrcSet } from '../../lib/activityGalleries';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { businessOffers, confirmationQuote, getOfferDetail, setFavorite } from '../../lib/api';
import { track } from '../../lib/analytics';
import { relativeTime, useServerNow } from '../../lib/clock';
import { money, distance as formatDistance } from '../../lib/format';
import { DiscountBadge, OriginalPrice } from '../../components/Price';
import { clockTime, dayLabel, duration, untilLabel } from '../../lib/time';
import { DEFAULT_POINT, storedPoint } from '../../lib/geo';
import { Button, ErrorState, Skeleton, cx } from '../../components/ui';
import { bookingIcs, icsHref } from '../../lib/calendar';
import { Link, useRouter } from '../../app/router';
import { BookingSheet, cancellationDeadline } from '../bookings/BookingSheet';
import { PaymentReturn } from '../bookings/PaymentReturn';
import { Voucher } from '../bookings/Voucher';
import { FavoriteButton } from '../favorites/FavoriteButton';
import { useSession } from '../auth/session';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { navigationHref } from '../../lib/maps';
import { LazyMap } from './LazyMap';
import { ShareOfferButton } from './ShareOfferButton';
import { UnavailableOfferRecovery } from './UnavailableOfferRecovery';
import { unavailableCopy, unavailableReason } from './unavailable';
import { GooglePlaceRating } from '../ratings/GooglePlaceRating';
import { FlekRatingSummary } from '../ratings/FlekReviews';
import { IllustrativePhotoLabel } from '../../components/IllustrativePhotoLabel';
import { isIllustrativeServiceImage, SERVICE_PLACEHOLDER, serviceIllustration } from '../../lib/serviceIllustrations';
import { CapacityLabel } from '../../components/CapacityLabel';
import { TimePicker } from './TimePicker';
import { Recommendations } from './Recommendations';
import { WhatsAppPrompt } from '../notifications/WhatsApp';
import { ReportContent } from '../legal/ReportContent';

export function OfferDetailPage({ offerId }: { offerId: string }) {
  const { search, navigate } = useRouter();
  const origin = search.get('from') ?? '/';
  const returnTo = /^(\/|\/mapa)(\?.*)?$/.test(origin) ? origin : '/';
  const now = useServerNow(15_000);
  const point = storedPoint() ?? DEFAULT_POINT;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [confirmedByMerchant, setConfirmedByMerchant] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [desktopMap, setDesktopMap] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);
  const { userId } = useSession();
  const queryClient = useQueryClient();
  // The time the page opened with. Picking another one keeps this component, so the card can tell
  // a switch (which it animates) from arriving (which it does not).
  const openedWith = useRef(offerId);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => setDesktopMap(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const query = useQuery({
    queryKey: ['offer', offerId],
    queryFn: () => getOfferDetail(offerId, point),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const offer = query.data ?? null;
  // Whether this venue confirms bookings: the money is then only held until it does, and the grace period counts from its yes.
  const quote = useQuery({
    queryKey: ['confirmation-quote', offerId],
    queryFn: () => confirmationQuote(offerId),
    enabled: Boolean(offer?.bookable),
    staleTime: 60_000,
  });
  const manual = Boolean(quote.data?.manual);

  // Every free offer at this venue: the other times of this service for the picker, the venue's other
  // services for the recommendations. Same key as the venue page, so the cache is shared and the
  // inventory watcher keeps it fresh.
  const venueOffers = useQuery({
    queryKey: ['business-offers', offer?.business_id, point.lat, point.lng],
    queryFn: () => businessOffers(offer!.business_id, point),
    enabled: Boolean(offer?.business_id),
    staleTime: 30_000,
  });
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  /** Moves the page to another time of the same service, with its detail loaded first so nothing flashes. */
  async function pickTime(id: string) {
    setSwitchingTo(id);
    try {
      await queryClient.ensureQueryData({ queryKey: ['offer', id], queryFn: () => getOfferDetail(id, point) });
    } catch {
      // The page for that time shows its own error and a retry.
    }
    const params = new URLSearchParams(search);
    for (const key of ['platba', 'zruseno', 'rezervovat', 'sledovat']) params.delete(key);
    navigate(`/nabidka/${id}${params.size ? `?${params}` : ''}`, { replace: true, scroll: false });
    setSwitchingTo(null);
  }

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
        <Link to="/" className="mt-4 inline-flex min-h-11 items-center text-base font-bold underline underline-offset-4">
          Zpět na nabídky
        </Link>
      </main>
    );
  }

  const returningPayment = search.get('platba');
  if (returningPayment && !code) {
    return (
      <PaymentReturn
        paymentId={returningPayment}
        cancelled={search.get('zruseno') === '1'}
        onBooked={(reservationCode, merchantConfirmed) => {
          setCode(reservationCode);
          setConfirmedByMerchant(merchantConfirmed);
          navigate(`/nabidka/${offer.id}`, { replace: true, scroll: false });
        }}
        onRetry={() => {
          navigate(`/nabidka/${offer.id}`, { replace: true, scroll: false });
          setSheetOpen(true);
        }}
      />
    );
  }

  if (code) {
    return <BookingSuccess code={code} offer={offer} now={now} confirmedByMerchant={confirmedByMerchant} />;
  }

  const source = serviceIllustration(offer.service_name, offer.image_url, offer.category_slug);
  const image = source === failedPhoto ? SERVICE_PLACEHOLDER : source;
  const savings = offer.original_price_cents - offer.deal_price_cents;
  const minutesAway = Math.round((Date.parse(offer.start_at) - Date.parse(now)) / 60000);
  const showCapacity = offer.capacity_total > 1;
  const cutoffMinutes = Math.round((Date.parse(offer.booking_cutoff_at) - Date.parse(now)) / 60000);
  const cancellationAt = cancellationDeadline(offer.start_at, offer.cancellation_window_minutes);
  const graceCopy = manual ? '10 minut od potvrzení' : '10 minut od rezervace';
  const cancellationCopy = Date.parse(cancellationAt) <= Date.parse(now)
    ? graceCopy
    : untilLabel(cancellationAt, now);

  const hasPhoto = Boolean(image);
  const reason = unavailableReason(offer, now);
  const serviceDescription = offer.description?.trim();
  const usefulDescription = serviceDescription && !isGenericServiceDescription(serviceDescription, offer.service_name, offer.business_name)
    ? serviceDescription : null;

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
                srcSet={activityPhotoSrcSet(image!)}
                sizes="(min-width: 1024px) 800px, 100vw"
                onError={() => setFailedPhoto(source)}
                alt=""
                className="h-[180px] w-full object-cover md:h-auto md:aspect-[2/1] md:rounded-2xl"
              />
              {/* Only under the controls, and only as far as they reach: a scrim over the
                  whole image would dull the photograph for no reason. */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/35 to-transparent md:rounded-t-2xl" />
              <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-3">
                <Link
                  to={returnTo}
                  aria-label="Zpět na nabídky"
                  className="glass grid size-11 place-items-center rounded-full text-ink hover:bg-card"
                >
                  <ArrowLeft size={20} aria-hidden="true" />
                </Link>
                <FavoriteButton
                  variant="overlay"
                  businessId={offer.business_id}
                  businessName={offer.business_name}
                />
              </div>
              {isIllustrativeServiceImage(image) ? <IllustrativePhotoLabel className="right-3 bottom-3" /> : null}
              {/*
                The two facts that make this a FLEK — when it is and how much is off — said on the
                photograph, in the brand's colour, before the fold. They were both further down the
                page in grey: on a phone the first screen carried a photograph and a title and
                nothing that says this is a discounted last-minute slot at all.
              */}
              <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-2">
                <span className="glass tnum inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm leading-none font-extrabold text-ink">
                  <Clock3 size={14} aria-hidden="true" className="text-brand" />
                  {/* A slot within two hours says how long is left — that is the product. Further
                      out the hour means more than a countdown, and the card below repeats it. */}
                  {minutesAway > 0 && minutesAway <= 120
                    ? `Začíná ${relativeTime(offer.start_at, now)}`
                    : `${dayLabel(offer.start_at, now)} ${clockTime(offer.start_at)}`}
                </span>
                <DiscountBadge pct={offer.discount_pct} size="lg" className="shadow-card" />
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

          {/* The venue leads to the venue: its page lists every other free slot there. Every
              comparable booking app makes this the next tap, and FLEK had the page with nothing
              linking to it from here. */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold [overflow-wrap:anywhere]">
            <Link
              to={`/podnik/${offer.business_id}?from=${encodeURIComponent(`/nabidka/${offer.id}`)}`}
              className="inline-flex min-h-11 items-center underline decoration-line underline-offset-4 hover:text-accent hover:decoration-accent"
            >
              {offer.business_name}
            </Link>
            <GooglePlaceRating
              businessId={offer.business_id}
              placeId={offer.google_place_id}
              mapsUri
              withSeparator
            />
            {offer.rating_count > 0 ? <span aria-hidden="true">·</span> : null}
            <FlekRatingSummary
              businessId={offer.business_id}
              average={offer.rating_avg}
              count={offer.rating_count}
              href={`/podnik/${offer.business_id}?from=${encodeURIComponent(`/nabidka/${offer.id}`)}#hodnoceni-flek`}
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
          className="rounded-3xl border border-brand/10 bg-card p-3 md:sticky md:top-24 md:col-start-2 md:row-start-1 md:row-span-2 md:p-4"
          aria-label="Vybraný termín"
        >
          {/* The selected appointment is the only filled surface; alternatives stay quiet. A time
              that can no longer be booked loses the fill and the tick, and says so right here: on a
              computer the reason further down the page sat below the fold while this card, beside
              it, still read "Tvůj termín ✓". */}
          <div className={cx('rounded-2xl px-4 py-3.5', offer.bookable ? 'bg-brand text-brand-ink' : 'bg-surface text-ink')}>
            <div className={cx('mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-medium', !offer.bookable && 'text-muted')}>
              {offer.bookable ? (
                <h2 className="inline-flex items-center gap-1.5"><Check size={14} aria-hidden="true" />Tvůj termín</h2>
              ) : (
                <h2 className="inline-flex items-center gap-1.5 font-bold"><Ban size={14} aria-hidden="true" />Tenhle čas už nejde rezervovat</h2>
              )}
              <span className="tnum inline-flex items-center gap-1.5"><Clock3 size={13} aria-hidden="true" />{duration(offer.start_at, offer.end_at)} min</span>
            </div>
            {/* A new time slides in instead of snapping: the one thing that changes on a switch. */}
            <div key={offer.id} className={cx('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', offer.id !== openedWith.current && 'animate-[flek-swap_260ms_cubic-bezier(0.2,0.8,0.2,1)]')}>
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
                  <CalendarDays size={15} aria-hidden="true" />
                  {dayLabel(offer.start_at, now)}
                </p>
                <p className="tnum mt-1.5 text-xl leading-none font-extrabold tracking-tight">
                  {clockTime(offer.start_at)}–{clockTime(offer.end_at)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tnum text-xl leading-none font-extrabold tracking-tight">
                  {money(offer.deal_price_cents)}
                </p>
                {savings > 0 ? (
                  <p className="tnum mt-1.5 flex flex-wrap items-center justify-end gap-2 text-xs">
                    <s className="decoration-current">{money(offer.original_price_cents)}</s>
                    <span className="font-bold">−{offer.discount_pct} %</span>
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {!offer.bookable && reason ? (
            <p className="mt-2.5 text-sm font-bold text-ink">
              {unavailableCopy(reason).title}{' '}
              <a href="#recovery-title" className="inline-flex min-h-11 items-center font-bold text-accent underline underline-offset-4">
                Co teď?
              </a>
            </p>
          ) : null}
          {offer.bookable && ((minutesAway > 0 && minutesAway <= 120) || (cutoffMinutes > 0 && cutoffMinutes <= 60) || showCapacity) ? (
            <p className="tnum mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {minutesAway > 0 && minutesAway <= 120 ? <span className="font-bold text-accent">Začíná {relativeTime(offer.start_at, now)}</span> : null}
              {minutesAway > 0 && minutesAway <= 120 && offer.bookable && cutoffMinutes > 0 && cutoffMinutes <= 60 ? <span aria-hidden="true">·</span> : null}
              {offer.bookable && cutoffMinutes > 0 && cutoffMinutes <= 60 ? <span>Rezervovat ještě <strong className="text-ink">{cutoffMinutes} min</strong></span> : null}
              {showCapacity ? <CapacityLabel remaining={offer.capacity_remaining} total={offer.capacity_total} /> : null}
            </p>
          ) : null}

          {/*
            The list of other times comes after the price of the chosen one, not before it. With
            five time cards in between, the price and the saving of what you are actually booking
            started below the fold on a phone: the card opened on a list and buried its own answer.
          */}
          <TimePicker
            offer={offer}
            slots={(venueOffers.data ?? []).filter((row) => row.service_id === offer.service_id)}
            now={now}
            pendingId={switchingTo}
            onPick={(id) => void pickTime(id)}
            // Fetched while the finger is on its way, so the tap usually finds the page ready.
            onIntent={(id) => void queryClient.prefetchQuery({ queryKey: ['offer', id], queryFn: () => getOfferDetail(id, point), staleTime: 30_000 })}
          />

          {/* No sticky bar when there is nothing to book: a permanently disabled button is a
              dead end, and the recovery block below offers what is actually still possible. */}
          {offer.bookable ? (
          <div className="glass glass-lift fixed inset-x-0 bottom-0 z-40 rounded-t-3xl border-t border-white/70 px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:static md:mt-5 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-filter-none">
            {/*
              Price beside the action, not inside its label. "Chytit FLEK · 375 Kč" crammed a
              brand verb and a sum into one string joined by a floating dot, and neither half
              could breathe. Every booking app splits these: the amount is a fact you read,
              the button is a thing you press. On desktop the card above already carries the
              price, so only the button remains.
            */}
            <div className="mx-auto flex max-w-xl items-center gap-3 md:block md:max-w-none">
              {/* Keep the mobile action to one row; the selected summary explains the discount. */}
              <p key={offer.id} className={cx('tnum flex min-w-0 flex-wrap items-baseline gap-x-1.5 md:hidden', offer.id !== openedWith.current && 'animate-[flek-swap_260ms_cubic-bezier(0.2,0.8,0.2,1)]')}>
                <span className="text-lg leading-none font-extrabold">{money(offer.deal_price_cents)}</span>
                {savings > 0 ? <OriginalPrice cents={offer.original_price_cents} className="text-xs" /> : null}
              </p>
              <Button variant="brand" size="lg" className="min-w-0 flex-1 md:w-full" onClick={() => setSheetOpen(true)}>
                Chytit FLEK
              </Button>
            </div>
          </div>
          ) : null}
        </aside>
        <div className="min-w-0 md:col-start-1">
          <details className="group mt-4 rounded-2xl bg-card px-4 shadow-card">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-muted hover:text-accent">
              Proč je to levnější?
              <ChevronDown size={15} aria-hidden="true" className="transition-transform group-open:rotate-180" />
            </summary>
            <p className="border-t border-line py-3 text-sm leading-relaxed text-muted">
              Podniku zůstal volný termín, který by jinak propadl. Přes FLEK ho proto může nabídnout za
              výhodnější cenu. Dostaneš úplně stejnou službu jako za plnou cenu.
            </p>
          </details>
          {!offer.bookable && reason ? (
            <div className="mb-8">
              <UnavailableOfferRecovery offer={offer} reason={reason} now={now} point={point} />
            </div>
          ) : null}
          {/*
            Each block is a card with a coloured glyph instead of a bare heading over a hairline.
            On a phone the lower half of this page was six paragraphs and three 20 px headings on
            one flat ground: nothing told the eye where a subject ended, so everything was read at
            the same volume — or skipped. The glyph colours also carry the one thing the block is
            about: the venue (brand), the way there (brand) and the money back (green).
          */}
          {usefulDescription ? (
            <Section title="O službě" tone="accent" icon={<Info size={18} aria-hidden="true" />}>
              <p className="text-base leading-relaxed">{usefulDescription}</p>
            </Section>
          ) : null}
          <Section id="kde-to-je" title="Kde to je" tone="brand" icon={<MapPin size={18} aria-hidden="true" />}>
            <p className="text-sm leading-relaxed">
              {offer.address_line}, {offer.district || offer.city}
              {offer.distance_m != null ? <span className="tnum text-muted"> · {formatDistance(offer.distance_m)}</span> : null}
            </p>
            {!desktopMap && !mapOpen ? (
              <button type="button" onClick={() => setMapOpen(true)} className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-accent underline underline-offset-4">
                Zobrazit mapu
              </button>
            ) : null}
            {desktopMap || mapOpen ? <LazyMap className="mt-3 h-48 w-full overflow-hidden rounded-xl border border-line md:h-56" center={{ lat: offer.latitude, lng: offer.longitude }} zoom={14} interactive={false} markers={[{ id: offer.id, lat: offer.latitude, lng: offer.longitude, label: offer.business_name }]} ariaLabel={`Mapa: ${offer.business_name}, ${offer.address_line}`} /> : null}
            <div className="mt-1 flex flex-wrap gap-x-6">
              <a className="inline-flex min-h-11 items-center gap-2 text-base font-bold text-accent" href={navigationHref(offer)} target="_blank" rel="noreferrer"><MapPin size={17} aria-hidden="true" />Navigovat</a>
              <Link
                to={`/podnik/${offer.business_id}?from=${encodeURIComponent(`/nabidka/${offer.id}`)}`}
                className="inline-flex min-h-11 items-center text-base font-bold text-accent"
              >
                Další volné FLEKy v podniku
              </Link>
            </div>
          </Section>
          {/* Terms for a booking that can still be made. On a slot nobody can book any more
              they described a deadline that cannot be used — noise at best, misleading at worst. */}
          {offer.bookable ? (
            <Section title="Zrušení zdarma" tone="positive" icon={<ShieldCheck size={18} aria-hidden="true" />}>
              <p className="text-sm leading-relaxed">Zrušit můžeš zdarma {cancellationCopy} a vrátíme ti celou částku.{Date.parse(cancellationAt) > Date.parse(now) ? ` Když rezervuješ později, máš na zrušení ${graceCopy}.` : ''}</p>
            </Section>
          ) : null}
          {/* A slot that can no longer be booked already offers alternatives in the recovery block above. */}
          {offer.bookable || !reason ? (
            <Recommendations
              offer={offer}
              venueRows={venueOffers.data ?? []}
              point={storedPoint() ?? { lat: offer.latitude, lng: offer.longitude }}
              now={now}
            />
          ) : null}
          <div className="mt-6 border-t border-line pt-2">
            <ReportContent businessId={offer.business_id} offerId={offer.id} />
          </div>
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
      />
    </main>
  );
}

/** A block of the page below the booking card: a white card, a coloured glyph and a heading. */
function Section({
  id,
  title,
  icon,
  tone,
  children,
}: {
  id?: string;
  title: string;
  icon: ReactNode;
  tone: 'accent' | 'brand' | 'positive';
  children: ReactNode;
}) {
  return (
    <section id={id} className="mt-4 scroll-mt-24 border-t border-line pt-4 md:rounded-2xl md:border-0 md:bg-card md:p-5 md:shadow-card">
      <h2 className="flex items-center gap-2.5 text-lg font-extrabold">
        <span
          className={cx(
            'grid size-8 shrink-0 place-items-center rounded-lg',
            tone === 'accent' && 'bg-accent-soft text-accent',
            tone === 'brand' && 'bg-brand-soft text-brand',
            tone === 'positive' && 'bg-positive/10 text-positive',
          )}
        >
          {icon}
        </span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function isGenericServiceDescription(description: string, serviceName: string, businessName: string): boolean {
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs-CZ').replace(/\s+/g, ' ').trim();
  const text = normalize(description);
  return text === normalize(serviceName)
    || text === normalize(`${serviceName} v podniku ${businessName}.`)
    || [
      'ukazkova sluzba teto demo provozovny.',
      'doprej si chvili pro sebe. v cene je vse potrebne pro tuto sluzbu.',
      'pece a pozornost bez spechu.',
    ].includes(text)
    || /^sluzba trva \d+ minut\.?$/.test(text)
    || /^delka sluzby \d+ minut\.?$/.test(text);
}

function BookingSuccess({
  code,
  offer,
  now,
  confirmedByMerchant,
}: {
  code: string;
  offer: NonNullable<Awaited<ReturnType<typeof getOfferDetail>>>;
  now: string;
  confirmedByMerchant: boolean;
}) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10 text-center">
      <span className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-accent-soft text-accent"><Check size={28} aria-hidden="true" /></span>
      <h1 className="text-xl font-extrabold">{confirmedByMerchant ? '🔥 FLEK je tvůj!' : 'Máš svůj FLEK.'}</h1>
      {confirmedByMerchant ? <p className="mt-1 text-base text-muted">Podnik rezervaci potvrdil.</p> : null}
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
        <WhatsAppPrompt context="booked" />
      </div>

      <div className="mt-6">
        <InstallPrompt />
      </div>
    </main>
  );
}
