import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Link } from '../../app/router';
import { Button, SettingsRow, Sheet } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { useSession } from '../auth/session';
import { WhatsAppSettingsSection, useWhatsAppSettings } from './WhatsApp';

type Notice = {
  id: string;
  title: string;
  body: string;
  href: string;
  business_id: string | null;
  read_at: string | null;
  created_at: string;
};

type Preference = {
  event: 'requested' | 'confirmed' | 'cancelled' | 'review_requested' | 'watch';
  email: boolean;
  push: boolean;
  /** On unless switched off; messages go only to a verified number. */
  whatsapp: boolean;
};

type Channel = 'email' | 'push' | 'whatsapp';

const DEFAULTS: Record<Channel, boolean> = { email: true, push: false, whatsapp: true };

export const NOTIFICATIONS_ENABLED = import.meta.env.VITE_NOTIFICATIONS_ENABLED === 'true';

/*
 * A watch is the one thing FLEK sends on its own initiative, so it starts the other way round:
 * on the phone by default (that is what makes it useful), by e-mail only when switched on.
 */
const WATCH_DEFAULTS: Record<Channel, boolean> = { email: false, push: true, whatsapp: false };

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}

export function NotificationBell({ businessId }: { businessId?: string }) {
  const { userId } = useSession();
  const [open, setOpen] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('notifications') === '1',
  );
  const [failure, setFailure] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ['notifications', userId];
  const query = useQuery({
    queryKey,
    queryFn: () => rpc<Notice[]>('my_notifications'),
    enabled: NOTIFICATIONS_ENABLED && Boolean(userId),
    refetchInterval: 20_000,
  });

  if (!NOTIFICATIONS_ENABLED || !userId) return null;

  const notices = (query.data ?? []).filter((notice) => (
    businessId ? notice.business_id === businessId : notice.business_id === null
  ));
  const unread = notices.filter((notice) => !notice.read_at).length;

  async function markRead(id: string) {
    try {
      await rpc('read_notification', { p_id: id });
      await queryClient.invalidateQueries({ queryKey });
    } catch {
      setFailure(true);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Upozornění${unread ? `, ${unread} nepřečtených` : ''}`}
        onClick={() => setOpen(true)}
        className="relative grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-accent-soft"
      >
        <Bell size={20} aria-hidden="true" />
        {unread > 0 ? (
          <span className="absolute right-0 top-0 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-ink ring-2 ring-card">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Upozornění">
        {query.isError ? (
          <div role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
            <p>Upozornění se nepodařilo načíst.</p>
            <Button variant="ghost" className="mt-2" onClick={() => void query.refetch()}>Zkusit znovu</Button>
          </div>
        ) : query.isPending ? (
          <p className="text-sm text-muted">Načítání…</p>
        ) : notices.length === 0 ? (
          <p className="rounded-2xl bg-surface p-5 text-sm text-muted">Zatím tu nemáš žádná upozornění.</p>
        ) : (
          <ul className="divide-y divide-line">
            {notices.map((notice) => (
              <li key={notice.id} className="py-2">
                <Link
                  to={notice.href}
                  onClick={() => {
                    setOpen(false);
                    if (!notice.read_at) void markRead(notice.id);
                  }}
                  className="block min-h-11 rounded-xl px-2 py-2 hover:bg-surface"
                >
                  <span className="flex items-start gap-2">
                    {!notice.read_at ? <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-label="Nepřečtené" /> : null}
                    <span className="min-w-0">
                      <strong className={notice.read_at ? 'text-muted' : 'text-ink'}>{notice.title}</strong>
                      <span className="mt-1 block text-sm leading-relaxed text-muted">{notice.body}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {failure ? <p role="alert" className="mt-3 text-sm text-danger">Změnu se nepodařilo uložit.</p> : null}
      </Sheet>
    </>
  );
}

export async function disableDevicePush() {
  if (!NOTIFICATIONS_ENABLED || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  await rpc('remove_push_subscription', { p_endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - value.length % 4) % 4)}`;
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Whether this device already sends FLEK's notifications to the phone. */
export async function devicePushEnabled(): Promise<boolean> {
  try {
    if (!NOTIFICATIONS_ENABLED || !('serviceWorker' in navigator) || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(await registration?.pushManager?.getSubscription());
  } catch {
    return false;
  }
}

/** Asks for permission and registers this device for push. Throws a sentence the screen can show. */
export async function enableDevicePush() {
  if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) {
    throw new Error('Tento prohlížeč oznámení nepodporuje. Na iPhonu přidej FLEK na plochu a otevři ho odtud. E-mail zůstává dostupný.');
  }
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error('Oznámení na telefonu ještě nejsou aktivovaná. Použij zatím e-mail a centrum upozornění.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Oznámení nejsou povolená. Povolení můžeš změnit v nastavení prohlížeče.');
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });
  await rpc('save_push_subscription', { p_subscription: subscription.toJSON() });
}

