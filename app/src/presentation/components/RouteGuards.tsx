import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useSession } from '../hooks/useAppState';

export function RequireAuth({ children, device = true }: { children: ReactNode; device?: boolean }) {
  const s = useSession();
  if (!s.user) return <Navigate to="/login" replace />;
  if (device && !s.device) return <Navigate to="/device" replace />;
  return children;
}

export function RequireRegister({ children }: { children: ReactNode }) {
  const s = useSession();
  if (!s.registerSession) return <Navigate to="/register/open" replace />;
  return children;
}
