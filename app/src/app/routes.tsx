import { createHashRouter, Navigate } from 'react-router';
import { RequireAuth, RequireRegister } from '../presentation/components/RouteGuards';
import { MainLayout } from '../presentation/layouts/MainLayout';
import { DeviceRegistrationPage } from '../presentation/pages/DeviceRegistrationPage';
import { InventoryPage } from '../presentation/pages/InventoryPage';
import { LoginPage } from '../presentation/pages/LoginPage';
import { OpenRegisterPage } from '../presentation/pages/OpenRegisterPage';
import { PosPage } from '../presentation/pages/PosPage';
import { PrinterSettingsPage } from '../presentation/pages/PrinterSettingsPage';
import { RegisterPage } from '../presentation/pages/RegisterPage';
import { SyncStatusPage } from '../presentation/pages/SyncStatusPage';
import { TransactionsPage } from '../presentation/pages/TransactionsPage';

/** Hash router: works from file:// / capacitor:// origins without server rewrites. */
export const router = createHashRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/device',
    element: (
      <RequireAuth device={false}>
        <DeviceRegistrationPage />
      </RequireAuth>
    ),
  },
  {
    path: '/register/open',
    element: (
      <RequireAuth>
        <OpenRegisterPage />
      </RequireAuth>
    ),
  },
  {
    element: (
      <RequireAuth>
        <MainLayout />
      </RequireAuth>
    ),
    children: [
      {
        path: '/pos',
        element: (
          <RequireRegister>
            <PosPage />
          </RequireRegister>
        ),
      },
      { path: '/transactions', element: <TransactionsPage /> },
      { path: '/inventory', element: <InventoryPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/sync', element: <SyncStatusPage /> },
      { path: '/printer', element: <PrinterSettingsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/pos" replace /> },
]);
