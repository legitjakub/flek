import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { isAdmin, myProfile } from '../../lib/api';
import type { Profile } from '../../types/database';

type SessionValue = {
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  admin: boolean;
  ready: boolean;
};

const SessionContext = createContext<SessionValue>({
  session: null,
  userId: null,
  profile: null,
  admin: false,
  ready: false,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
      // Identity changed: every cached row was fetched under the previous JWT.
      queryClient.clear();
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  const userId = session?.user.id ?? null;

  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => myProfile(userId as string),
    enabled: Boolean(userId),
  });

  // Routing-only hint. Every admin capability is re-verified in SQL by is_admin().
  const adminQuery = useQuery({ queryKey: ['is-admin', userId], queryFn: isAdmin, enabled: Boolean(userId) });

  const value = useMemo<SessionValue>(
    () => ({
      session,
      userId,
      profile: profileQuery.data ?? null,
      admin: adminQuery.data === true,
      ready,
    }),
    [session, userId, profileQuery.data, adminQuery.data, ready],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

export function hasPhone(profile: Profile | null): boolean {
  return Boolean(profile?.phone && profile.phone.replace(/\D/g, '').length >= 9);
}
