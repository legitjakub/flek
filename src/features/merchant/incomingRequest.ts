import type { BookingStatus, ConfirmationDecision } from '../../types/database';
import { decisionMessage } from './ConfirmationRequests';
import type { WaitingRequest } from './RequestRing';

/*
 * The full-screen request, like the counter tablets of food-delivery services: a new request takes
 * the whole screen until the venue answers it or puts it off with "Později". Put-off requests go
 * back to the ring bar; a new request takes the screen again. Nothing here is stored: it lasts as
 * long as the page, like the mute.
 */

type Listener = () => void;

const hidden = new Set<string>();
const listeners = new Set<Listener>();
let stamp = 0;

function emit() {
  stamp += 1;
  listeners.forEach((listener) => listener());
}

export function subscribeTakeover(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function takeoverVersion(): number {
  return stamp;
}

/** "Později": these requests leave the full screen and stay in the ring bar and the lists. */
export function hideRequests(ids: string[]) {
  ids.forEach((id) => hidden.add(id));
  emit();
}

/** "Zobrazit žádost" in the ring bar: everything that still waits comes back to the full screen. */
export function showRequests() {
  hidden.clear();
  emit();
}

/** What the full screen has to show, first to run out first; the caller passes them sorted. */
export function onScreen(waiting: WaitingRequest[], done: ReadonlySet<string> = new Set()): WaitingRequest[] {
  return waiting.filter((request) => !hidden.has(request.id) && !done.has(request.id));
}

/** How much of the answer window is left, from 1 when the request arrived to 0 at its deadline. */
export function timeShare(request: Pick<WaitingRequest, 'authorizedAt' | 'deadline'>, now: string): number {
  const end = Date.parse(request.deadline ?? '');
  if (!Number.isFinite(end)) return 0;
  const start = Date.parse(request.authorizedAt ?? '');
  // Without the moment it arrived, the shortest window the server gives stands in for it.
  const total = Number.isFinite(start) && end > start ? end - start : 5 * 60_000;
  return Math.min(1, Math.max(0, (end - Date.parse(now)) / total));
}

export type Outcome = {
  /** success celebrates, declined and info are neutral, warning says something did not happen. */
  tone: 'success' | 'declined' | 'info' | 'warning';
  title: string;
  text: string;
  /** A decision made here closes by itself; news about something that happened elsewhere waits to be read. */
  autoClose: boolean;
};

/** The server's answer to a button pressed on the full screen, never the button itself. */
export function decisionOutcome(result: ConfirmationDecision, accepted: boolean): Outcome {
  if (result.decided && result.status === 'capturing') {
    return {
      tone: 'success',
      title: 'Rezervace je potvrzená',
      text: 'Dokončujeme platbu zákazníka. Rezervační kód uvidíte v Rezervacích za pár sekund.',
      autoClose: true,
    };
  }
  if (result.decided && result.status === 'rejected') {
    return { tone: 'declined', title: 'Rezervaci jste odmítli', text: 'Zákazník nic nezaplatí a místo se vrátilo do nabídky.', autoClose: true };
  }
  const { text } = decisionMessage(result, accepted);
  return { ...endedTitle(result.status), text, autoClose: false };
}

/** A request that stopped waiting while it was on screen, without a button pressed here. */
export function endedOutcome(status: BookingStatus | undefined, deadlinePassed: boolean): Outcome {
  const expired = status === 'expired' || (deadlinePassed && (status === 'pending_merchant' || status === undefined));
  if (expired) {
    return {
      tone: 'warning',
      title: 'Žádost vypršela',
      text: 'Čas na potvrzení uplynul. Zákazník nic nezaplatí a místo se vrátilo do nabídky.',
      autoClose: false,
    };
  }
  switch (status) {
    case 'capturing':
    case 'confirmed':
    case 'completed':
      return { tone: 'info', title: 'Už je potvrzeno', text: 'Rezervaci potvrdil někdo jiný, nejspíš z jiného zařízení nebo z WhatsAppu.', autoClose: false };
    case 'rejected':
      return { tone: 'info', title: 'Už je odmítnuto', text: 'Žádost odmítl někdo jiný, nejspíš z jiného zařízení nebo z WhatsAppu.', autoClose: false };
    case 'cancelled_by_customer':
      return { tone: 'warning', title: 'Zákazník žádost zrušil', text: 'Nic nezaplatil a vy už nic dělat nemusíte.', autoClose: false };
    default:
      return { tone: 'info', title: 'Žádost už skončila', text: 'Na tuhle žádost už reagovat nemusíte.', autoClose: false };
  }
}

function endedTitle(status: BookingStatus): Pick<Outcome, 'tone' | 'title'> {
  switch (status) {
    case 'expired':
      return { tone: 'warning', title: 'Žádost vypršela' };
    case 'cancelled_by_customer':
      return { tone: 'warning', title: 'Zákazník žádost zrušil' };
    case 'capturing':
    case 'confirmed':
      return { tone: 'info', title: 'Už je potvrzeno' };
    case 'rejected':
      return { tone: 'info', title: 'Už je odmítnuto' };
    default:
      return { tone: 'info', title: 'Žádost už skončila' };
  }
}

/** The line under the buttons when more requests wait behind the one on screen. */
export function moreWaiting(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return 'Čeká ještě další žádost';
  if (count < 5) return `Čekají ještě další ${count} žádosti`;
  return `Čeká ještě dalších ${count} žádostí`;
}

/** The same, short enough for the top bar of a phone: "+1 žádost", "+3 žádosti", "+5 žádostí". */
export function moreShort(count: number): string {
  if (count === 1) return '+1 žádost';
  if (count < 5) return `+${count} žádosti`;
  return `+${count} žádostí`;
}
