import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router';
import { ApprovalProvider } from '../presentation/components/ApprovalProvider';
import { ErrorBoundary } from '../presentation/components/ErrorBoundary';
import { ContainerContext } from '../presentation/hooks/ContainerContext';
import { bootstrap } from './bootstrap';
import type { Container } from './container';
import { router } from './routes';

// All queries read the LOCAL database, so they must run regardless of connectivity
// (TanStack Query's default networkMode 'online' would pause them while offline).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000, networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

export function App() {
  const [container, setContainer] = useState<Container | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let built: Container | null = null;
    bootstrap()
      .then(async (c) => {
        built = c;
        await c.start();
        if (!disposed) setContainer(c);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      void built?.stop();
    };
  }, []);

  if (failed) {
    return (
      <div className="splash" role="alert">
        <h1>HMR POS could not start</h1>
        <p>Restart the app. If the problem continues, contact support.</p>
      </div>
    );
  }
  if (!container) {
    return (
      <div className="splash">
        <h1>HMR POS</h1>
        <p className="muted">Starting…</p>
      </div>
    );
  }
  return (
    <ContainerContext.Provider value={container}>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary logger={container.logger} fallbackTitle="HMR POS had a problem">
          <ApprovalProvider>
            <RouterProvider router={router} />
          </ApprovalProvider>
        </ErrorBoundary>
      </QueryClientProvider>
    </ContainerContext.Provider>
  );
}
