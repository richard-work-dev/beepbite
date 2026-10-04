import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { useActor } from './actor-token-context';

interface DraftContextValue {
  scope: string | null;
  read: () => unknown;
  save: (value: unknown) => void;
}

const DraftContext = createContext<DraftContextValue>({ scope: null, read: () => undefined, save: () => {} });

// In-memory only: navigating between modules keeps the cashier's draft, but
// refreshing or signing out removes customer details from this cache.
export function POSDraftProvider({ children }: { children: ReactNode }) {
  const { user, activeOrganization, activeLocation } = useAuth();
  const { actor } = useActor();
  const cache = useRef(new Map<string, unknown>());
  const principal = user?.id || actor?.staff_id;
  const scope = principal && activeLocation?.id
    ? JSON.stringify([principal, actor?.staff_id || '', activeOrganization?.id || '', activeLocation.id])
    : null;
  useEffect(() => { if (!principal) cache.current.clear(); }, [principal]);
  const value = useMemo(() => ({
    scope,
    read: () => scope ? cache.current.get(scope) : undefined,
    save: (draft: unknown) => { if (scope) cache.current.set(scope, draft); },
  }), [scope]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function usePOSDraft<T>() {
  const context = useContext(DraftContext);
  return useMemo(() => ({ ...context, read: () => context.read() as T | undefined }), [context]);
}
