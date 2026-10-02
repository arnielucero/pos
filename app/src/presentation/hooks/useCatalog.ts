import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ProductWithStock } from '../../domain/entities/Product';
import { useContainer } from './ContainerContext';
import { useSyncState } from './useAppState';

export function useProductSearch(term: string, category: string | null) {
  const { useCases } = useContainer();
  const query = useInfiniteQuery({
    queryKey: ['products', term, category],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => useCases.searchProducts.execute({ term, category, page: pageParam }),
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length : undefined),
  });
  const items: ProductWithStock[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  return { ...query, items };
}

export function useCategories() {
  const { useCases } = useContainer();
  return useQuery({ queryKey: ['categories'], queryFn: () => useCases.searchProducts.categories() });
}

/** Refreshes catalog/transaction queries whenever a sync run completes. */
export function useInvalidateOnSync(): void {
  const client = useQueryClient();
  const { lastSyncAt, counts } = useSyncState();
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ['products'] });
    void client.invalidateQueries({ queryKey: ['categories'] });
    void client.invalidateQueries({ queryKey: ['sales'] });
  }, [client, lastSyncAt, counts.pending, counts.failed]);
}
