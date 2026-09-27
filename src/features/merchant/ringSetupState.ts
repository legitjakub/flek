/**
 * What the "Zapněte zvonění" card has to say on this device. Ringing in the open console needs
 * nothing but a tap (ringer.ts); what needs the venue's consent is the phone notification that
 * reaches them when the console is closed, so the card is about that permission.
 */
export type AlertSetupState =
  /** Nothing to ask: notifications are off in this build, still being checked, or already on. */
  | 'hidden'
  /** One tap asks the browser and registers this device. */
  | 'ask'
  /** The browser was told no before; only its site settings can undo that. */
  | 'denied'
  /** An iPhone in Safari: notifications come only from the app on the home screen. */
  | 'install'
  /** A browser without web push at all. */
  | 'unsupported';

export function alertSetupState(device: {
  enabled: boolean;
  /** Whether this device already has FLEK's notifications; null while it is being checked. */
  deviceOn: boolean | null;
  permission: NotificationPermission | 'unknown';
  pushSupported: boolean;
  ios: boolean;
  standalone: boolean;
}): AlertSetupState {
  if (!device.enabled || device.deviceOn !== false) return 'hidden';
  if (!device.pushSupported) return device.ios && !device.standalone ? 'install' : 'unsupported';
  if (device.permission === 'denied') return 'denied';
  return 'ask';
}
