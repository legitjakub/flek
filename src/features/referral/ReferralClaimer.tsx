import { useEffect, useRef } from 'react';
import { claimReferral } from '../../lib/api';
import { useSession } from '../auth/session';
import { clearReferral, pendingReferral } from './pending';

/**
 * Renders nothing. It exists because the moment attribution becomes possible — the first
 * time a session exists — is not tied to any one screen: a person may sign up from the
 * booking sheet, sign in days later, or come back through an e-mail confirmation link in a
 * fresh tab. Watching the session rather than a route catches all three.
 *
 * Every rule that matters (no self-referral, one referrer per account, established accounts
 * cannot be claimed) is enforced in the database. This only hands over a code.
 */
export function ReferralClaimer() {
  const { userId } = useSession();
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    const code = pendingReferral();
    if (!code) return;
    // One attempt per session per code: the RPC is idempotent, but there is no reason to
    // call it again on every re-render caused by a token refresh.
    if (attempted.current === `${userId}:${code}`) return;
    attempted.current = `${userId}:${code}`;

    void claimReferral(code)
      .then((outcome) => {
        // Clear on any settled answer. A code that was refused will be refused for ever —
        // keeping it would retry a hopeless call on every sign-in.
        if (outcome.claimed || outcome.reason !== null) clearReferral();
      })
      .catch(() => {
        // A network failure is the one case worth retrying, so the code stays put.
      });
  }, [userId]);

  return null;
}
