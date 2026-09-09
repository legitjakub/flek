import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, MailWarning } from 'lucide-react';
import { Link, useRouter } from '../../app/router';
import { Button, Wordmark } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { useSession } from './session';

const PENDING_SIGNUP_KEY = 'flek.pending-signup';
type PendingSignup = { email?: string; returnTo?: string; merchant?: boolean };
type State = 'checking' | 'success' | 'login' | 'error';

function safeTarget(value: unknown) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function readPending(): PendingSignup {
  try {
    return JSON.parse(localStorage.getItem(PENDING_SIGNUP_KEY) ?? '{}') as PendingSignup;
  } catch {
    return {};
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_SIGNUP_KEY);
  } catch {
    // The confirmation itself is already complete; unavailable storage must not hide that.
  }
}

/** Handles both the cross-device token-hash template and Supabase's default PKCE callback. */
export function ConfirmationPage() {
  const { session, ready } = useSession();
  const { search } = useRouter();
  const pending = useRef(readPending());
  const attempted = useRef(false);
  const [state, setState] = useState<State>('checking');
  const [message, setMessage] = useState('Ověřujeme potvrzovací odkaz…');

  const metadataTarget = session?.user.user_metadata?.signup_return_to;
  const target = safeTarget(metadataTarget ?? pending.current.returnTo);
  const merchant = session?.user.user_metadata?.signup_role === 'merchant' || pending.current.merchant;

  useEffect(() => {
    // detectSessionInUrl may finish while our explicit callback handler is running. A real
    // session is authoritative and always wins over a transient PKCE exchange error.
    if (!session) return;
    setState('success');
    setMessage('E-mail je potvrzený a účet je připravený.');
    clearPending();
  }, [session]);

  useEffect(() => {
    if (!ready || attempted.current) return;
    attempted.current = true;

    async function confirm() {
      if (session) {
        setState('success');
        setMessage('E-mail je potvrzený a účet je připravený.');
        clearPending();
        return;
      }

      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const callbackError = search.get('error_description') ?? hash.get('error_description');
      if (callbackError) {
        setState('error');
        setMessage(/expired/i.test(callbackError) ? 'Potvrzovací odkaz vypršel.' : 'Potvrzovací odkaz není platný nebo už byl použitý.');
        return;
      }

      const tokenHash = search.get('token_hash') ?? hash.get('token_hash');
      const code = search.get('code');
      if (!tokenHash && !code) {
        setState('login');
        setMessage('Odkaz neobsahuje ověřovací údaje. Pokud už jsi e-mail potvrdil/a, stačí se přihlásit.');
        return;
      }

      const result = tokenHash
        ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
        : await supabase.auth.exchangeCodeForSession(code as string);

      if (!result.error) {
        setState('success');
        setMessage('E-mail je potvrzený a účet je připravený.');
        clearPending();
        window.history.replaceState({}, '', '/potvrzeni');
        return;
      }

      // A PKCE link opened on another device can confirm the address but cannot recover the
      // first browser's verifier. Logging in with the chosen password is the correct recovery.
      if (/verifier|pkce|code exchange/i.test(result.error.message)) {
        setState('login');
        setMessage('E-mail je nejspíš potvrzený. Odkaz se otevřel v jiném prohlížeči, proto se teď přihlas heslem.');
      } else {
        setState('error');
        setMessage(/expired/i.test(result.error.message) ? 'Potvrzovací odkaz vypršel.' : 'Potvrzení se nepodařilo. Nech si poslat nový odkaz.');
      }
    }

    void confirm();
  }, [ready, search, session]);

  const loginHref = `/prihlaseni?${merchant ? 'role=merchant&' : ''}returnTo=${encodeURIComponent(target)}`;
  const signupHref = `/prihlaseni?${merchant ? 'role=merchant&' : ''}mode=signup&returnTo=${encodeURIComponent(target)}`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-8 sm:justify-center sm:py-14">
      <Link to="/" aria-label="FLEK — domů" className="inline-flex min-h-11 self-start items-center">
        <Wordmark suffix={merchant ? 'Partner' : undefined} />
      </Link>
      <section className="mt-6 rounded-2xl bg-card p-5 text-center shadow-card sm:p-7" aria-live="polite">
        <span className={`mx-auto grid size-14 place-items-center rounded-full ${state === 'success' ? 'bg-positive/10 text-positive' : state === 'checking' ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning'}`}>
          {state === 'success' ? <CheckCircle2 size={28} aria-hidden="true" /> : <MailWarning size={27} aria-hidden="true" />}
        </span>
        <h1 className="mt-4 text-xl font-extrabold text-ink">
          {state === 'checking' ? 'Potvrzujeme e-mail' : state === 'success' ? 'E-mail je potvrzený' : 'Dokonči přihlášení'}
        </h1>
        <p className="mt-2 leading-relaxed text-muted">{message}</p>
        {state === 'success' ? (
          <Link to={target} className="btn-primary mt-5 w-full">
            {merchant ? 'Pokračovat do správy provozovny' : 'Pokračovat do aplikace'}
          </Link>
        ) : state === 'login' || state === 'error' ? (
          <div className="mt-5 flex flex-col gap-2">
            <Link to={loginHref} className="btn-primary w-full">Přihlásit se</Link>
            <Link to={signupHref} className="inline-flex min-h-11 items-center justify-center text-sm font-bold text-ink underline underline-offset-4">
              Poslat nový potvrzovací e-mail
            </Link>
          </div>
        ) : (
          <Button className="mt-5 w-full" loading disabled>Ověřujeme</Button>
        )}
      </section>
    </main>
  );
}
