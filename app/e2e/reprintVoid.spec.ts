import { expect, test } from '@playwright/test';
import { addProduct, enterManagerPin, payCash, setupAsCashier, waitForSynced } from './helpers';

test('reprint from history, then void with manager PIN', async ({ page }) => {
  await setupAsCashier(page);
  await addProduct(page, 'Chicken Rice');
  await payCash(page, '200');
  const receiptNo = await page.getByTestId('receipt-number').innerText();
  await page.getByTestId('new-sale').click();

  await page.getByRole('link', { name: 'Transactions' }).click();
  await page.locator(`[data-testid="transaction-row"][data-receipt="${receiptNo}"]`).click();
  await expect(page.getByTestId('sale-detail')).toContainText(receiptNo);

  await page.getByTestId('reprint').click();
  await expect(page.getByTestId('sale-message')).toHaveText('Receipt reprinted.');
  // Reprint never creates a new sale
  await expect(page.locator(`[data-testid="transaction-row"][data-receipt="${receiptNo}"]`)).toHaveCount(1);

  await page.getByTestId('void').click();
  await page.getByTestId('void-reason').fill('Customer changed mind');
  await page.getByTestId('confirm-void').click();
  await enterManagerPin(page);
  await expect(page.getByTestId('sale-message')).toHaveText('Sale voided.');
  await expect(page.getByTestId('sale-detail')).toContainText('VOIDED');
  await waitForSynced(page);
});

test('wrong manager PIN is refused', async ({ page }) => {
  await setupAsCashier(page);
  await addProduct(page, 'Coffee');
  await payCash(page, '90');
  await page.getByTestId('new-sale').click();
  await page.getByRole('link', { name: 'Transactions' }).click();
  await page.getByTestId('transaction-row').first().click();
  await page.getByTestId('void').click();
  await page.getByTestId('void-reason').fill('Test wrong pin');
  await page.getByTestId('confirm-void').click();
  const dialog = page.getByTestId('approval-dialog');
  for (const d of '000000') await dialog.getByRole('button', { name: d, exact: true }).click();
  await expect(dialog).toContainText(/Wrong PIN/);
});
