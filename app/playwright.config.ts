import { defineConfig, devices } from '@playwright/test';

/** Dev server port for E2E (override with E2E_PORT if 5173 is taken by another project). */
const port = Number(process.env['E2E_PORT'] ?? 5173);
const baseURL = `http://127.0.0.1:${String(port)}`;

/**
 * E2E against the real Laravel backend (expected at http://127.0.0.1:8080, seeded with
 * cashier@pos.test / manager@pos.test, password "password", manager PIN 123456).
 * The web build uses sql.js + MockPrinter, so no device hardware is needed.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'tablet-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: `npm run dev -- --port ${String(port)}`,
    url: baseURL,
    // Never silently reuse whatever else is listening on the port (it may be another app).
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
