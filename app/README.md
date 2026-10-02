# HMR POS — Android tablet client

Offline-first point of sale for Android tablets: React + TypeScript (strict) + Vite, packaged
with Capacitor 8. Talks to the Laravel API in `../backend` using the contract in
[`../docs/API.md`](../docs/API.md). Design docs: [`../docs/OFFLINE_SYNC.md`](../docs/OFFLINE_SYNC.md),
[`../docs/PRINTER.md`](../docs/PRINTER.md), [`../docs/SECURITY.md`](../docs/SECURITY.md).

## Requirements

| Tool | Version | Used for |
|---|---|---|
| Node.js | **20.19+** for dev/test/build; **22+** for the Capacitor CLI (`cap sync/add`) | `.nvmrc` = 22 |
| JDK | **21+** (Capacitor Android 8 compiles with Java 21; Gradle wrapper 9.3.1). Android Studio's bundled JBR works: `JAVA_HOME=/snap/android-studio/current/jbr` | Android build |
| Android SDK | API 36 (compileSdk), `ANDROID_HOME` set | Android build |

## Setup

```bash
cd app
npm ci
npx playwright install chromium   # only for E2E
```

## Run (browser, development)

```bash
npm run dev            # http://127.0.0.1:5173
```

The dev server proxies `/api` → `VITE_DEV_PROXY_TARGET` (default `http://127.0.0.1:8080`), so
start the backend first (`../backend`). The web build uses **sql.js** (SQLite/WASM) persisted
to IndexedDB, a **DEV-ONLY** sessionStorage "secure store" and the **MockPrinter** (receipts
appear on screen). It refuses to start when `VITE_APP_ENV=production`.

First run on a new device/browser: sign in as a manager (`device.register`) → register the
tablet → open the register → sell. Cashiers can then sign in on that device.

## Environment

`.env.development`, `.env.staging`, `.env.production` contain only:

- `VITE_API_BASE_URL` — absolute URL (`https://…/api/v1`), or `/api/v1` behind the dev proxy
- `VITE_APP_ENV` — `development | staging | production`
- (dev only) `VITE_DEV_PROXY_TARGET`

`VITE_*` values are bundled into the JavaScript and are **public** — never put secrets there.
Production requires an `https://` API URL. For a debug APK against a dev machine create
`.env.development.local` with e.g. `VITE_API_BASE_URL=http://10.0.2.2:8080/api/v1` (emulator)
or your LAN IP, then `npx vite build --mode development` before `cap sync`
(cleartext HTTP is allowed only in **debug** builds via `src/debug/res/xml/network_security_config.xml`).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (port 5173) |
| `npm run build` | `tsc -b` + production web build to `dist/` (CSP injected, API origin only) |
| `npm run lint` | ESLint (typescript-eslint strict, react-hooks, no `any`, no `console` outside the logger), `--max-warnings=0` |
| `npm run typecheck` | `tsc -b` over app, node configs, tests and e2e |
| `npm test` | Vitest unit + integration tests (sql.js in Node) |
| `npm run test:e2e` | Playwright against the dev server + a running backend (see below) |
| `npm run cap:sync` | build + `cap sync` (Node 22+) |
| `npm run android:build` | `cap sync android && cd android && ./gradlew assembleDebug` |
| `scripts/android-build.sh` | Same, but picks Node ≥ 22 from nvm and a JDK ≥ 21 if the defaults are older |

APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

## E2E (Playwright)

Requires the backend at `http://127.0.0.1:8080` seeded with `manager@pos.test` / `cashier@pos.test`
(password `password`), manager PIN `123456`, products incl. "Chicken Rice" ₱120 and "Coffee" ₱90.

```bash
npm run test:e2e                 # starts `npm run dev` on 5173
E2E_PORT=5180 npm run test:e2e   # if 5173 is taken by another project
```

Specs (`e2e/`): manager device registration + cashier login, cash checkout with change and
receipt, split cash+GCash, offline sale via `context.setOffline(true)` with pending count →
reconnect → synced, reprint from history, void with manager PIN, wrong PIN refused.
Each test uses a fresh browser context, i.e. a new device registration.

## Architecture (src/)

```
app/             composition root (container.ts), bootstrap (native vs web), routes, config
domain/          entities, value objects (Money, Quantity, Uuid, BasisPoints), repository
                 interfaces, services (PricingCalculator, payments strategies + registry,
                 PermissionPolicy, RetryPolicy, OfflineLoginPolicy, PinAttemptPolicy, …), typed errors
application/     use cases, ports (gateways, SecureStore, ReceiptPrinter, Logger, …), DTOs,
                 SessionManager, sync payload builders
infrastructure/  api (HttpClient + zod schemas), database (SqlDatabase, sql.js, Capacitor SQLite,
                 migrations), repositories (SQLite), synchronization (SyncEngine), network,
                 authentication (secure stores, PBKDF2, bcrypt), device, printer, logging
presentation/    pages, components, hooks (use cases resolved from the container), stores (cart)
shared/          tiny framework-free helpers
```

Components never touch SQLite or `fetch`; they call use cases obtained from the DI container
(`useContainer()`). See `../docs/notes/app-implementation.md` for schema, DI and security details.
