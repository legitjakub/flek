import { ArrowLeft, CalendarDays, CalendarPlus, ChevronDown, Clock3, Info, MapPin, Banknote, Check, PiggyBank, ShieldCheck } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { activityPhotoSrcSet } from '../../lib/activityGalleries';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { businessOffers, confirmationQuote, getOfferDetail, setFavorite } from '../../lib/api';
import { track } from '../../lib/analytics';
import { relativeTime, useServerNow } from '../../lib/clock';
import { money, distance as formatDistance } from '../../lib/format';
import { DiscountBadge, OriginalPrice } from '../../components/Price';
import { clockTime, dayLabel, duration } from '../../lib/time';
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
import { unavailableReason } from './unavailable';
import { GooglePlaceRating } from '../ratings/GooglePlaceRating';
import { FlekRatingSummary } from '../ratings/FlekReviews';
import { IllustrativePhotoLabel } from '../../components/IllustrativePhotoLabel';
import { isIllustrativeServiceImage, SERVICE_PLACEHOLDER, serviceIllustration } from '../../lib/serviceIllustrations';
import { capacityLabel } from '../../components/CapacityLabel';
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
  const { userId } = useSession();
  const queryClient = useQueryClient();

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
        <Link to="/" className="mt-4 inline-block text-base font-bold underline underline-offset-4">
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
  /*
   * The plain sentence, not the chip: on the brand-tinted block of this card the chip's pale
   * accent fill all but disappears, and a lone capacity chip can be the only thing left in the
   * urgency row — an empty tinted row when nothing else applies. Same text helper, one voice.
   */
  const capacity = offer.capacity_total > 1 ? capacityLabel(offer.capacity_remaining, offer.capacity_total) : null;
  const cutoffMinutes = Math.round((Date.parse(offer.booking_cutoff_at) - Date.parse(now)) / 60000);
  const cancellationAt = cancellationDeadline(offer.start_at, offer.cancellation_window_minutes);
  const graceCopy = manual ? '10 minut od potvrzení' : '10 minut od rezervace';
  const cancellationCopy = Date.parse(cancellationAt) <= Date.parse(now)
    ? graceCopy
    : `do ${clockTime(cancellationAt)}`;

  /*
   * What makes this time pressing, in the order a person weighs it, with the separators derived
   * rather than written between every pair. Three optional facts joined by hand meant two nested
   * conditions for one dot, and a row that could render with nothing in it.
   */
  const urgency: Array<{ key: string; node: ReactNode }> = [];
  if (minutesAway > 0 && minutesAway <= 120) {
    urgency.push({ key: 'soon', node: <span className="font-bold text-accent">Začíná {relativeTime(offer.start_at, now)}</span> });
  }
  if (offer.bookable && cutoffMinutes > 0 && cutoffMinutes <= 60) {
    urgency.push({ key: 'cutoff', node: <span>Rezervovat ještě <strong className="text-ink">{cutoffMinutes} min</strong></span> });
  }
  if (capacity) urgency.push({ key: 'capacity', node: <span className="font-bold text-ink">{capacity}</span> });

  const hasPhoto = Boolean(image);
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
                srcSet={activityPhotoSrcSet(image!)}
                sizes="(min-width: 1024px) 800px, 100vw"
                onError={() => setFailedPhoto(source)}
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
              className="inline-flex min-h-8 items-center underline decoration-line underline-offset-4 hover:text-accent hover:decoration-accent"
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
          className="rounded-2xl bg-card p-4 shadow-card md:sticky md:top-24 md:col-start-2 md:row-start-1 md:row-span-2 md:p-5"
          aria-label="Vybraný termín"
        >
          <h2 className="sr-only md:not-sr-only md:mb-3 md:block md:text-base md:font-extrabold">Tvůj termín</h2>

          {/*
            One block, not four bands. Day, hours, length, price, saving and what is left were
            separated by three hairlines, which turned the card into a receipt: every fact looked
            like a separate row of a form instead of one appointment. They belong together, on a
            surface of their own in the brand's own colour — and the surface is what tells the
            list below that it is a list of alternatives to this.

            The duration sits at the far end of its row rather than under the time. Every line in
            this card used to start at the same left edge and stop well short of the right one —
            six stacked rows in the left third of a full-width box.

            The day carries the brand fill and the hours are the biggest thing in the row. Both
            used to be one grey-black sentence beside a pale icon tile — the single most important
            line of the page ("is this today?") read like a caption.
          */}
          <div className="rounded-2xl bg-brand-soft p-3.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand px-2.5 py-1 text-xs leading-none font-extrabold text-brand-ink">
                <CalendarDays size={13} aria-hidden="true" />
                {dayLabel(offer.start_at, now)}
              </span>
              <p className="tnum text-lg leading-none font-extrabold text-ink">
                {clockTime(offer.start_at)}–{clockTime(offer.end_at)}
              </p>
              <span className="tnum ml-auto inline-flex shrink-0 items-center gap-1.5 text-sm text-muted">
                <Clock3 size={14} aria-hidden="true" />
                {duration(offer.start_at, offer.end_at)} min
              </span>
            </div>
            {/*
              One row, two ends. The two numbers a person compares stay together on the left and
              the percentage goes to the right edge, so the row spans the card instead of bunching
              in its left third.

              The scale in styles.css assigns xl/800 to prices and times and 2xl/800 to the page
              heading: at 2xl the price was the largest thing on the screen, louder than the title
              of the thing being bought.
            */}
            <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="tnum text-xl leading-none font-extrabold tracking-tight">
                {money(offer.deal_price_cents)}
              </span>
              {savings > 0 ? <OriginalPrice cents={offer.original_price_cents} className="text-sm" /> : null}
              {savings > 0 ? <DiscountBadge pct={offer.discount_pct} className="ml-auto" /> : null}
            </div>
            {/* What the customer keeps, in crowns and in the money green — the product's whole
                argument. It was a 12 px line inside the fixed bar on a phone and nowhere at all
                on a desktop, where this card is the only place the price is shown. The green no
                longer sits in a tinted pill: a second fill on a tinted surface went muddy. */}
            {savings > 0 ? (
              <p className="tnum mt-2 inline-flex items-center gap-1.5 text-sm font-extrabold text-positive">
                <PiggyBank size={15} aria-hidden="true" />
                Ušetříš {money(savings)}
              </p>
            ) : null}

            {urgency.length ? (
              <p className="tnum mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                {urgency.map((fact, index) => (
                  <Fragment key={fact.key}>
                    {index > 0 ? <span aria-hidden="true">·</span> : null}
                    {fact.node}
                  </Fragment>
                ))}
              </p>
            ) : null}
          </div>

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
          />

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
              {/* One line, not three. The saving now sits in the card above as a green pill, so
                  repeating it here only made the bar 20 px taller on the screen with the least
                  room to spare — and put the same three numbers twice in one viewport. */}
              <p className="tnum flex min-w-0 flex-wrap items-baseline gap-x-1.5 md:hidden">
                <span className="text-lg leading-none font-extrabold">{money(offer.deal_price_cents)}</span>
                {savings > 0 ? <OriginalPrice cents={offer.original_price_cents} className="text-xs" /> : null}
              </p>
              <Button size="lg" className="flex-1" onClick={() => setSheetOpen(true)}>
                Chytit FLEK
              </Button>
            </div>
            {/* Both facts a person weighs with their thumb already on the button: what the
                payment is, and that it can be undone. The free-cancellation promise used to
                be the last muted paragraph of the page, which is nowhere near the decision. */}
            {/* No dot between the two: whether they wrap depends on the column width, not the
                breakpoint (the narrow desktop card wraps too), and a dot left hanging at the end
                of a line reads as a typo. Each fact already opens with its own icon. */}
            <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-2">
                <Banknote size={16} aria-hidden="true" />
                {manual ? 'Platíš, až podnik potvrdí' : 'Zaplatíš rovnou'}
              </span>
              {offer.bookable ? (
                <span className="inline-flex items-center gap-1.5 font-bold text-positive">
                  <Check size={15} aria-hidden="true" />
                  Zrušení zdarma {cancellationCopy}
                </span>
              ) : null}
            </p>
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
          <Section title="O službě" tone="accent" icon={<Info size={18} aria-hidden="true" />}>
            <p className="text-base leading-relaxed">{offer.description || `${offer.service_name} v podniku ${offer.business_name}. Délka služby ${duration(offer.start_at, offer.end_at)} minut.`}</p>
            {offer.business_description ? <p className="mt-3 text-base leading-relaxed">{offer.business_description}</p> : null}
          </Section>
          <Section id="kde-to-je" title="Kde to je" tone="brand" icon={<MapPin size={18} aria-hidden="true" />}>
            <p className="text-base leading-relaxed">
              {offer.address_line}, {offer.district || offer.city}
              {offer.distance_m != null ? <span className="tnum text-muted"> · {formatDistance(offer.distance_m)}</span> : null}
            </p>
            <LazyMap className="mt-3 h-56 w-full overflow-hidden rounded-2xl border border-line" center={{ lat: offer.latitude, lng: offer.longitude }} zoom={14} interactive={false} markers={[{ id: offer.id, lat: offer.latitude, lng: offer.longitude, label: offer.business_name }]} ariaLabel={`Mapa: ${offer.business_name}, ${offer.address_line}`} />
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
              <p className="text-base leading-relaxed">Zrušit můžeš zdarma {cancellationCopy} a vrátíme ti celou částku.{Date.parse(cancellationAt) > Date.parse(now) ? ` Když rezervuješ později, máš na zrušení ${graceCopy}.` : ''}</p>
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
    <section id={id} className="mt-4 scroll-mt-24 rounded-2xl bg-card p-4 shadow-card sm:p-5">
      <h2 className="flex items-center gap-2.5 text-lg font-extrabold">
        <span
          className={cx(
            'grid size-9 shrink-0 place-items-center rounded-xl',
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
