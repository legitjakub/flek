import type { BookingStatus, PaymentState } from '../../types/database';

/**
 * What the customer is told about a request that waits for the merchant. Presentation only:
 * every fact comes from the server (my_payment_state / my_bookings), nothing here decides a state.
 *
 * Two words are never mixed up. Before capture nothing was taken, so the card's hold is
 * "released" ("blokaci uvolňujeme"); only captured money is ever "returned" ("vracíme").
 */
export type ConfirmationKind =
  | 'verifying'
  | 'waiting'
  | 'capturing'
  | 'confirmed'
  | 'past'
  | 'rejected'
  | 'timeout'
  | 'checkout_timeout'
  | 'customer_cancelled'
  | 'offer_cancelled'
  | 'capture_failed'
  | 'payment_failed'
  | 'not_finished'
  | 'refunding'
  | 'refunded';

export type ConfirmationView = {
  kind: ConfirmationKind;
  title: string;
  body: string;
  /** Whether the page keeps asking the server. */
  live: boolean;
  /** The next step that makes sense. */
  action: 'cancel_request' | 'find_other' | 'retry' | 'bookings' | null;
};

type Facts = Pick<PaymentState, 'status' | 'refund_requested' | 'failure_reason' | 'reservation_code'> & {
  booking_status?: BookingStatus | null;
  merchant_decided_at?: string | null;
  authorized_at?: string | null;
  refund_status?: PaymentState['refund_status'];
  authorization_state?: PaymentState['authorization_state'];
};

const RELEASE = 'Nic jsme nestrhli a blokaci částky na kartě uvolňujeme.';

