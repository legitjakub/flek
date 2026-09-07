import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { isAdmin, myProfile, serverClock } from '../../lib/api';
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

  // Only a real identity change invalidates the cache. Clearing on every auth event
  // (including the initial one and token refreshes) would discard in-flight queries.
  const knownUser = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const apply = (next: Session | null) => {
      if (!active) return;
      setSession(next);
      setReady(true);
      const nextUser = next?.user.id ?? null;
      if (knownUser.current !== undefined && knownUser.current !== nextUser) queryClient.clear();
      knownUser.current = nextUser;
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => apply(next));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  // Establish the server clock offset once at start-up, so day windows are right even on
  // a device whose clock is hours off. Eligibility is decided by the database regardless.
  useQuery({ queryKey: ['server-clock'], queryFn: serverClock, staleTime: 300_000, gcTime: Infinity });

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
