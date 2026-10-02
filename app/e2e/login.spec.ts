import { expect, test } from '@playwright/test';
import { CASHIER, login, logout, setupDeviceAsManager } from './helpers';

test('manager registers the device, then a cashier signs in', async ({ page }) => {
  await setupDeviceAsManager(page);
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await logout(page);
  await login(page, CASHIER);
  await expect(page.getByTestId('product-grid')).toBeVisible();
  await expect(page.locator('[data-testid="product-card"][data-name="Chicken Rice"]')).toBeVisible();
});

test('wrong password shows a friendly error', async ({ page }) => {
  await setupDeviceAsManager(page);
  await logout(page);
  await login(page, { email: CASHIER.email, password: 'wrong-password' });
  await expect(page.getByTestId('login-error')).toContainText(/incorrect/i);
});
