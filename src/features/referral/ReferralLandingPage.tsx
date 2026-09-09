import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resolveReferralCode } from '../../lib/api';
import { track } from '../../lib/analytics';
import { Mark } from '../../components/ui';
import { Link } from '../../app/router';
import { rememberReferral } from './pending';

/**
 * Where an invitation link lands. It deliberately does not demand a sign-up: the code is
 * remembered, and the visitor is sent into the product to see whether it is worth an account
 * at all. Attribution is claimed later, by the server, once they actually have one.
 */
export function ReferralLandingPage({ code }: { code: string }) {
  const query = useQuery({
    queryKey: ['referral-code', code],
    queryFn: () => resolveReferralCode(code),
    staleTime: 5 * 60_000,
  });

  const valid = query.data?.valid === true;
  const firstName = query.data?.first_name ?? null;

  useEffect(() => {
    if (!valid) return;
    rememberReferral(code);
    track('referral_link_opened', {});
  }, [valid, code]);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-14 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Mark className="size-8" />
      </span>

      {query.isPending ? (
        <p className="mt-6 text-base text-muted">Načítáme pozvánku…</p>
      ) : valid ? (
        <>
          <h1 className="mt-6 text-2xl font-extrabold tracking-tight">
            {firstName ? `${firstName} tě zve na FLEK.` : 'Někdo tě zve na FLEK.'}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted">
            Volné termíny na poslední chvíli u pražských podniků — kadeřnictví, masáže, jóga, sport.
            Podniku by termín propadl, tak ho nabídne levněji.
          </p>
          <Link to="/" className="btn-primary mt-7 w-full">
            Objevit FLEKy
          </Link>
          <p className="mt-3 text-sm text-muted">
            Účet si založíš až ve chvíli, kdy budeš chtít termín chytit.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-6 text-2xl font-extrabold tracking-tight">Tahle pozvánka neplatí.</h1>
          <p className="mt-3 text-base leading-relaxed text-muted">
            Odkaz je nejspíš překlepnutý nebo už neexistuje. Na FLEK se ale dostaneš i tak.
          </p>
          <Link to="/" className="btn-primary mt-7 w-full">
            Objevit FLEKy
          </Link>
        </>
      )}
    </main>
  );
}
