import { describe, expect, it } from 'vitest';
import { createBookingAlertStore } from '../src/features/merchant/bookingAlertStore';
const alert = (id: string) => ({ id, service: 'Střih', startAt: '2026-09-13T12:00:00Z', payoutCents: 75000 });

describe('partner booking alerts', () => {
  it('keeps two venues and two accounts separate, and forgets both on sign-out', () => {
    const store = createBookingAlertStore();
    for (const scope of ['u1:b1', 'u1:b2', 'u2:b1']) store.start(scope, 100);
    store.announce('u1:b1', alert('one'), 101);
    expect(store.get('u1:b1').unreadIds).toEqual(['one']);
    expect(store.get('u1:b2')).toEqual(store.empty);
    expect(store.get('u2:b1')).toEqual(store.empty);
    store.reset();
    expect(store.get('u1:b1')).toEqual(store.empty);
    // A late callback after logout cannot recreate a previous account's data.
    expect(store.announce('u1:b1', alert('late'), 102)).toBe(false);
  });
  it('deduplicates socket/poll delivery and retains read state across page navigation', () => {
    const store = createBookingAlertStore();
    store.start('u:b', 100);
    expect(store.announce('u:b', alert('old'), 99)).toBe(false);
    expect(store.announce('u:b', alert('new'), 101)).toBe(true);
    store.markRead('u:b');
    store.start('u:b', 105);
    expect(store.announce('u:b', alert('new'), 101)).toBe(false);
    expect(store.get('u:b').unreadIds).toEqual([]);
  });
  it('dismissing a read banner cannot decrement a different unread booking', () => {
    const store = createBookingAlertStore();
    store.start('u:b', 0);
    store.announce('u:b', alert('read'), 1);
    store.markRead('u:b');
    store.announce('u:b', alert('unread'), 2);
    store.dismiss('u:b', 'read');
    expect(store.get('u:b').unreadIds).toEqual(['unread']);
    store.dismiss('u:b', 'unread');
    expect(store.get('u:b').alerts).toEqual([]);
  });
});
