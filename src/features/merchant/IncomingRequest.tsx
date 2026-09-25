import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing, Check, Clock3, Info, Volume2, X } from 'lucide-react';
import { respondToBooking } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { clockTime, dayLabel, duration } from '../../lib/time';
import { useServerNow } from '../../lib/clock';
import { cx } from '../../components/ui';
import type { BookingStatus } from '../../types/database';
import { startsInLine, timeLeft } from '../bookings/confirmationView';
import { isMuted, muteRequests, unlockSound, unmuteRequests } from './ringer';
import {
  decisionOutcome,
  endedOutcome,
  hideRequests,
  moreShort,
  moreWaiting,
  onScreen,
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
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 text-brand-ink backdrop:bg-ink/60"
    >
      {shown ? (
        <div ref={scroller} className="takeover relative isolate flex h-full flex-col overflow-y-auto overscroll-contain">
          <Aurora />
          <div className="relative mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 flat:pt-[max(0.5rem,env(safe-area-inset-top))]">
            {!outcome && others.length ? (
              // Requests behind this one, where they take no line from the request itself.
              <p className="inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-full bg-ink/30 px-3 text-sm font-extrabold">
                <BellRing size={15} aria-hidden="true" className="shrink-0" />
                <span aria-hidden="true" className="truncate">{moreShort(others.length)}</span>
                <span className="sr-only">{moreWaiting(others.length)}</span>
              </p>
            ) : (
              <p className="min-w-0 truncate text-sm font-extrabold">
                <span className="short:hidden">FLEK Partner</span>
                {/* A short screen has no line to spare for the venue in the hero, so it moves up here. */}
                <span className="hidden short:inline">{venue}</span>
              </p>
            )}
            <div className="flex shrink-0 items-center gap-2">
              {waiting.length ? <SoundButton ring={ring} ids={waiting.map((request) => request.id)} onBlocked={setBlocked} /> : null}
              {!outcome ? (
                <button type="button" onClick={later} className="takeover-quiet inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold">
                  <X size={17} aria-hidden="true" />
                  Později
                </button>
              ) : null}
            </div>
          </div>
          {blocked && !ring.ready ? (
            <p role="status" className="relative mx-auto mt-2 w-full max-w-5xl px-4 text-right text-sm text-brand-ink/90 sm:px-6">
              Prohlížeč zvuk blokuje. Zkontrolujte hlasitost a že karta není ztlumená.
            </p>
          ) : null}

          {outcome ? (
            <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
              <OutcomeView
                key={`${shown.id}:done`}
                outcome={outcome}
                request={shown}
                now={now}
                heading={heading}
                more={others.length}
                onNext={proceed}
              />
            </div>
          ) : (
            <div
              key={shown.id}
              className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pt-4 sm:px-6 flat:grid flat:max-w-3xl flat:grid-cols-2 flat:items-center flat:gap-8 flat:pt-2 lg:grid lg:max-w-5xl lg:grid-cols-2 lg:items-center lg:gap-16 lg:pb-10"
            >
              {/* On a short screen the pin sits beside the heading instead of above it. */}
              <div className="flex flex-col items-center text-center short:flex-row short:gap-4 short:text-left">
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
                  <p
                    role="timer"
                    aria-live="off"
                    className={cx(
                      'takeover-rise tnum mt-3 inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-lg font-extrabold whitespace-nowrap short:mt-2 short:min-h-9 short:px-3 short:text-base',
                      urgent ? 'bg-warning-soft text-warning' : 'bg-brand-ink/12 text-brand-ink',
                    )}
                    style={{ animationDelay: '120ms' }}
                  >
                    <Clock3 size={18} aria-hidden="true" />
                    {overdue ? 'Čas na potvrzení vypršel' : `Potvrďte do ${left?.clock ?? '–'}`}
                  </p>
                </div>
              </div>

              <div className="flex flex-col">
                <RequestCard request={shown} now={now} />
                <p className="takeover-rise mt-3 px-1 text-center text-sm text-brand-ink/85 short:mt-2 flat:hidden lg:text-left" style={{ animationDelay: '190ms' }}>
                  Zákazník má platbu autorizovanou. Peníze strhneme, až rezervaci potvrdíte.
                </p>
                {/* The answer stays in reach on a short phone: the buttons stick to the bottom edge. */}
                <div
                  className={cx(overflowing && 'takeover-dock', 'takeover-rise sticky bottom-0 z-10 -mx-4 mt-2 px-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] short:pt-3 short:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 flat:static flat:mx-0 flat:mt-2 flat:px-0 flat:pt-0 flat:pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:static lg:mx-0 lg:mt-5 lg:p-0')}
                  style={{ animationDelay: '220ms' }}
                >
                  {overdue ? null : declining ? (
                    <div role="group" aria-labelledby="prichozi-odmitnout" className="rounded-2xl bg-ink/40 p-4 text-left">
                      <p id="prichozi-odmitnout" className="text-base font-extrabold">Opravdu odmítnout?</p>
                      <p className="mt-1 text-sm text-brand-ink/90">Zákazník nic nezaplatí a místo se vrátí do nabídky.</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setDeclining(false)} disabled={decision.isPending} className="takeover-quiet min-h-13 rounded-xl text-base font-bold">
                          Zpět
                        </button>
                        <button
                          type="button"
                          onClick={() => decide(false)}
                          disabled={decision.isPending}
                          aria-busy={decision.isPending || undefined}
                          className="min-h-13 rounded-xl bg-card text-base font-extrabold text-danger disabled:opacity-70"
                        >
                          {decision.isPending ? 'Odmítáme…' : 'Odmítnout'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={cx('grid gap-3 short:gap-2', armed ? '' : 'pointer-events-none')}>
                      <button
                        type="button"
                        onClick={() => decide(true)}
                        disabled={decision.isPending}
                        aria-busy={decision.isPending || undefined}
                        className="relative inline-flex min-h-16 items-center justify-center overflow-hidden rounded-2xl bg-card px-5 text-lg font-extrabold text-brand shadow-lift disabled:opacity-80 short:min-h-14"
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
                        className="takeover-quiet min-h-13 rounded-2xl px-5 text-base font-bold short:min-h-12"
                      >
                        Nemohu přijmout
                      </button>
                    </div>
                  )}
                  {decision.isError ? (
                    <p role="alert" className="mt-3 rounded-xl bg-card px-4 py-3 text-left text-sm font-bold text-danger">
                      {errorMessage(decision.error, 'merchant')}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )}
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
 * FLEK's pin — a place and a time — in a white disc. While it rings, its three rays flash and two
 * sonar rings leave it on each chord of the ring; the circle around it is the time left to answer.
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
        <svg viewBox="0 0 36 32" aria-hidden="true" className="takeover-pin translate-x-[6%]">
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
    </div>
  );
}

function RequestCard({ request, now }: { request: WaitingRequest; now: string }) {
  const starts = startsInLine(request.startAt, now);
  return (
    <div id="prichozi-detail" className="takeover-rise mt-5 w-full rounded-3xl bg-card p-5 text-left text-ink shadow-lift short:mt-4 short:p-4 lg:mt-0" style={{ animationDelay: '160ms' }}>
      <p className={cx('tnum text-sm font-bold', starts.urgent ? 'text-warning' : 'text-muted')}>{starts.text}</p>
      <p className="tnum mt-1 text-xl leading-tight font-extrabold">
        {dayLabel(request.startAt, now)} {clockTime(request.startAt)}
      </p>
      <p className="mt-0.5 text-base font-bold">
        {request.service} <span className="font-normal text-muted">{duration(request.startAt, request.endAt)} min</span>
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 short:mt-3 short:pt-3">
        <div className="min-w-0">
          <dt className="text-sm text-muted">Zákazník</dt>
          <dd className="truncate text-base font-bold">{request.customer}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Vy dostanete</dt>
          <dd className="tnum text-xl leading-tight font-extrabold">{money(request.payoutCents)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Ring on, off, or still blocked by the browser. Unlike the ring bar, turning the sound on here
 * lets the request on screen ring: it is not answered yet, and ringing until it is is the point.
 * The whole dialog is left out of the tap-anywhere unlock, so this tap is the one that decides.
 */
function SoundButton({ ring, ids, onBlocked }: { ring: Ring; ids: string[]; onBlocked: (blocked: boolean) => void }) {
  const base = 'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-bold';
  if (!ring.ready) {
    return (
      <button type="button" onClick={() => void unlockSound().then((ok) => onBlocked(!ok))} className={cx(base, 'takeover-call bg-card text-brand')}>
        <Volume2 size={17} aria-hidden="true" />
        Zapnout zvuk
      </button>
    );
  }
  const silenced = ids.every((id) => isMuted(id));
  return silenced ? (
    <button type="button" aria-pressed="true" onClick={() => ring.unmute(ids)} className={cx(base, 'takeover-quiet')}>
      <BellOff size={17} aria-hidden="true" />
      Ztlumeno
    </button>
  ) : (
    <button type="button" aria-pressed="false" onClick={ring.mute} className={cx(base, 'takeover-quiet')}>
      <BellOff size={17} aria-hidden="true" />
      Ztlumit
    </button>
  );
}

function OutcomeView({
  outcome,
  request,
  now,
  heading,
  more,
  onNext,
}: {
  outcome: Outcome;
  request: WaitingRequest;
  now: string;
  heading: React.RefObject<HTMLHeadingElement | null>;
  more: number;
  onNext: () => void;
}) {
  const Icon = outcome.tone === 'declined' ? X : outcome.tone === 'warning' ? Clock3 : Info;
  return (
    <div className="flex flex-col items-center text-center">
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
            <Icon size={52} strokeWidth={2.5} aria-hidden="true" className={outcome.tone === 'warning' ? 'text-warning' : 'text-brand'} />
          </span>
        )}
      </div>
      <h1 ref={heading} tabIndex={-1} id="prichozi-nadpis" className="takeover-rise mt-7 text-2xl leading-tight font-extrabold outline-none" style={{ animationDelay: '120ms' }}>
        {outcome.title}
      </h1>
      <p id="prichozi-vysledek" className="takeover-rise mt-2 max-w-sm text-base text-brand-ink/90" style={{ animationDelay: '160ms' }}>
        {outcome.text}
      </p>
      <p className="takeover-rise tnum mt-4 max-w-full truncate rounded-full bg-ink/25 px-4 py-2 text-sm font-bold" style={{ animationDelay: '200ms' }}>
        {dayLabel(request.startAt, now)} {clockTime(request.startAt)} · {request.service} · {request.customer}
      </p>
      <button
        type="button"
        onClick={onNext}
        className="takeover-rise relative mt-8 inline-flex min-h-14 w-full max-w-sm items-center justify-center overflow-hidden rounded-2xl bg-card px-5 text-lg font-extrabold text-brand shadow-lift"
        style={{ animationDelay: '260ms' }}
      >
        {outcome.autoClose ? (
          <span aria-hidden="true" className="takeover-countdown absolute inset-y-0 left-0 bg-brand-soft" style={{ animationDuration: `${AUTO_CLOSE_MS}ms` }} />
        ) : null}
        <span className="relative">{more ? 'Další žádost' : outcome.autoClose ? 'Hotovo' : 'Zavřít'}</span>
      </button>
    </div>
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
