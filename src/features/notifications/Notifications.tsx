import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Link } from '../../app/router';
import { Button, Sheet } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { useSession } from '../auth/session';

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
  event: 'requested' | 'confirmed' | 'cancelled';
  email: boolean;
  push: boolean;
};

const NOTIFICATIONS_ENABLED = import.meta.env.VITE_NOTIFICATIONS_ENABLED === 'true';

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

export function NotificationSettings({ businessId }: { businessId?: string }) {
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

  if (!NOTIFICATIONS_ENABLED || !userId) return null;

  async function save(event: Preference['event'], channel: 'email' | 'push', value: boolean) {
    setBusy(true);
    setMessage('');
    try {
      if (channel === 'push' && value) {
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

      const current = query.data?.find((preference) => preference.event === event) ?? { email: true, push: false };
      await rpc('save_notification_preference', {
        p_scope: scope,
        p_event: event,
        p_email: channel === 'email' ? value : current.email,
        p_push: channel === 'push' ? value : current.push,
      });
      await queryClient.invalidateQueries({ queryKey });
      setMessage('Nastavení je uložené.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nastavení se nepodařilo uložit.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-card p-5 shadow-card sm:p-6">
      <h2 className="text-lg font-extrabold tracking-tight text-ink">Upozornění na rezervace</h2>
      <p className="mt-1 text-sm text-muted">
        {formal ? 'Vyberte, jak vás upozorníme.' : 'Vyber si, jak tě upozorníme.'} Zprávy v aplikaci zůstávají dostupné vždy.
      </p>

      {query.isError ? (
        <div role="alert" className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          <p>Nastavení se nepodařilo načíst.</p>
          <Button variant="ghost" className="mt-2" onClick={() => void query.refetch()}>Zkusit znovu</Button>
        </div>
      ) : (
        (formal ? ['requested', 'confirmed', 'cancelled'] as const : ['confirmed', 'cancelled'] as const).map((event) => {
          const current = query.data?.find((preference) => preference.event === event);
          return (
            <fieldset key={event} className="mt-4 border-t border-line pt-3">
              <legend className="font-bold text-ink">{event === 'requested' ? 'Nová žádost o rezervaci' : event === 'confirmed' ? 'Potvrzená rezervace' : 'Zrušená rezervace'}</legend>
              <div className="mt-1 flex flex-wrap gap-x-5">
                {(['email', 'push'] as const).map((channel) => (
                  <label key={channel} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      className="size-5 accent-accent"
                      checked={current?.[channel] ?? channel === 'email'}
                      disabled={busy || query.isPending}
                      onChange={(eventTarget) => void save(event, channel, eventTarget.target.checked)}
                    />
                    {channel === 'email' ? 'E-mail' : 'Oznámení na telefonu'}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })
      )}

      <Button
        variant="ghost"
        className="mt-2"
        disabled={busy}
        onClick={async () => {
          try {
            await disableDevicePush();
            setMessage('Oznámení na tomto zařízení jsou odpojená.');
          } catch {
            setMessage('Zařízení se nepodařilo odpojit.');
          }
        }}
      >
        Odpojit oznámení na tomto zařízení
      </Button>
      {message ? <p role="status" className="mt-2 text-sm text-muted">{message}</p> : null}
    </section>
  );
}
