import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellOff, Check, Clock3, Info, ShieldCheck, Volume2, X } from 'lucide-react';
import { respondToBooking } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { cx } from '../../components/ui';
import type { BookingStatus } from '../../types/database';
import { timeLeft } from '../bookings/confirmationView';
import { isMuted, muteRequests, unlockSound, unmuteRequests } from './ringer';
import {
  decisionOutcome,
  endedOutcome,
  hideRequests,
  moreShort,
  moreWaiting,
  onScreen,
  startsIn,
  subscribeTakeover,
  takeoverVersion,
  timeShare,
  type Outcome,
} from './incomingRequest';
import type { WaitingRequest, useRequestRing } from './RequestRing';

/** Taps in the first moment after the screen appears were meant for whatever was under the finger. */
const ARM_MS = 700;
/** How long a decision made here stays on screen before the next request or the console returns. */
const AUTO_CLOSE_MS = 4_000;

type Ring = ReturnType<typeof useRequestRing>;

/**
 * A new booking request takes the whole screen, the way delivery tablets on a counter do: it rings
 * (RequestRing) and pulses in time with the ring until someone confirms it, declines it, puts it
 * off, or it runs out. A native modal <dialog> sits above every sheet and keeps the rest inert.
 *
 * Decisions go through the same `respond_to_booking` as the request cards; this is one more
 * surface, not one more channel.
 */
