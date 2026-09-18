import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acceptMerchantTerms, businessBilling } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { Banner, Button } from '../../components/ui';
import type { Business } from '../../types/database';
import { legalDate } from '../legal/useLegal';

/**
 * Terms for venues the member has not accepted yet: the version in force (publishing waits for it)
 * or an announced one, at least 15 days before it applies. Accepting here is recorded by the server.
 */
export function MerchantTermsNotice({ business }: { business: Business }) {
  const queryClient = useQueryClient();
  const billing = useQuery({
    queryKey: ['business-billing', business.id],
    queryFn: () => businessBilling(business.id),
    staleTime: 60_000,
  });
  const accept = useMutation({
    mutationFn: (version: string) => acceptMerchantTerms(business.id, version),
    onSuccess: (data) => queryClient.setQueryData(['business-billing', business.id], data),
  });
  const data = billing.data;
  if (!data) return null;

  const current = data.terms_current && !data.terms_accepted_current ? data.terms_current : null;
  const upcoming = !current && data.terms_upcoming && !data.terms_upcoming_accepted ? data.terms_upcoming : null;
  const version = current ?? upcoming;
  if (!version) return null;

  return (
    <div className="mb-4">
      <Banner tone={current ? 'warning' : 'info'}>
        <p>
          {current
            ? `Pro zveřejňování FLEKů potřebujeme váš souhlas s obchodními podmínkami pro podniky (verze ${version}).`
            : `Od ${data.terms_upcoming_at ? legalDate(data.terms_upcoming_at) : 'blízké doby'} platí nová verze obchodních podmínek pro podniky (${version}).`}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href="/podminky-podniky" target="_blank" rel="noopener" className="inline-flex min-h-11 items-center font-bold underline underline-offset-4">
            Přečíst podmínky
          </a>
          <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate(version)}>
            Souhlasím
          </Button>
        </div>
        {accept.isError ? <p className="mt-2 text-sm font-medium text-danger">{errorMessage(accept.error, 'merchant')}</p> : null}
      </Banner>
    </div>
  );
}
