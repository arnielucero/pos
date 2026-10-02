import { expect, test } from '@playwright/test';
import { addProduct, payCash, setupAsCashier, waitForSynced } from './helpers';

test('sells offline, shows pending count, syncs after reconnect', async ({ page, context }) => {
  await setupAsCashier(page);
  await waitForSynced(page);

  await context.setOffline(true);
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await expect(page.getByTestId('sync-status')).toContainText('Offline');

  await addProduct(page, 'Chicken Rice');
  await payCash(page, '120');
  await expect(page.getByTestId('change-due')).toHaveText('₱0.00');
  await page.getByTestId('new-sale').click();
  await addProduct(page, 'Coffee');
  await payCash(page, '100');
  await page.getByTestId('new-sale').click();

  const pill = page.getByTestId('sync-status');
  await expect(pill).toContainText(/Offline · [1-9]\d* pending/);
  await expect(page.getByTestId('offline-banner')).toContainText(/[1-9]\d* transactions pending/);

  await context.setOffline(false);
  await expect(page.getByTestId('offline-banner')).toBeHidden({ timeout: 30_000 });
  await waitForSynced(page);

  await page.getByRole('link', { name: 'Transactions' }).click();
  const rows = page.getByTestId('transaction-row');
  await expect(rows.first()).toBeVisible();
  await expect(page.getByTestId('sale-sync-status').first()).toHaveText('SYNCED', { timeout: 30_000 });
});
