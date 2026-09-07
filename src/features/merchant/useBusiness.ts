import { useQuery } from '@tanstack/react-query';
import { listServices, merchantMetrics, myBusinesses } from '../../lib/api';
import { useSession } from '../auth/session';

export function useMyBusinesses() {
  const { userId } = useSession();
  return useQuery({ queryKey: ['my-businesses', userId], queryFn: myBusinesses, enabled: Boolean(userId) });
}

export function useServices(businessId: string | null) {
  return useQuery({
    queryKey: ['services', businessId],
    queryFn: () => listServices(businessId as string),
    enabled: Boolean(businessId),
  });
}

export function useMerchantMetrics(businessId: string | null) {
  return useQuery({
    queryKey: ['merchant-metrics', businessId],
    queryFn: () => merchantMetrics(businessId as string),
    enabled: Boolean(businessId),
  });
}
