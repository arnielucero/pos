import { useEffect, useState, useSyncExternalStore } from 'react';
import type { NetworkState } from '../../application/ports/Network';
import type { SessionState } from '../../application/session/SessionManager';
import type { SyncEngineState } from '../../infrastructure/synchronization/SyncEngine';
import { useContainer } from './ContainerContext';

export function useSession(): SessionState {
  const { session } = useContainer();
  return useSyncExternalStore(session.subscribe, session.getState);
}

export function useSyncState(): SyncEngineState {
  const { sync } = useContainer();
  return useSyncExternalStore(sync.subscribe, sync.getState);
}

export function useNetworkState(): NetworkState {
  const { network } = useContainer();
  const [state, setState] = useState<NetworkState>(() => network.current());
  useEffect(() => network.subscribe(setState), [network]);
  return state;
}

export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(t);
    };
  }, [value, delayMs]);
  return debounced;
}
