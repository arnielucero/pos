import { expect, test } from '@playwright/test';
import { addProduct, payCash, setupAsCashier, waitForSynced } from './helpers';

test('cash checkout with change and a printed (mock) receipt', async ({ page }) => {
  await setupAsCashier(page);
  await addProduct(page, 'Chicken Rice');
  await expect(page.getByTestId('cart-total')).toHaveText('₱120.00');
  await payCash(page, '500');
  await expect(page.getByTestId('change-due')).toHaveText('₱380.00');
  await expect(page.getByTestId('print-status')).toHaveText('Receipt printed.');
  const receiptNo = await page.getByTestId('receipt-number').innerText();
  expect(receiptNo).toMatch(/^[A-Z0-9-]+-\d{8}-\d{5}$/);
  await expect(page.getByTestId('receipt-preview')).toContainText('Chicken Rice');
  await expect(page.getByTestId('receipt-preview')).toContainText(receiptNo);
  await expect(page.getByTestId('receipt-preview')).toContainText('P380.00');
  await page.getByTestId('new-sale').click();
  await expect(page.getByTestId('cart')).toContainText('Tap a product');
  await waitForSynced(page);
});

test('split payment: cash + GCash with reference', async ({ page }) => {
  await setupAsCashier(page);
  await addProduct(page, 'Chicken Rice');
  await addProduct(page, 'Coffee');
  await expect(page.getByTestId('cart-total')).toHaveText('₱210.00');
  await page.getByTestId('pay-cash').click();
  await page.getByTestId('payment-amount').fill('100');
  await page.getByTestId('payment-add').click();
  await expect(page.getByTestId('payment-remaining')).toHaveText('₱110.00');
  await page.getByTestId('method-gcash').click();
  await page.getByTestId('payment-reference').fill('GC-123456');
  await page.getByTestId('payment-complete').click();
  await expect(page.getByTestId('sale-complete')).toBeVisible();
  await expect(page.getByTestId('change-due')).toHaveText('₱0.00');
});