export function confirmationView(state: Facts | null | undefined, returnedWithoutPaying = false): ConfirmationView {
  if (!state) return { kind: 'verifying', title: 'Ověřujeme platbu', body: 'Obvykle to trvá pár sekund.', live: true, action: null };
  const release = state.authorization_state === 'released' ? 'Nic jsme nestrhli. Blokaci jsme uvolnili, banka ji ale může ještě pár dní ukazovat; pak sama zmizí.' : RELEASE;
  // A cancelled booking can retain a historical code. Money/outcome takes precedence.
  if (state.status === 'refunded') {
    return { kind: 'refunded', title: 'Platba je vrácená', body: 'Celou částku jsme vrátili na kartu. Připsání na výpisu závisí na bance.', live: false, action: 'find_other' };
  }
  if (state.refund_requested || (state.status === 'paid' && state.booking_status?.startsWith('cancelled'))) {
    const failed = state.refund_status === 'failed' || state.refund_status === 'canceled';
    return {
      kind: 'refunding', title: state.booking_status?.startsWith('cancelled') ? 'Rezervace je zrušená' : 'Rezervaci se nepodařilo dokončit',
      body: failed ? 'Platbu se na kartu vrátit nepodařilo. Peníze nepropadly, vrácení vyřešíme s tebou ručně.'
        : 'Platbu jsme už strhli, a proto ti ji celou vracíme na kartu. Na výpisu se obvykle objeví do 5–10 pracovních dnů.',
      live: !failed, action: 'find_other',
    };
  }
  if (state.reservation_code && state.booking_status === 'confirmed' && state.status === 'paid') {
    return { kind: 'confirmed', title: '🔥 FLEK je tvůj!', body: 'Podnik rezervaci potvrdil.', live: false, action: 'bookings' };
  }
  if (state.status === 'paid' && (state.booking_status === 'completed' || state.booking_status === 'no_show')) {
    return { kind: 'past', title: 'Termín už proběhl', body: 'Platba byla stržená. Podrobnosti najdeš v historii rezervací.', live: false, action: 'bookings' };
  }
  switch (state.booking_status) {
    case 'pending_payment':
      return returnedWithoutPaying
        ? { kind: 'verifying', title: 'Ověřujeme ukončení platby', body: 'Rušíme nedokončenou žádost. Pokud se částka mezitím zablokovala, blokaci uvolníme.', live: true, action: null }
        : { kind: 'verifying', title: 'Ověřujeme platbu', body: 'Obvykle to trvá pár sekund. Potom pošleme rezervaci podniku k potvrzení.', live: true, action: null };
    case 'pending_merchant':
      return {
        kind: 'waiting', title: 'Čekáme na potvrzení podniku',
        body: 'Držíme ti tenhle FLEK. Částku máš na kartě jen zablokovanou; strhneme ji, až podnik rezervaci potvrdí. Když nepotvrdí včas, blokaci uvolníme.',
        live: true, action: 'cancel_request',
      };
    case 'capturing':
      return {
        kind: 'capturing', title: 'Potvrzujeme FLEK…',
        body: 'Podnik rezervaci potvrdil. Dokončujeme platbu a za pár sekund uvidíš rezervační kód.', live: true, action: null,
      };
    case 'rejected':
      return { kind: 'rejected', title: 'Tentokrát to nevyšlo', body: `Podnik rezervaci nepotvrdil. ${release}`, live: false, action: 'find_other' };
    case 'expired':
      return state.authorized_at
        ? { kind: 'timeout', title: 'Podnik nepotvrdil včas', body: `Čas na potvrzení vypršel. ${release}`, live: false, action: 'find_other' }
        : {
          kind: 'checkout_timeout', title: 'Čas na zaplacení vypršel',
          body: 'Termín jsme ti drželi jen pár minut. Nic jsme nestrhli, a pokud se částka na kartě přesto zablokovala, blokace se uvolní.',
          live: false, action: 'retry',
        };
    case 'cancelled_by_customer':
      return { kind: 'customer_cancelled', title: 'Žádost je zrušená', body: release, live: false, action: 'find_other' };
    case 'cancelled_by_merchant':
      return { kind: 'offer_cancelled', title: 'Podnik termín zrušil', body: release, live: false, action: 'find_other' };
    case 'payment_failed':
      return state.merchant_decided_at || state.failure_reason === 'CAPTURE_FAILED'
        ? {
          kind: 'capture_failed', title: 'Podnik potvrdil, ale platbu se nepodařilo dokončit',
          body: `${release} Zkus to prosím znovu, případně s jinou kartou.`,
          live: false, action: 'retry',
        }
        : { kind: 'payment_failed', title: 'Platbu se nepodařilo dokončit', body: 'Nic jsme nestrhli. Zkus to prosím znovu.', live: false, action: 'retry' };
    default:
      break;
  }
  if (state.status === 'failed' || (returnedWithoutPaying && state.status === 'pending')) {
    return { kind: 'not_finished', title: 'Platba nebyla dokončena', body: 'Nic jsme nestrhli. Termín ti nedržíme, tak ho zkus zarezervovat znovu, dokud je volný.', live: false, action: 'retry' };
  }
  return { kind: 'verifying', title: 'Ověřujeme platbu', body: 'Obvykle to trvá pár sekund. Hned potom uvidíš rezervační kód.', live: true, action: null };
}

/**
 * Time left until a server deadline, measured on the server clock and never below zero: `label`
 * reads "4:18" in a sentence, `clock` "04:18" on the partner's countdown.
 */
export function timeLeft(deadline: string | null | undefined, now: string): { label: string; clock: string; seconds: number } | null {
  if (!deadline) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - Date.parse(now)) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return { label: `${minutes}:${rest}`, clock: `${String(minutes).padStart(2, '0')}:${rest}`, seconds };
}

/**
 * The waiting line under the heading. A FLEK that starts soon gets a short window from the server;
 * the customer is told why, so a two-minute countdown does not look like a mistake.
 */
export function waitingLine(state: { confirmation_expires_at?: string | null; start_at?: string | null; authorized_at?: string | null }, now: string): string | null {
  const left = timeLeft(state.confirmation_expires_at, now);
  if (!left) return null;
  if (left.seconds === 0) return 'Čas na potvrzení vypršel. Ověřujeme výsledek…';
  const startsSoon = state.start_at && state.authorized_at
    && Date.parse(state.start_at) - Date.parse(state.authorized_at) <= 30 * 60_000;
  return startsSoon
    ? `Tenhle FLEK začíná brzy, takže podnik má na potvrzení ${left.label}`
    : `Podnik má na potvrzení ještě ${left.label}`;
}

