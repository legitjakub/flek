export type BookingAlert = {
  id: string;
  service: string;
  startAt: string;
  payoutCents: number;
  /** A request waits for the merchant's answer until `deadline`; a booking is already agreed. */
  kind?: 'booking' | 'request';
  deadline?: string | null;
};
type Snapshot = { alerts: BookingAlert[]; unreadIds: string[] };
const empty: Snapshot = { alerts: [], unreadIds: [] };

/** Identity-scoped state survives page navigation, but never sign-out. */
export function createBookingAlertStore() {
  const states = new Map<string, { since: number; seen: Set<string>; snapshot: Snapshot }>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    empty,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get(scope: string) { return states.get(scope)?.snapshot ?? empty; },
    start(scope: string, since: number) {
      if (!states.has(scope)) states.set(scope, { since, seen: new Set(), snapshot: empty });
    },
    announce(scope: string, alert: BookingAlert, created: number) {
      const state = states.get(scope);
      if (!state || !Number.isFinite(created) || state.seen.has(alert.id)) return false;
      // An agreed booking from before this page opened is old news. A request still waiting is not:
      // it needs the merchant before its clock runs out, whenever they happen to look.
      if (alert.kind !== 'request' && created < state.since) return false;
      state.seen.add(alert.id);
      state.snapshot = { alerts: [alert, ...state.snapshot.alerts].slice(0, 3), unreadIds: [...state.snapshot.unreadIds, alert.id] };
      emit();
      return true;
    },
    markRead(scope: string) {
      const state = states.get(scope);
      if (!state?.snapshot.unreadIds.length) return;
      state.snapshot = { ...state.snapshot, unreadIds: [] };
      emit();
    },
    dismiss(scope: string, id: string) {
      const state = states.get(scope);
      if (!state || (!state.snapshot.alerts.some((a) => a.id === id) && !state.snapshot.unreadIds.includes(id))) return;
      state.snapshot = { alerts: state.snapshot.alerts.filter((a) => a.id !== id), unreadIds: state.snapshot.unreadIds.filter((unread) => unread !== id) };
      emit();
    },
    reset() { states.clear(); emit(); },
  };
}

export const bookingAlerts = createBookingAlertStore();
