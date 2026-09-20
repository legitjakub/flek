import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authProviders, type OAuthProvider } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import { Button } from '../../components/ui';
import { privacyPublished, useLegalInfo } from '../legal/useLegal';

const LABELS: Record<OAuthProvider, string> = { apple: 'Apple', google: 'Google' };

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="size-5 shrink-0">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 shrink-0" fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

/**
 * Sign-in with Apple or Google. A button appears only once its provider is switched on in Supabase
 * Auth, so the page stays as it is until the keys exist. The first sign-in creates the account, which
 * is why the age and privacy line sits right under the buttons.
 */
export function SocialSignIn({ formal, returnTo, merchant }: { formal: boolean; returnTo: string; merchant: boolean }) {
  const providers = useQuery({ queryKey: ['auth-providers'], queryFn: authProviders, staleTime: 3_600_000 });
  const legal = useLegalInfo();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const enabled = (['apple', 'google'] as const).filter((provider) => providers.data?.[provider]);
  if (!enabled.length) return null;

  async function start(provider: OAuthProvider) {
    setBusy(provider);
    setFailure(null);
    const params = new URLSearchParams({ oauth: provider, returnTo });
    if (merchant) params.set('role', 'merchant');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/prihlaseni?${params}` },
    });
    // On success the browser is already on its way to the provider.
    if (error) {
      setBusy(null);
      setFailure(errorMessage(error, formal ? 'merchant' : 'customer'));
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      {enabled.map((provider) => (
        <Button
          key={provider}
          size="lg"
          variant={provider === 'apple' ? 'primary' : 'secondary'}
          loading={busy === provider}
          disabled={busy !== null && busy !== provider}
          onClick={() => void start(provider)}
        >
          {busy === provider ? null : provider === 'apple' ? <AppleMark /> : <GoogleMark />}
          Pokračovat přes {LABELS[provider]}
        </Button>
      ))}
      <p className="text-sm leading-relaxed text-muted">
        {formal
          ? 'Když účet ještě nemáte, vytvoří se. Pokračováním potvrzujete, že je vám aspoň 18 let.'
          : 'Když účet ještě nemáš, vytvoří se. Pokračováním potvrzuješ, že je ti aspoň 18 let.'}
        {privacyPublished(legal.data) ? (
          <>
            {' '}{formal ? 'Jak nakládáme s údaji, popisují' : 'Jak nakládáme s tvými údaji, popisují'}{' '}
            <a href="/soukromi" target="_blank" rel="noopener" className="font-bold text-ink underline underline-offset-4">Zásady ochrany osobních údajů</a>.
          </>
        ) : null}
      </p>
      {failure ? <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm font-medium text-ink">{failure}</p> : null}
      <p className="flex items-center gap-3 text-sm text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />nebo e-mailem<span className="h-px flex-1 bg-line" />
      </p>
    </div>
  );
}