const EVENT_LABELS: Record<Preference['event'], string> = {
  requested: 'Nová žádost o rezervaci',
  confirmed: 'Potvrzená rezervace',
  cancelled: 'Zrušená rezervace',
  review_requested: 'Připomenutí hodnocení',
  watch: 'Hlídač FLEKů',
};

/* The phone first: it is the channel a customer actually chooses, e-mail about a booking always goes. */
const COLUMNS: Channel[] = ['push', 'email', 'whatsapp'];
const CHANNEL_LABELS: Record<Channel, { short: string; long: string }> = {
  push: { short: 'Telefon', long: 'Oznámení na telefonu' },
  email: { short: 'E-mail', long: 'E-mail' },
  whatsapp: { short: 'WhatsApp', long: 'WhatsApp' },
};

/** What each event can be sent by: a review reminder only to the phone, a watch never on WhatsApp. */
function offered(event: Preference['event'], channel: Channel) {
  if (event === 'review_requested') return channel === 'push';
  if (event === 'watch') return channel !== 'whatsapp';
  return true;
}

/** Whether this device gets push, read again after the person switches it on or off here. */
function useDevicePush() {
  const [on, setOn] = useState<boolean | null>(null);
  const [check, setCheck] = useState(0);
  useEffect(() => {
    let live = true;
    void devicePushEnabled().then((value) => {
      if (live) setOn(value);
    });
    return () => {
      live = false;
    };
  }, [check]);
  return { on, refresh: () => setCheck((count) => count + 1) };
}

function usePreferences(businessId?: string) {
  const { userId } = useSession();
  const scope = businessId ?? 'customer';
  const formal = Boolean(businessId);
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const queryKey = ['notification-preferences', userId, scope];
  const query = useQuery({
    queryKey,
    queryFn: () => rpc<Preference[]>('my_notification_preferences', { p_scope: scope }),
    enabled: NOTIFICATIONS_ENABLED && Boolean(userId),
  });
  // WhatsApp gets its column once FLEK has a number to send from, like the other channels: on by default.
  const whatsapp = useWhatsAppSettings(businessId);
  const device = useDevicePush();
  const channels = COLUMNS.filter((channel) => channel !== 'whatsapp' || whatsapp.data?.available);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setMessage('');
    try {
      setMessage(await work());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nastavení se nepodařilo uložit.');
    } finally {
      device.refresh();
      setBusy(false);
    }
  }

  const save = (event: Preference['event'], channel: Channel, value: boolean) => run(async () => {
    if (channel === 'push' && value) await enableDevicePush();
    const current = query.data?.find((preference) => preference.event === event) ?? (event === 'watch' ? WATCH_DEFAULTS : DEFAULTS);
    await rpc('save_notification_preference', {
      p_scope: scope,
      p_event: event,
      p_email: channel === 'email' ? value : current.email,
      p_push: channel === 'push' ? value : current.push,
      p_whatsapp: channel === 'whatsapp' ? value : current.whatsapp,
    });
    await queryClient.invalidateQueries({ queryKey });
    return 'Nastavení je uložené.';
  });
  const deviceOn = () => run(async () => {
    await enableDevicePush();
    return 'Oznámení na tomto zařízení jsou zapnutá.';
  });
  const deviceOff = () => run(async () => {
    try {
      await disableDevicePush();
    } catch {
      throw new Error('Zařízení se nepodařilo odpojit.');
    }
    return 'Oznámení na tomto zařízení jsou odpojená.';
  });

  return { formal, query, whatsapp, device, channels, busy, message, save, deviceOn, deviceOff };
}

