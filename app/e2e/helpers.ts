import { expect, type Page } from '@playwright/test';

export const MANAGER = { email: 'manager@pos.test', password: 'password', pin: '123456' };
export const CASHIER = { email: 'cashier@pos.test', password: 'password' };

export async function login(page: Page, user: { email: string; password: string }): Promise<void> {
  await page.goto('/#/login');
  const form = page.getByTestId('login-form');
  await form.getByLabel('Email').fill(user.email);
  await form.getByLabel('Password').fill(user.password);
  await form.getByRole('button', { name: 'Sign in' }).click();
}

/** Fresh browser context = new device: the manager signs in, registers it and opens the register. */
export async function setupDeviceAsManager(page: Page): Promise<void> {
  await login(page, MANAGER);
  await expect(page.getByTestId('device-form')).toBeVisible();
  await page.getByTestId('device-form').getByRole('button', { name: 'Register device' }).click();
  await expect(page.getByTestId('open-register-form')).toBeVisible();
  await page.getByTestId('opening-cash').fill('1000.00');
  await page.getByTestId('open-register-form').getByRole('button', { name: 'Open register' }).click();
  await expect(page.getByTestId('product-grid')).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('login-form')).toBeVisible();
}

/** Device set up by the manager, then the cashier signs in (register already open). */
export async function setupAsCashier(page: Page): Promise<void> {
  await setupDeviceAsManager(page);
  await logout(page);
  await login(page, CASHIER);
  await expect(page.getByTestId('product-grid')).toBeVisible();
}

export async function addProduct(page: Page, name: string): Promise<void> {
  await page.getByTestId('product-search').fill(name);
  await page.locator(`[data-testid="product-card"][data-name="${name}"]`).first().click();
  await expect(page.locator(`[data-testid="cart-line"][data-name="${name}"]`)).toBeVisible();
}

export async function payCash(page: Page, tendered: string): Promise<void> {
  await page.getByTestId('pay-cash').click();
  await page.getByTestId('payment-amount').fill(tendered);
  await page.getByTestId('payment-complete').click();
  await expect(page.getByTestId('sale-complete')).toBeVisible();
}

export async function enterManagerPin(page: Page, pin = MANAGER.pin): Promise<void> {
  const dialog = page.getByTestId('approval-dialog');
  await expect(dialog).toBeVisible();
  for (const d of pin) await dialog.getByRole('button', { name: d, exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function waitForSynced(page: Page): Promise<void> {
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-pending', '0', { timeout: 60_000 });
  await expect(page.getByTestId('sync-status')).toContainText('Synced', { timeout: 60_000 });
}
