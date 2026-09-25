import { describe, expect, it } from 'vitest';
import {
  decisionOutcome,
  endedOutcome,
  hideRequests,
  moreShort,
  moreWaiting,
  onScreen,
  showRequests,
  startsIn,
  takeoverVersion,
  timeShare,
} from '../src/features/merchant/incomingRequest';
import type { WaitingRequest } from '../src/features/merchant/RequestRing';

const request = (id: string, deadline = '2026-09-24T12:05:00Z'): WaitingRequest => ({
  id,
  deadline,
  authorizedAt: '2026-09-24T12:00:00Z',
  service: 'Masáž zad',
  startAt: '2026-09-24T14:00:00Z',
  endAt: '2026-09-24T15:00:00Z',
  customer: 'Jana N.',
  payoutCents: 42000,
});

describe('full-screen request queue', () => {
  it('puts requests off with "Později" and brings them all back with "Zobrazit"', () => {
    showRequests();
    const waiting = [request('a'), request('b')];
    expect(onScreen(waiting).map((item) => item.id)).toEqual(['a', 'b']);
    const before = takeoverVersion();
    hideRequests(['a', 'b']);
    expect(takeoverVersion()).toBeGreaterThan(before);
    expect(onScreen(waiting)).toEqual([]);
    // A request that arrives later is not put off: it takes the screen again.
    expect(onScreen([...waiting, request('c')]).map((item) => item.id)).toEqual(['c']);
    showRequests();
    expect(onScreen(waiting)).toHaveLength(2);
  });

  it('never brings back a request this screen already finished with', () => {
    showRequests();
    expect(onScreen([request('a'), request('b')], new Set(['a'])).map((item) => item.id)).toEqual(['b']);
  });
});

describe('timeShare', () => {
  it('drains from the moment the request arrived to its deadline', () => {
    const item = request('a');
    expect(timeShare(item, '2026-09-24T12:00:00Z')).toBe(1);
    expect(timeShare(item, '2026-09-24T12:02:30Z')).toBeCloseTo(0.5);
    expect(timeShare(item, '2026-09-24T12:05:00Z')).toBe(0);
    expect(timeShare(item, '2026-09-24T12:09:00Z')).toBe(0);
  });

  it('falls back to a five-minute window and to empty without a deadline', () => {
    expect(timeShare({ authorizedAt: null, deadline: '2026-09-24T12:05:00Z' }, '2026-09-24T12:02:30Z')).toBeCloseTo(0.5);
    expect(timeShare({ authorizedAt: null, deadline: null }, '2026-09-24T12:02:30Z')).toBe(0);
  });
});

describe('outcomes', () => {
  it('celebrates only what the server confirmed from this screen', () => {
    const confirmed = decisionOutcome({ status: 'capturing', decided: true, confirmation_expires_at: null }, true);
    expect(confirmed).toMatchObject({ tone: 'success', title: 'Rezervace je potvrzená', autoClose: true });
    const declined = decisionOutcome({ status: 'rejected', decided: true, confirmation_expires_at: null }, false);
    expect(declined).toMatchObject({ tone: 'declined', autoClose: true });
    expect(declined.text).toContain('nic nezaplatí');
  });

  it('says so, and waits to be read, when the press came too late', () => {
    const late = decisionOutcome({ status: 'expired', decided: false, confirmation_expires_at: null }, true);
    expect(late).toMatchObject({ tone: 'warning', title: 'Žádost vypršela', autoClose: false });
    const elsewhere = decisionOutcome({ status: 'capturing', decided: false, confirmation_expires_at: null }, true);
    expect(elsewhere).toMatchObject({ tone: 'info', title: 'Už je potvrzeno', autoClose: false });
  });

  it('explains a request that ended without a press here', () => {
    expect(endedOutcome('expired', false).title).toBe('Žádost vypršela');
    // The list still says "waiting" for a moment after the deadline: the clock decides.
    expect(endedOutcome('pending_merchant', true).title).toBe('Žádost vypršela');
    expect(endedOutcome('confirmed', false).title).toBe('Už je potvrzeno');
    expect(endedOutcome('rejected', false).title).toBe('Už je odmítnuto');
    expect(endedOutcome('cancelled_by_customer', false).title).toBe('Zákazník žádost zrušil');
    expect(endedOutcome(undefined, false).title).toBe('Žádost už skončila');
    for (const status of ['expired', 'confirmed', 'rejected', 'cancelled_by_customer'] as const) {
      expect(endedOutcome(status, false).autoClose).toBe(false);
    }
  });

  it('speaks to the venue formally and never mentions a refund for a released hold', () => {
    const texts = [
      decisionOutcome({ status: 'capturing', decided: true, confirmation_expires_at: null }, true),
      decisionOutcome({ status: 'rejected', decided: true, confirmation_expires_at: null }, false),
      endedOutcome('expired', false),
      endedOutcome('cancelled_by_customer', false),
    ].map((outcome) => `${outcome.title} ${outcome.text}`).join(' ');
    expect(texts).not.toMatch(/\b(máš|tvůj|potvrď|vracíme)\b/i);
  });
});

describe('moreWaiting', () => {
  it('counts the requests behind the one on screen in Czech', () => {
    expect(moreWaiting(0)).toBeNull();
    expect(moreWaiting(1)).toBe('Čeká ještě další žádost');
    expect(moreWaiting(3)).toBe('Čekají ještě další 3 žádosti');
    expect(moreWaiting(6)).toBe('Čeká ještě dalších 6 žádostí');
  });
});

describe('moreShort', () => {
  it('fits the top bar', () => {
    expect(moreShort(1)).toBe('+1 žádost');
    expect(moreShort(4)).toBe('+4 žádosti');
    expect(moreShort(5)).toBe('+5 žádostí');
  });
});

describe('startsIn', () => {
  const now = '2026-09-24T12:00:00Z';
  const at = (minutes: number) => new Date(Date.parse(now) + minutes * 60_000).toISOString();
  it('says how soon the FLEK starts, short enough to sit beside its time', () => {
    expect(startsIn(at(0), now)).toEqual({ text: 'začíná teď', urgent: true });
    expect(startsIn(at(18), now)).toEqual({ text: 'za 18 min', urgent: true });
    expect(startsIn(at(90), now)).toEqual({ text: 'za 90 min', urgent: false });
    expect(startsIn(at(180), now).text).toBe('za 3 hodiny');
    expect(startsIn(at(300), now).text).toBe('za 5 hodin');
    expect(startsIn(at(26 * 60), now).text).toBe('za 1 den');
    expect(startsIn(at(3 * 24 * 60), now).text).toBe('za 3 dny');
    expect(startsIn(at(6 * 24 * 60), now).text).toBe('za 6 dní');
  });
});
