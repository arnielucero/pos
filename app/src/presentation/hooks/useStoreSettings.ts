import { useQuery } from '@tanstack/react-query';
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from '../../domain/entities/Settings';
import { useContainer } from './ContainerContext';

export function useStoreSettings(): StoreSettings {
  const { settings } = useContainer();
  const q = useQuery({ queryKey: ['store-settings'], queryFn: () => settings.getStoreSettings(), staleTime: 30_000 });
  return q.data ?? DEFAULT_STORE_SETTINGS;
}