export function IncomingRequest({
  waiting,
  statusOf,
  ring,
  venue,
}: {
  waiting: WaitingRequest[];
  statusOf: (id: string) => BookingStatus | undefined;
  ring: Ring;
  venue: string;
}) {
  useSyncExternalStore(subscribeTakeover, takeoverVersion, () => 0);
  const now = useServerNow(1_000);
  const queryClient = useQueryClient();
  // Requests this screen already finished with, so a list that has not caught up yet cannot bring one back.
  const done = useRef(new Set<string>());
  const queue = onScreen(waiting, done.current);
  const [shown, setShown] = useState<WaitingRequest | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [declining, setDeclining] = useState(false);
  const [armed, setArmed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const deciding = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Only when the page has to scroll do the buttons stick to the bottom over a smoky tray.
  const [overflowing, setOverflowing] = useState(false);

  const decision = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => respondToBooking(id, accept),
    onSuccess: (result, { id, accept }) => {
      done.current.add(id);
      setOutcome(decisionOutcome(result, accept));
    },
    // The request still waits: it rings again, as it would have without the tap.
    onError: (_error, { id }) => unmuteRequests([id]),
    onSettled: () => {
      deciding.current = false;
      for (const key of ['merchant-bookings', 'merchant-offers', 'merchant-metrics', 'booking-alert-poll']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const next = queue[0];
  useEffect(() => {
    if (!shown && !outcome && next) setShown(next);
  }, [shown, outcome, next]);

  // The request stopped waiting without an answer from here: expired, cancelled or decided elsewhere.
  const stillWaiting = shown ? waiting.some((request) => request.id === shown.id) : false;
  useEffect(() => {
    if (!shown || outcome || stillWaiting || deciding.current || decision.isPending) return;
    done.current.add(shown.id);
    setOutcome(endedOutcome(statusOf(shown.id), Date.parse(shown.deadline ?? '') <= Date.parse(now)));
  }, [shown, outcome, stillWaiting, decision.isPending, statusOf, now]);

  // Each new request starts disarmed, calm and without an old error.
  const shownId = shown?.id;
  useEffect(() => {
    if (!shownId) return;
    setArmed(false);
    setDeclining(false);
    decision.reset();
    const timer = window.setTimeout(() => setArmed(true), ARM_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per request, not per render
  }, [shownId]);

  const open = Boolean(shown);
  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    Array.from(element.children).forEach((child) => observer.observe(child));
    // The entrance slides content up from below the fold, which no resize reports when it settles.
    element.addEventListener('animationend', measure);
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener('animationend', measure);
    };
  }, [open, shownId, outcome, declining]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      // A browser older than the modal <dialog> (Safari before 15.4) still gets the full screen, only without the inert page behind.
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
      const root = document.documentElement;
      const previous = root.style.overflow;
      root.style.overflow = 'hidden';
      return () => {
        root.style.overflow = previous;
        if (element.open) element.close();
      };
    }
    return undefined;
  }, [open]);

  // Screen readers and keyboards start at the heading of whatever the screen now says.
  useEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true });
  }, [open, shownId, outcome]);

  // Straight to the next request, so the console does not flash between two of them.
  function proceed() {
    setOutcome(null);
    setShown(queue.find((request) => request.id !== shown?.id) ?? null);
  }
  const proceedLater = useRef(proceed);
  proceedLater.current = proceed;

  function later() {
    hideRequests(waiting.map((request) => request.id));
    setOutcome(null);
    setShown(null);
  }

  useEffect(() => {
    if (!outcome?.autoClose) return;
    const timer = window.setTimeout(() => proceedLater.current(), AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  // News about a request that is over never keeps a live one waiting behind it: the live one takes
  // the screen. The ended one stays in Rezervace with its state.
  const behind = queue.filter((request) => request.id !== shown?.id).length;
  useEffect(() => {
    if (outcome && !outcome.autoClose && behind > 0) proceedLater.current();
  }, [outcome, behind]);

  function decide(accept: boolean) {
    if (!shown || !armed || decision.isPending) return;
    deciding.current = true;
    // Whoever answers has heard it; the ring stops at once rather than when the list catches up.
    muteRequests([shown.id]);
    // The tap also lets the next request ring, without ringing for this one.
    void unlockSound();
    decision.mutate({ id: shown.id, accept });
  }

  const others = queue.filter((request) => request.id !== shown?.id);
  const left = shown ? timeLeft(shown.deadline, now) : null;
  const overdue = left !== null && left.seconds === 0;
  const urgent = left !== null && left.seconds < 60;
  // It pulses while the request is not silenced, sound or not: a blocked speaker is when the eye matters most.
  const pulsing = shown ? stillWaiting && !isMuted(shown.id) : false;

  return createPortal(
    <dialog
      ref={dialog}
      data-ring-unlock
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="prichozi-nadpis"
      aria-describedby={outcome ? 'prichozi-vysledek' : 'prichozi-detail'}
      onCancel={(event) => {
        // Esc puts the request off, like "Později"; it never answers it.
        event.preventDefault();
        if (outcome) proceed();
        else later();
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 text-ink backdrop:bg-ink/60"
    >
      {shown ? (
        <div ref={scroller} className="takeover relative isolate flex h-full flex-col overflow-y-auto overscroll-contain split:flex-row split:overflow-hidden">
          <Aurora />
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 split:max-lg:right-1/2">
            {!outcome && others.length ? (
              // Requests behind this one, where they take no line from the request itself.
              <p className="inline-flex min-h-9 min-w-0 items-center rounded-full bg-ink/30 px-3 text-sm font-extrabold text-brand-ink">
                <span aria-hidden="true" className="truncate">{moreShort(others.length)}</span>
                <span className="sr-only">{moreWaiting(others.length)}</span>
              </p>
            ) : (
              <p className="min-w-0 truncate text-sm font-extrabold text-brand-ink">
                <span className="short:hidden">FLEK Partner</span>
                {/* A short screen has no line to spare for the venue in the hero, so it moves up here. */}
                <span className="hidden short:inline">{venue}</span>
              </p>
            )}
            <div className="flex shrink-0 items-center gap-2">
              {waiting.length ? <SoundButton ring={ring} ids={waiting.map((request) => request.id)} onBlocked={setBlocked} /> : null}
              {!outcome ? (
                <button
                  type="button"
                  onClick={later}
                  aria-label="Později"
                  className={cx(
                    'takeover-quiet inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3.5 text-sm font-bold lg:bg-surface lg:text-ink lg:ring-1 lg:ring-line lg:hover:bg-line',
                    others.length > 0 && 'max-[389px]:px-0',
                  )}
                >
                  <X size={17} aria-hidden="true" />
                  {/* A small phone keeps the cross only while the count of waiting requests needs the room. */}
                  <span aria-hidden="true" className={cx(others.length > 0 && 'max-[389px]:hidden')}>Později</span>
                </button>
              ) : null}
            </div>
          </div>

          {/* The call: FLEK's logo ringing on the night blue. */}
          <section
            key={`hero:${shown.id}:${outcome ? 'done' : 'open'}`}
            className="relative flex shrink-0 grow flex-col items-center justify-center px-4 pt-[calc(max(1rem,env(safe-area-inset-top))+3.75rem)] pb-14 text-center text-brand-ink sm:px-6 short:flex-row short:gap-4 short:pb-12 short:text-left split:w-1/2 split:shrink split:overflow-y-auto split:pb-10"
          >
            {outcome ? (
              <OutcomeHero outcome={outcome} heading={heading} />
            ) : (
              <>
                <p className="takeover-rise max-w-full truncate text-sm font-bold text-brand-ink/85 short:hidden">{venue}</p>
                <Beacon share={timeShare(shown, now)} urgent={urgent} pulsing={pulsing && !overdue} />
                <div className="flex min-w-0 flex-col items-center short:items-start">
                  <h1
                    ref={heading}
                    tabIndex={-1}
                    id="prichozi-nadpis"
                    className="takeover-rise mt-5 text-2xl leading-tight font-extrabold outline-none short:mt-0 short:text-xl lg:mt-8"
                    style={{ animationDelay: '80ms' }}
                  >
                    Nová žádost o rezervaci
                  </h1>
                  {blocked && !ring.ready ? (
                    <p role="status" className="mt-2 max-w-xs text-sm text-brand-ink/90">
                      Prohlížeč zvuk blokuje. Zkontrolujte hlasitost a že karta není ztlumená.
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </section>

          {/* One white sheet, anchored to the bottom (the right half on a tablet): what it is, and the answer. */}
          <section className="takeover-sheet relative z-10 -mt-8 flex shrink-0 flex-col rounded-t-[2rem] bg-card px-5 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink sm:px-8 short:pt-5 split:mt-0 split:w-1/2 split:shrink split:justify-center split:overflow-y-auto split:rounded-none split:px-8 lg:px-10 lg:pt-24">
            <div key={`sheet:${shown.id}:${outcome ? 'done' : 'open'}`} className="mx-auto w-full max-w-md">
              {outcome ? (
                <OutcomeSheet outcome={outcome} request={shown} now={now} more={others.length} onNext={proceed} />
              ) : (
                <>
                  <RequestDetails request={shown} now={now} left={left} urgent={urgent} overdue={overdue} />
                  {/* The answer stays in reach on a short phone: the buttons stick to the bottom edge. */}
                  <div
                    className={cx(
                      overflowing && 'takeover-dock',
                      'takeover-rise sticky bottom-0 z-10 -mx-5 mt-5 bg-card px-5 pt-1 sm:-mx-8 sm:px-8 short:mt-4 split:static split:mx-0 split:px-0 lg:mt-8',
                    )}
                    style={{ animationDelay: '240ms' }}
                  >
                    {overdue ? null : declining ? (
                      <div role="group" aria-labelledby="prichozi-odmitnout" className="rounded-2xl bg-danger-soft p-4">
                        <p id="prichozi-odmitnout" className="text-base font-extrabold">Opravdu odmítnout?</p>
                        <p className="mt-1 text-sm text-ink/80">Zákazník nic nezaplatí a místo se vrátí do nabídky.</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setDeclining(false)}
                            disabled={decision.isPending}
                            className="min-h-13 rounded-xl border border-line bg-card text-base font-bold hover:bg-surface disabled:opacity-60"
                          >
                            Zpět
                          </button>
                          <button
                            type="button"
                            onClick={() => decide(false)}
                            disabled={decision.isPending}
                            aria-busy={decision.isPending || undefined}
                            className="min-h-13 rounded-xl bg-danger text-base font-extrabold text-card disabled:opacity-70"
                          >
                            {decision.isPending ? 'Odmítáme…' : 'Odmítnout'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      // One strong button; declining is a quiet text button under it.
                      <div className={cx('grid gap-1', armed ? '' : 'pointer-events-none')}>
                        <button
                          type="button"
                          onClick={() => decide(true)}
                          disabled={decision.isPending}
                          aria-busy={decision.isPending || undefined}
                          className="relative inline-flex min-h-15 items-center justify-center overflow-hidden rounded-2xl bg-brand px-6 text-lg font-extrabold text-brand-ink shadow-lift transition-colors hover:bg-accent disabled:opacity-80 short:min-h-14"
                        >
                          {!decision.isPending ? <span aria-hidden="true" className="takeover-sheen" /> : null}
                          <span className="relative inline-flex items-center gap-2">
                            <Check size={22} strokeWidth={3} aria-hidden="true" />
                            {decision.isPending ? 'Potvrzujeme…' : 'Potvrdit rezervaci'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => armed && setDeclining(true)}
                          disabled={decision.isPending}
                          className="min-h-12 rounded-2xl px-5 text-base font-bold text-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-60"
                        >
                          Nemohu přijmout
                        </button>
                      </div>
                    )}
                    {decision.isError ? (
                      <p role="alert" className="mt-3 rounded-2xl bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
                        {errorMessage(decision.error, 'merchant')}
                      </p>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </dialog>,
    document.body,
  );
}

/** Soft light drifting behind everything; decoration only. */
function Aurora() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <span className="takeover-blob takeover-blob-a" />
      <span className="takeover-blob takeover-blob-b" />
      <span className="takeover-blob takeover-blob-c" />
    </div>
  );
}

/**
 * FLEK's logo in a white disc. While it rings, the rays of the pin on its "k" flash, the pin hops and
 * two sonar rings leave the disc on each chord of the ring; the circle around it is the time left.
 */
function Beacon({ share, urgent, pulsing }: { share: number; urgent: boolean; pulsing: boolean }) {
  const circumference = 2 * Math.PI * 46;
  return (
    <div className={cx('takeover-beacon takeover-pop relative mt-3 grid place-items-center short:mt-0', pulsing ? 'is-ringing' : 'is-calm')}>
      <span aria-hidden="true" className="takeover-sonar" />
      <span aria-hidden="true" className="takeover-sonar takeover-sonar-2" />
      <svg viewBox="0 0 100 100" aria-hidden="true" className="absolute inset-0 size-full -rotate-90">
        <circle cx="50" cy="50" r="46" fill="none" strokeWidth="4" className="stroke-brand-ink/20" />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - share)}
          className={cx('transition-[stroke-dashoffset] duration-1000 ease-linear', urgent ? 'stroke-warning-soft takeover-urgent' : 'stroke-brand-ink')}
        />
      </svg>
      <span className="takeover-disc grid place-items-center rounded-full bg-card shadow-lift">
        {/* The wordmark as Wordmark draws it, with the pin's rays free to move. */}
        <span className="takeover-logo inline-flex items-start text-ink" aria-hidden="true">
          <span className="leading-none font-extrabold lowercase" style={{ letterSpacing: '-0.055em' }}>flek</span>
          <svg viewBox="0 0 36 32" className="takeover-pin mt-[-0.26em] ml-[-0.26em] h-[1.2em] w-[1.35em] shrink-0 overflow-visible">
            <path d="M12 30.6s11-11.8 11-17.6a11 11 0 1 0-22 0c0 5.8 11 17.6 11 17.6z" className="fill-brand" />
            <circle cx="12" cy="13" r="6.6" className="fill-card" />
            <path d="M12 8.4v4.6l3.5 2" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-ink" />
            <g fill="none" strokeWidth="3.2" strokeLinecap="round" className="stroke-brand">
              <path className="takeover-ray" d="M26.2 7.6 30.8 2.8" />
              <path className="takeover-ray takeover-ray-2" d="M28.4 13 34.2 10.6" />
              <path className="takeover-ray takeover-ray-3" d="M28.6 18.6 34.6 18" />
            </g>
          </svg>
        </span>
      </span>
    </div>
  );
}

/**
 * The request in the app's own reading colours: the time left and how soon it starts, then when and
 * what in large type, then who and how much, and that the money is already held.
 */
function RequestDetails({
  request,
  now,
  left,
  urgent,
  overdue,
}: {
  request: WaitingRequest;
  now: string;
  left: ReturnType<typeof timeLeft>;
  urgent: boolean;
  overdue: boolean;
}) {
  const starts = startsIn(request.startAt, now);
  return (
    <div id="prichozi-detail">
      <p
        role="timer"
        aria-live="off"
        className={cx(
          'takeover-rise tnum inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-sm font-extrabold whitespace-nowrap',
          urgent ? 'bg-warning-soft text-warning' : 'bg-brand-soft text-accent',
        )}
        style={{ animationDelay: '120ms' }}
      >
        <Clock3 size={15} aria-hidden="true" />
        {overdue ? 'Čas na potvrzení vypršel' : `Potvrďte do ${left?.clock ?? '–'}`}
      </p>
      {/* When, and how soon: the one thing a venue checks first. */}
      <p className="takeover-rise mt-4 flex flex-wrap items-baseline gap-x-2.5 short:mt-3" style={{ animationDelay: '150ms' }}>
        <span className="tnum text-2xl leading-none font-extrabold">
          {dayLabel(request.startAt, now)} {clockTime(request.startAt)}
        </span>
        <span className={cx('tnum text-base font-bold', starts.urgent ? 'text-warning' : 'text-muted')}>
          {starts.urgent ? '🔥 ' : ''}{starts.text}
        </span>
      </p>
      <p className="takeover-rise mt-2 text-base font-bold" style={{ animationDelay: '170ms' }}>
        {request.service} <span className="font-normal text-muted">· {duration(request.startAt, request.endAt)} min</span>
      </p>
      <dl className="takeover-rise mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 short:mt-3 short:pt-3" style={{ animationDelay: '190ms' }}>
        <div className="min-w-0">
          <dt className="text-sm text-muted">Zákazník</dt>
          <dd className="truncate text-base font-bold">{request.customer}</dd>
        </div>
        <div className="text-right">
          <dt className="text-sm text-muted">Vy dostanete</dt>
          <dd className="tnum text-xl leading-tight font-extrabold">{money(request.payoutCents)}</dd>
        </div>
      </dl>
      <p className="takeover-rise mt-3 flex items-start gap-1.5 text-sm text-muted" style={{ animationDelay: '210ms' }}>
        <ShieldCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand" />
        Platba je autorizovaná, strhneme ji po potvrzení.
      </p>
    </div>
  );
}

/**
 * Ring on, off, or still blocked by the browser. Unlike the ring bar, turning the sound on here
 * lets the request on screen ring: it is not answered yet, and ringing until it is is the point.
 * The whole dialog is left out of the tap-anywhere unlock, so this tap is the one that decides.
 * On a tablet or computer the buttons sit over the white half, so they take its colours there.
 */
function SoundButton({ ring, ids, onBlocked }: { ring: Ring; ids: string[]; onBlocked: (blocked: boolean) => void }) {
  const base = 'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold';
  const onWhite = 'lg:bg-surface lg:text-ink lg:ring-1 lg:ring-line lg:hover:bg-line';
  if (!ring.ready) {
    return (
      <button
        type="button"
        onClick={() => void unlockSound().then((ok) => onBlocked(!ok))}
        className={cx(base, 'takeover-call bg-card text-brand lg:bg-brand lg:text-brand-ink')}
      >
        <Volume2 size={17} aria-hidden="true" />
        Zapnout zvuk
      </button>
    );
  }
  const silenced = ids.every((id) => isMuted(id));
  return silenced ? (
    <button type="button" aria-pressed="true" onClick={() => ring.unmute(ids)} className={cx(base, 'takeover-quiet', onWhite)}>
      <BellOff size={17} aria-hidden="true" />
      Ztlumeno
    </button>
  ) : (
    <button type="button" aria-pressed="false" onClick={ring.mute} className={cx(base, 'takeover-quiet', onWhite)}>
      <BellOff size={17} aria-hidden="true" />
      Ztlumit
    </button>
  );
}

/** How the request ended, drawn where the logo rang: a check that draws itself, or a quiet icon. */
function OutcomeHero({ outcome, heading }: { outcome: Outcome; heading: React.RefObject<HTMLHeadingElement | null> }) {
  const Icon = outcome.tone === 'declined' ? X : outcome.tone === 'warning' ? Clock3 : Info;
  return (
    <>
      <div className="takeover-beacon takeover-pop relative grid place-items-center">
        {outcome.tone === 'success' ? (
          <>
            <span aria-hidden="true" className="takeover-sonar takeover-sonar-once" />
            <Burst />
            <span className="takeover-disc grid place-items-center rounded-full bg-card shadow-lift">
              <svg viewBox="0 0 52 52" aria-hidden="true" className="size-1/2">
                <path d="M14 27.5 22.5 36 39 17" fill="none" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" className="takeover-check stroke-brand" />
              </svg>
            </span>
          </>
        ) : (
          <span className="takeover-disc grid place-items-center rounded-full bg-card shadow-lift">
            <Icon aria-hidden="true" strokeWidth={2.5} className={cx('size-2/5', outcome.tone === 'warning' ? 'text-warning' : 'text-brand')} />
          </span>
        )}
      </div>
      <h1
        ref={heading}
        tabIndex={-1}
        id="prichozi-nadpis"
        className="takeover-rise mt-5 text-2xl leading-tight font-extrabold outline-none short:mt-0 short:text-xl lg:mt-8"
        style={{ animationDelay: '120ms' }}
      >
        {outcome.title}
      </h1>
    </>
  );
}

function OutcomeSheet({
  outcome,
  request,
  now,
  more,
  onNext,
}: {
  outcome: Outcome;
  request: WaitingRequest;
  now: string;
  more: number;
  onNext: () => void;
}) {
  return (
    <>
      <p id="prichozi-vysledek" className="takeover-rise text-base" style={{ animationDelay: '140ms' }}>
        {outcome.text}
      </p>
      <p className="takeover-rise tnum mt-3 truncate text-sm font-bold text-muted" style={{ animationDelay: '170ms' }}>
        {dayLabel(request.startAt, now)} {clockTime(request.startAt)} · {request.service} · {request.customer}
      </p>
      <button
        type="button"
        onClick={onNext}
        className="takeover-rise relative mt-5 inline-flex min-h-14 w-full items-center justify-center overflow-hidden rounded-2xl bg-brand px-6 text-lg font-extrabold text-brand-ink shadow-lift transition-colors hover:bg-accent"
        style={{ animationDelay: '200ms' }}
      >
        {outcome.autoClose ? (
          <span aria-hidden="true" className="takeover-countdown absolute inset-y-0 left-0 bg-accent" style={{ animationDuration: `${AUTO_CLOSE_MS}ms` }} />
        ) : null}
        <span className="relative">{more ? 'Další žádost' : outcome.autoClose ? 'Hotovo' : 'Zavřít'}</span>
      </button>
    </>
  );
}

/** FLEK's motion dashes flying out of the confirmed request. */
function Burst() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      {Array.from({ length: 12 }, (_, index) => (
        <span
          key={index}
          className={cx('takeover-dash', index % 3 === 0 ? 'bg-card' : index % 3 === 1 ? 'bg-promo' : 'bg-brand-on-dark')}
          style={{ '--angle': `${index * 30 + (index % 2) * 12}deg`, animationDelay: `${120 + (index % 4) * 30}ms` } as React.CSSProperties}
        />
      ))}
    </span>
  );
}
