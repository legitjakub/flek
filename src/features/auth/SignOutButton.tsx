import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { cx } from '../../components/ui';
import { useRouter } from '../../app/router';

/**
 * One sign-out, used everywhere.
 *
 * It used to exist only on the customer Profile screen. An administrator or a merchant had
 * no way out of their own console: they had to leave for the customer app, find a profile
 * page that is not about their role at all, and sign out there. On a shared counter machine
 * that is not an inconvenience, it is an open session.
 *
 * The cache is cleared after the sign-out, not before: what one account fetched must never
 * be readable by whoever signs in next.
 */
export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const { navigate } = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      aria-label={busy ? 'Odhlašuji účet' : 'Odhlásit se'}
      title={compact ? (busy ? 'Odhlašuji…' : 'Odhlásit se') : undefined}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { error } = await supabase.auth.signOut();
          if (error) await supabase.auth.signOut({ scope: 'local' });
        } catch {
          await supabase.auth.signOut({ scope: 'local' });
        } finally {
          // A failed remote revocation still falls back to deleting the browser session.
          // Cached account data must never be readable by whoever signs in next.
          queryClient.clear();
          navigate('/');
        }
      }}
      className={cx(
        'inline-flex min-h-11 shrink-0 items-center gap-2 font-bold transition-colors disabled:opacity-55',
        compact
          ? 'min-w-11 justify-center text-sm text-muted hover:text-danger sm:min-w-0'
          : 'rounded-xl border border-line bg-card px-3 text-sm text-ink hover:border-danger hover:text-danger',
      )}
    >
      <LogOut size={16} aria-hidden="true" />
      <span className={compact ? 'hidden sm:inline' : undefined}>{busy ? 'Odhlašuji…' : 'Odhlásit se'}</span>
    </button>
  );
}
