import { NavLink, Outlet, useNavigate } from 'react-router';
import { hasPermission } from '../../domain/entities/Permission';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { OfflineBanner, StatusPill } from '../components/StatusPill';
import { useContainer } from '../hooks/ContainerContext';
import { useSession } from '../hooks/useAppState';
import { useInvalidateOnSync } from '../hooks/useCatalog';

export function MainLayout() {
  const container = useContainer();
  const session = useSession();
  const navigate = useNavigate();
  useInvalidateOnSync();
  const user = session.user;

  const logout = async (): Promise<void> => {
    await container.useCases.logout.execute();
    void navigate('/login', { replace: true });
  };

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">HMR POS</span>
        <StatusPill />
        <nav className="topnav">
          <NavLink to="/pos">POS</NavLink>
          <NavLink to="/transactions">Transactions</NavLink>
          {hasPermission(user, 'inventory.view') && <NavLink to="/inventory">Inventory</NavLink>}
          <NavLink to="/register">Register</NavLink>
          <NavLink to="/sync">Sync</NavLink>
          <NavLink to="/printer">Printer</NavLink>
        </nav>
        <span className="user">
          {user?.name} <span className="muted">({user?.role}{session.authMode === 'OFFLINE' ? ', offline' : ''})</span>
        </span>
        <button type="button" className="btn btn--ghost" data-testid="logout" onClick={() => void logout()}>
          Logout
        </button>
      </header>
      <OfflineBanner />
      {session.reauthRequired && (
        <div className="warn-banner" role="status">
          Your online session expired. Sales are saved; log out and sign in while online to resume syncing.
        </div>
      )}
      <main className="content">
        <ErrorBoundary logger={container.logger}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