/** Urgency for the merchant's card, from the server's start time and clock. */
export function startsInLine(startAt: string, now: string): { text: string; urgent: boolean } {
  const minutes = Math.max(0, Math.round((Date.parse(startAt) - Date.parse(now)) / 60_000));
  if (minutes < 30) return { text: `🔥 Začíná za ${minutes} ${minutesWord(minutes)}`, urgent: true };
  if (minutes < 120) return { text: `FLEK začíná za ${minutes} minut`, urgent: false };
  const hours = Math.round(minutes / 60);
  return { text: `FLEK začíná za ${hours} ${hours < 5 ? 'hodiny' : 'hodin'}`, urgent: false };
}

function minutesWord(n: number): string {
  if (n === 1) return 'minutu';
  if (n >= 2 && n <= 4) return 'minuty';
  return 'minut';
}

export type CustomerTone = 'positive' | 'warning' | 'danger' | 'neutral';

/**
 * The one status a customer sees on a booking card, said to the person who made it. The venue and
 * the admin keep StatusBadge's vocabulary ("Zrušeno zákazníkem", "Zamítnuto"); a customer reading
 * that about their own booking sees a log, not an answer. What happens to the money is said
 * separately, next to the amount (bookingMoneyState), so the two never repeat each other.
 */
export function customerBookingStatus(booking: { status: BookingStatus; authorized_at?: string | null }): { label: string; tone: CustomerTone } {
  switch (booking.status) {
    case 'pending_payment': return { label: 'Dokončuješ platbu', tone: 'warning' };
    case 'pending_merchant': return { label: 'Čeká na podnik', tone: 'warning' };
    case 'capturing': return { label: 'Podnik potvrdil', tone: 'positive' };
    case 'confirmed': return { label: 'Potvrzeno', tone: 'positive' };
    case 'completed': return { label: 'Proběhlo', tone: 'positive' };
    case 'no_show': return { label: 'Zmeškáno', tone: 'danger' };
    case 'cancelled_by_customer': return { label: 'Zrušeno na tvou žádost', tone: 'neutral' };
    case 'cancelled_by_merchant': return { label: 'Zrušeno podnikem', tone: 'danger' };
    case 'rejected': return { label: 'Podnik nemohl přijmout', tone: 'neutral' };
    // Without an authorisation the customer never finished paying; with one, the venue ran out of time.
    case 'expired': return booking.authorized_at ? { label: 'Podnik nestihl potvrdit', tone: 'neutral' } : { label: 'Platba nedokončena', tone: 'neutral' };
    case 'payment_failed': return { label: 'Platba se nezdařila', tone: 'danger' };
  }
}

/**
 * What is happening to the money, said beside the amount it concerns. A hold is never "paid" and a
 * release still in progress is never "released": the customer compares this line with their bank.
 */
export function bookingMoneyState(booking: {
  status: BookingStatus;
  payment_status: PaymentState['status'] | null;
  authorization_state?: PaymentState['authorization_state'];
  authorized_at?: string | null;
}): { text: string; tone: 'positive' | 'muted' } | null {
  if (booking.payment_status === 'refunded') return { text: 'Vráceno', tone: 'positive' };
  if (booking.payment_status === 'paid') return booking.status.startsWith('cancelled') ? { text: 'Vracíme', tone: 'muted' } : { text: 'Zaplaceno', tone: 'positive' };
  if (booking.status === 'capturing') return { text: 'Dokončujeme platbu', tone: 'muted' };
  if (booking.authorization_state === 'release_pending') return { text: 'Uvolňujeme blokaci', tone: 'muted' };
  // The customer never finished paying, so there was no hold to release.
  if (booking.authorization_state === 'released' && booking.authorized_at === null) return { text: 'Nic nestrženo', tone: 'muted' };
  if (booking.authorization_state === 'released') return { text: 'Blokace uvolněna', tone: 'muted' };
  if (booking.authorization_state === 'authorized') return { text: 'Jen zablokováno', tone: 'muted' };
  // A booking that ended before any money moved has nothing left to verify.
  const ended = ['expired', 'rejected', 'payment_failed', 'cancelled_by_customer', 'cancelled_by_merchant'].includes(booking.status);
  if (booking.payment_status === 'failed' || (booking.payment_status === 'pending' && ended)) return { text: 'Nic nestrženo', tone: 'muted' };
  if (booking.payment_status === 'pending') return { text: 'Ověřujeme platbu', tone: 'muted' };
  return null;
}