type Preferences = ReturnType<typeof usePreferences>;

/**
 * Events down, channels across: one short table instead of a block of checkboxes per event.
 * Each box keeps a 44 px target and says in full what it switches for a screen reader.
 */
function PreferenceTable({ preferences }: { preferences: Preferences }) {
  const { formal, query, channels, busy, save } = preferences;
  const events = formal ? (['requested', 'confirmed', 'cancelled'] as const) : (['confirmed', 'cancelled', 'review_requested', 'watch'] as const);

  if (query.isError) {
    return (
      <div role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
        <p>Nastavení se nepodařilo načíst.</p>
        <Button variant="ghost" className="mt-2" onClick={() => void query.refetch()}>Zkusit znovu</Button>
      </div>
    );
  }

  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <th scope="col" className="pb-1"><span className="sr-only">Událost</span></th>
          {channels.map((channel) => (
            <th key={channel} scope="col" className="w-15 pb-1 text-center text-xs font-bold text-muted sm:w-20">
              {CHANNEL_LABELS[channel].short}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {events.map((event) => {
          const current = query.data?.find((preference) => preference.event === event);
          const defaults = event === 'watch' ? WATCH_DEFAULTS : DEFAULTS;
          return (
            <tr key={event} className="border-t border-line">
              <th scope="row" className="py-1 pr-2 text-sm leading-snug font-bold text-ink">{EVENT_LABELS[event]}</th>
              {channels.map((channel) => (
                <td key={channel} className="text-center">
                  {!offered(event, channel) ? (
                    <>
                      <span aria-hidden="true" className="text-muted">–</span>
                      <span className="sr-only">Neposíláme</span>
                    </>
                  ) : !formal && channel === 'email' && event !== 'watch' ? (
                    // The customer's e-mail about a booking confirms the contract, so the server always sends it.
                    <span className="text-xs font-bold text-muted">vždy</span>
                  ) : (
                    <label className="inline-grid size-11 cursor-pointer place-items-center rounded-xl hover:bg-surface">
                      <input
                        type="checkbox"
                        className="size-5 accent-accent"
                        aria-label={`${EVENT_LABELS[event]}: ${CHANNEL_LABELS[channel].long}`}
                        checked={current?.[channel] ?? defaults[channel]}
                        disabled={busy || query.isPending}
                        onChange={(input) => void save(event, channel, input.target.checked)}
                      />
                    </label>
                  )}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Everything under the table: this device's push, what WhatsApp still needs, and the last result. */
function PreferenceNotes({ preferences }: { preferences: Preferences }) {
  const { formal, whatsapp, device, busy, message, deviceOn, deviceOff } = preferences;
  return (
    <>
      {device.on === false ? (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-surface p-3">
          <p className="min-w-0 flex-1 text-sm text-ink">
            {formal ? 'Na tomto zařízení máte oznámení vypnutá.' : 'Na tomhle zařízení máš oznámení vypnutá.'}
          </p>
          <Button size="sm" variant="brand" shape={formal ? 'rounded' : 'pill'} disabled={busy} onClick={() => void deviceOn()}>
            Zapnout
          </Button>
        </div>
      ) : null}
      {/* In Profil the WhatsApp block follows right under the table and says the same itself. */}
      {formal && whatsapp.data?.available && whatsapp.data.status !== 'verified' ? (
        <p className="mt-3 text-sm text-muted">Na WhatsApp začnou zprávy chodit, až níže ověříte číslo.</p>
      ) : null}
      {formal && whatsapp.data?.status === 'verified' && !whatsapp.data.mine ? (
        <p className="mt-3 text-sm text-muted">Na WhatsApp provozovny chodí zprávy podle nastavení člena, který číslo ověřil.</p>
      ) : null}
      {device.on ? (
        <Button variant="ghost" size="sm" shape={formal ? 'rounded' : 'pill'} className="mt-2 -ml-2.5" disabled={busy} onClick={() => void deviceOff()}>
          Odpojit oznámení na tomto zařízení
        </Button>
      ) : null}
      {message ? <p role="status" className="mt-2 text-sm text-muted">{message}</p> : null}
    </>
  );
}

/** Provozovna: the venue's own settings, one card with the table. */
export function NotificationSettings({ businessId }: { businessId: string }) {
  const { userId } = useSession();
  const preferences = usePreferences(businessId);
  if (!NOTIFICATIONS_ENABLED || !userId) return null;
  return (
    <section className="rounded-2xl bg-card p-5 shadow-card sm:p-6">
      <h2 className="text-lg font-extrabold tracking-tight text-ink">Upozornění na rezervace</h2>
      <p className="mt-1 mb-3 text-sm text-muted">Vyberte, jak vás upozorníme. Zprávy v aplikaci zůstávají dostupné vždy.</p>
      <PreferenceTable preferences={preferences} />
      <PreferenceNotes preferences={preferences} />
    </section>
  );
}

function listCs(items: string[]) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} a ${items[items.length - 1]}`;
}

/**
 * Profil: one row in "Můj účet" that says where messages go and opens the table below itself,
 * so the settings are a tap away instead of a long block on the page. WhatsApp lives in the same
 * place, since it is only another way to be told.
 */
export function NotificationsRow() {
  const { userId } = useSession();
  const [open, setOpen] = useState(false);
  const preferences = usePreferences();
  const whatsapp = preferences.whatsapp.data;
  if (!userId || (!NOTIFICATIONS_ENABLED && !whatsapp?.available)) return null;

  const channels = [
    NOTIFICATIONS_ENABLED ? 'e-mail' : null,
    NOTIFICATIONS_ENABLED && preferences.device.on ? 'telefon' : null,
    whatsapp?.status === 'verified' ? 'WhatsApp' : null,
  ].filter((channel): channel is string => Boolean(channel));
  const hint = channels.length === 1 && channels[0] === 'e-mail'
    ? 'Chodí jen na e-mail'
    : channels.length ? `Chodí na ${listCs(channels)}` : 'Vyber si, kam ti dáme vědět';

  return (
    <>
      <SettingsRow
        icon={<Bell size={20} />}
        label="Upozornění"
        hint={hint}
        expanded={open}
        controls="profil-upozorneni"
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <li id="profil-upozorneni" className="px-4 pt-1 pb-5">
          {NOTIFICATIONS_ENABLED ? (
            <>
              <PreferenceTable preferences={preferences} />
              <PreferenceNotes preferences={preferences} />
              <p className="mt-3 text-xs leading-relaxed text-muted">
                E-mail o potvrzení a zrušení rezervace chodí vždy, je to potvrzení tvé rezervace. Hlídač pošle nejvýš jednu
                zprávu za čtvrt hodiny, v noci mlčí a co přibude, pošle ráno v 7. Všechno najdeš i ve zvonečku nahoře.
              </p>
            </>
          ) : null}
          <WhatsAppSettingsSection embedded />
        </li>
      ) : null}
    </>
  );
}
