import { useQuery } from '@tanstack/react-query';
import { businessProvider } from '../../lib/api';
import { cx } from '../../components/ui';

/**
 * Who provides the service and that FLEK only brokers it — what a marketplace has to tell the
 * customer before the contract. The public demo says it is a demo rather than inventing a provider.
 */
export function ProviderLine({ businessId, className }: { businessId: string; className?: string }) {
  const provider = useQuery({
    queryKey: ['business-provider', businessId],
    queryFn: () => businessProvider(businessId),
    staleTime: 600_000,
  });
  const data = provider.data;
  if (!data) return null;
  return (
    <p className={cx('text-sm leading-relaxed text-muted', className)}>
      {data.demo
        ? 'Ukázkový podnik pro předvedení FLEKu, ne skutečný poskytovatel služby.'
        : `Službu poskytuje ${data.name}${data.ico ? `, IČO ${data.ico}` : ''}${data.address ? `, ${data.address}` : ''}. FLEK rezervaci zprostředkovává.`}
    </p>
  );
}
