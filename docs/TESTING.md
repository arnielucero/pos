# Testing

| Level | Where | Command | Result (2026-10-02) |
|---|---|---|---|
| Backend unit + feature (PHPUnit, SQLite in-memory) | `backend/tests` | `cd backend && php artisan test` | ✅ 81 tests, 551 assertions (also 81/81 on a throwaway MySQL 8.0.46) |
| Client lint | `app/` | `npm run lint` | ✅ 0 errors, 0 warnings |
| Client typecheck | `app/` | `npm run typecheck` | ✅ clean (app, tests, e2e) |
| Client unit + integration (Vitest, sql.js in Node) | `app/tests` | `npm test` | ✅ 14 files, 102 tests |
| E2E (Playwright, real Laravel backend) | `app/e2e` | see below | ✅ 7/7 |
| Web build | `app/` | `npm run build` | ✅ |
| Android debug APK | `app/` | `scripts/android-build.sh` | ✅ `android/app/build/outputs/apk/debug/app-debug.apk` |

## Shared pricing vectors

`docs/pricing-vectors.json` is loaded by **both** `app/tests/unit` (Vitest) and
`backend/tests/Unit/PricingCalculatorTest.php`, so the client's totals and the server's recomputation
can't drift apart silently.

## What is covered

- **Unit**: pricing/discount/tax/totals, payment rules (insufficient/exact/excess cash, split, duplicate
  payment uuid), payment registry extensibility, retry schedule and max attempts, sync result handling,
  idempotency key reuse, offline login policy (expiry, lockout, unknown user, clock rollback), PIN lockout,
  log redaction, ESC/POS bytes and receipt width.
- **Integration (client)**: migrations; sale atomicity with a failure injected mid-transaction (nothing
  persisted, stock unchanged); insufficient stock; void reverses stock; print failure keeps the sale;
  pull merge keeps unsynced deductions; crash recovery (`IN_FLIGHT → PENDING`); sync engine vs fake API
  (server down, partial batch, token expiry + refresh, refresh failure, conflicts, rejects, single-flight,
  interruption); 50,000-product search.
- **Feature (server)**: auth (rotation, reuse detection, device binding, TOKEN_EXPIRED, no enumeration,
  rate limits), device registration, every CREATE_SALE outcome (APPLIED, DUPLICATE, key reuse,
  INVALID_TOTALS + SECURITY audit, PRICE_MISMATCH window, discount rules, inactive/deleted product,
  negative stock, unknown product, foreign cashier, concurrent duplicate via unique index), void, inventory
  adjust permissions/approvals, register reconciliation, mixed batches, pull, error envelope, CORS, headers.
- **E2E**: manager device registration + open register, cashier login, cash checkout with change and mock
  receipt, split cash + GCash, offline sale → pending count → reconnect → synced, reprint, void with manager
  PIN (including a wrong-PIN attempt).

## Running E2E locally

```bash
cd backend
php artisan migrate:fresh --seed
POS_LOGIN_RATE_LIMIT=100 PHP_CLI_SERVER_WORKERS=4 php artisan serve --port=8080   # leave running

cd ../app
E2E_PORT=5180 npm run test:e2e     # E2E_PORT avoids clashing with other Vite servers on 5173
```

The suite logs in many times per minute, so the local server raises the login limit; production keeps
the default 5/min (`POS_LOGIN_RATE_LIMIT`).

## Not covered by automation

- Physical Bluetooth / Wi-Fi printers (Kotlin plugin compiles; needs a hardware test — see PRINTER.md).
- On-device SQLCipher and Keystore behaviour (run the APK on a tablet; the web build uses sql.js + a dev store).
- Battery-pull mid-checkout is covered logically (single SQLite transaction + crash-recovery test), not physically.
