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
  | 'rejected'
  | 'timeout'
  | 'checkout_timeout'
  | 'customer_cancelled'
  | 'offer_cancelled'
  | 'capture_failed'
  | 'payment_failed'
  | 'not_finished'
  | 'refunding';

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
};

const RELEASE = 'Platbu jsme nezachytili a blokaci částky na kartě uvolňujeme.';

export function confirmationView(state: Facts | null | undefined, returnedWithoutPaying = false): ConfirmationView {
  if (!state) return { kind: 'verifying', title: 'Ověřujeme platbu', body: 'Obvykle to trvá pár sekund.', live: true, action: null };
  if (state.reservation_code) {
    return { kind: 'confirmed', title: '🔥 FLEK je tvůj!', body: 'Podnik rezervaci potvrdil.', live: false, action: 'bookings' };
  }
  // Captured money that could not become a booking is the one case that is a refund.
  if (state.refund_requested || state.status === 'refunded') {
    return {
      kind: 'refunding', title: 'Rezervaci se nepodařilo dokončit',
      body: 'Platbu jsme už zachytili, a proto ti ji celou vracíme na kartu. Na výpisu se obvykle objeví do 5–10 pracovních dnů.',
      live: false, action: 'find_other',
    };
  }
  switch (state.booking_status) {
    case 'pending_payment':
      return returnedWithoutPaying
        ? { kind: 'not_finished', title: 'Platba nebyla dokončena', body: 'Nic jsme nestrhli a termín ti už nedržíme.', live: false, action: 'retry' }
        : { kind: 'verifying', title: 'Ověřujeme platbu', body: 'Obvykle to trvá pár sekund. Potom pošleme rezervaci podniku k potvrzení.', live: true, action: null };
    case 'pending_merchant':
      return {
        kind: 'waiting', title: 'Čekáme na potvrzení podniku',
        body: 'Držíme ti tenhle FLEK. Částku máš na kartě jen zablokovanou; strhneme ji, až podnik rezervaci potvrdí.',
        live: true, action: 'cancel_request',
      };
    case 'capturing':
      return {
        kind: 'capturing', title: 'Potvrzujeme FLEK…',
        body: 'Podnik rezervaci potvrdil. Dokončujeme platbu a za pár sekund uvidíš rezervační kód.', live: true, action: null,
      };
    case 'rejected':
      return { kind: 'rejected', title: 'Tentokrát to nevyšlo', body: `Podnik rezervaci nepotvrdil. ${RELEASE}`, live: false, action: 'find_other' };
    case 'expired':
      return state.authorized_at
        ? { kind: 'timeout', title: 'Podnik nepotvrdil včas', body: `Čas na potvrzení vypršel. ${RELEASE}`, live: false, action: 'find_other' }
        : {
          kind: 'checkout_timeout', title: 'Čas na zaplacení vypršel',
          body: 'Termín jsme ti drželi jen pár minut. Nic jsme nestrhli, a pokud se částka na kartě přesto zablokovala, blokace se uvolní.',
          live: false, action: 'retry',
        };
    case 'cancelled_by_customer':
      return { kind: 'customer_cancelled', title: 'Žádost je zrušená', body: RELEASE, live: false, action: 'find_other' };
    case 'cancelled_by_merchant':
      return { kind: 'offer_cancelled', title: 'Podnik termín zrušil', body: RELEASE, live: false, action: 'find_other' };
    case 'payment_failed':
      return state.merchant_decided_at || state.failure_reason === 'CAPTURE_FAILED'
        ? {
          kind: 'capture_failed', title: 'Podnik potvrdil, ale platbu se nepodařilo dokončit',
          body: 'Nic jsme nestrhli a blokaci na kartě uvolňujeme. Zkus to prosím znovu, případně s jinou kartou.',
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
  if (left.seconds === 0) return 'Čas na potvrzení vypršel. Uvolňujeme blokaci…';
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
