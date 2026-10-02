# App (Android POS client) — implementation notes

Author: client agent. Scope: `app/`, `docs/PRINTER.md`, `docs/OFFLINE_SYNC.md`, this file.

## 1. File tree summary (`app/`)

```
app/
├─ package.json, .nvmrc (22), vite.config.ts (CSP plugin for builds, /api dev proxy),
│  vitest.config.ts, playwright.config.ts (E2E_PORT), eslint.config.js, capacitor.config.ts,
│  tsconfig.{json,app,node,test,e2e}.json, .env.{development,staging,production}
├─ scripts/android-build.sh          picks Node ≥22 / JDK ≥21 then build + android:build
├─ src/
│  ├─ app/            container.ts (composition root), bootstrap.ts (native vs web), routes.tsx,
│  │                  App.tsx (providers), config.ts (zod-validated env)
│  ├─ domain/
│  │  ├─ entities/    Product, Sale, User, Approval, Register, Inventory, Sync, Audit, Settings, Permission
│  │  ├─ valueObjects/ Money, Quantity, Uuid, BasisPoints
│  │  ├─ repositories/ ProductReader/Writer, SaleReader/Writer, ReceiptCounter, InventoryRepository,
│  │  │               SyncQueue, SyncConflictRepository, RegisterSessionRepository, ApproverRepository,
│  │  │               SettingsRepository, AuditLogRepository, UserRepository, UnitOfWork
│  │  ├─ services/    PricingCalculator, DiscountPolicy, PermissionPolicy, RetryPolicy, OfflineLoginPolicy,
│  │  │               PinAttemptPolicy, ReceiptNumber, RegisterReportCalculator,
│  │  │               payments/ (PaymentMethod, CashPayment, GCash/CardPayment, PaymentMethodRegistry, PaymentValidator)
│  │  └─ errors/      DomainError + ValidationError, InsufficientStockError, PaymentFailedError,
│  │                  PrinterConnectionError, SynchronizationError, PermissionDeniedError,
│  │                  OfflineSessionExpiredError, OfflineLoginNotAllowedError, AccountLockedError,
│  │                  InvalidCredentialsError, ApprovalFailedError, RegisterNotOpenError, …
│  ├─ application/
│  │  ├─ usecases/    Login, OfflineLogin, SignIn (online→offline fallback), Logout, RegisterDevice,
│  │  │               OpenRegister, CloseRegister (X/Z), SearchProducts, CompleteSale, VoidSale,
│  │  │               AdjustInventory, PrintReceipt, ReprintReceipt, RequestApproval, PullCatalog,
│  │  │               PushSyncQueue, PrinterSettings, Query use cases (transactions, inventory, sync status)
│  │  ├─ ports/       Gateways (Auth/Device/Sync/Health), SecureStore, Credentials (TokenStore,
│  │  │               PasswordHasher, PinVerifier, OfflineCredentialStore), DeviceIdentity, Network,
│  │  │               ReceiptPrinter, Logger, Clock, RemoteCallError
│  │  ├─ dto/ (CartInput zod schemas, Receipt), session/SessionManager, sync/payloads, shared/
│  ├─ infrastructure/
│  │  ├─ api/         HttpClient (fetch wrapper), HttpApiGateway, schemas (zod)
│  │  ├─ database/    SqlDatabase (+ mutex), SqlJsDatabase, CapacitorSqliteDatabase (SQLCipher),
│  │  │               IndexedDbPersistence, openWebDatabase, migrations, Migrator
│  │  ├─ repositories/ SQLite implementations + SqliteUnitOfWork/createSqliteRepositories
│  │  ├─ synchronization/SyncEngine, network/ (NetworkDetector, CapacitorConnectivity)
│  │  ├─ authentication/ SecureStores (Native Keystore, DEV-ONLY session, Memory), SecureTokenStore,
│  │  │               SecureOfflineCredentialStore, Pbkdf2PasswordHasher, BcryptPinVerifier
│  │  ├─ device/      SecureDeviceIdentity
│  │  ├─ printer/     EscPosEncoder, ReceiptFormatter, MockPrinter, NativeEscPosPrinter (BT/Wi-Fi),
│  │  │               EscPosPrinterPlugin (bridge), ConfigurablePrinter (+ settings store)
│  │  └─ logging/     StructuredLogger (Console/Memory sinks), Redactor
│  ├─ presentation/   pages (Login, DeviceRegistration, OpenRegister, Pos, Transactions, Inventory,
│  │                  Register, SyncStatus, PrinterSettings), components, hooks, stores/cartStore, utils
│  └─ shared/         assert helpers
├─ tests/ unit/ (pricing vectors, payments, retry, logger, escpos, offline login, PIN)
│         integration/ (migrations, completeSale, sync, pullMerge, crashRecovery, search 50k, register)
│         support/ (sql.js harness, fake API server, sync harness)
├─ e2e/   helpers, login, sale, offline, reprintVoid specs
└─ android/ Capacitor project; app/src/main/java/ph/hmr/pos/{MainActivity.kt, printer/EscPosPrinterPlugin.kt},
           res/xml/network_security_config.xml (HTTPS only), src/debug/res/xml/… (dev cleartext),
           res/xml/data_extraction_rules.xml
```

~10.1k lines in `src/`, ~1.8k in tests/e2e. No circular imports (`madge --circular`: none).
Layering checked: `domain` imports nothing outward; `application` never imports
infrastructure/presentation; presentation imports infrastructure only for one type
(`SyncEngineState`).

## 2. Local SQLite schema (migration v1, `src/infrastructure/database/migrations.ts`)

All money INTEGER centavos, timestamps ISO-8601 UTC TEXT, booleans INTEGER 0/1, JSON as TEXT.

| Table | Key columns | Indexes |
|---|---|---|
| `stores` | uuid PK, code, name | PK |
| `users` (cached profile, **no password**) | uuid PK, name, email, role, permissions JSON, store_uuid | PK |
| `products` | uuid PK, sku, sku_normalized, barcode, name, name_normalized, category, price, is_active, track_stock, updated_at, deleted | `idx_products_barcode(barcode)`, `idx_products_sku(sku_normalized)`, `idx_products_active_name(is_active, deleted, name_normalized)`, `idx_products_category_name(category, name_normalized)` |
| `inventory` | product_uuid PK, server_quantity, quantity_on_hand (effective), server_updated_at, updated_at | PK |
| `inventory_movements` (local ledger) | uuid PK, product_uuid, type CHECK(SALE/VOID/STOCK_IN/STOCK_OUT/ADJUSTMENT), signed quantity, reference, reason, created_at, sync_status CHECK(PENDING/SYNCED) | `(product_uuid, sync_status)`, `(reference)`, `(product_uuid, created_at)` |
| `sales` | id PK AUTOINCREMENT, **uuid UNIQUE**, server_id, **receipt_number UNIQUE**, cashier_uuid/name, store_uuid, device_uuid, register_session_uuid, subtotal, order_discount_{type,value,amount,approval}, discount_total, tax_total, total CHECK ≥0, status CHECK(COMPLETED/VOIDED), payment_status, sync_status CHECK(PENDING/SYNCED/FLAGGED/FAILED), print_status CHECK(PENDING/PRINTED/FAILED), catalog_synced_at, created_at, updated_at, voided_at, void_reason | `(created_at)`, `(status, created_at)`, `(sync_status)`, `(register_session_uuid)` |
| `sale_items` | id PK, uuid UNIQUE, sale_uuid FK→sales(uuid) CASCADE, position, product_uuid, sku, name, quantity CHECK >0, unit_price, discount_{type,value,approval}, line_gross, line_discount, line_total | `(sale_uuid, position)`, `(product_uuid)` |
| `payments` | id PK, uuid UNIQUE, sale_uuid FK, position, method, amount CHECK ≥0, tendered, change_amount CHECK ≥0, reference | `(sale_uuid, position)` |
| `customers` (minimal, unused in v1 UI) | uuid PK, name, phone, email | PK |
| `approvers` | user_uuid PK, name, permissions JSON, pin_hash, is_active, failed_attempts, locked_until | PK |
| `settings` (k/v) | key PK, value, updated_at — `store.settings`, `printer.settings`, `sync.pull_since`, `sync.catalog_synced_at`, … | PK |
| `register_sessions` | uuid PK, device_uuid, store_uuid, opened_by_uuid, opened_at, opening_cash, status CHECK(OPEN/CLOSED), closed_*, actual/expected_cash, cash_sales/refunds/adjustments, variance | `(device_uuid, status)` |
| `receipt_counters` | day (YYYYMMDD) PK, last_seq | PK |
| `sync_queue` | id PK, **uuid UNIQUE (idempotency key)**, entity_type, entity_id, operation CHECK(6 ops), payload JSON, status CHECK(PENDING/IN_FLIGHT/DONE/FAILED), attempts, last_attempt_at, next_retry_at (NULL = due now), error_code, error_message, created_at, updated_at | **`(status, next_retry_at)`**, `(entity_type, entity_id)` |
| `sync_conflicts` | id PK, entity_type, entity_id, conflict_type, local_version, server_version, local_payload, server_payload, message, resolution_status CHECK(OPEN/RESOLVED), created_at | `(entity_type, entity_id)`, `(resolution_status, created_at)` |
| `audit_logs` | id PK, uuid UNIQUE, action, user_uuid, entity_type, entity_uuid, metadata JSON, occurred_at, batch_uuid, uploaded | `(batch_uuid, uploaded)`, `(occurred_at)` |
| `schema_migrations` | version PK, name, applied_at | — |

**Search**: FTS5 is **not** compiled into sql.js (verified: "no such module: fts5"; FTS4 exists
in sql.js but is unverified in the Capacitor SQLCipher build), so search is
`barcode = ? OR sku_normalized LIKE 'term%' OR name_normalized LIKE '%term%'` with
ranking (exact code → name prefix → contains), `LIMIT/OFFSET` pages of 60, 200 ms debounce,
and an exact `findByCode` path for scanners (Enter). Integration test: 50,000 products,
4 searches (name contains, barcode, SKU prefix, paged category) asserted < 2 s total on sql.js in Node.
Effective balances are stored (not recomputed per query) so product lists stay a single indexed join.

## 3. DI / composition

- `src/app/container.ts` `buildContainer(PlatformServices)` is the **only** place that wires
  implementations: runs migrations, builds repositories over the `SqlDatabase`, the
  `SqliteUnitOfWork`, `HttpClient`/`HttpApiGateway`, `NetworkDetector`, `SyncEngine`,
  printer (`ConfigurablePrinter` + factories), security components and all use cases, and
  returns a typed `Container` (use cases + a few services).
- `src/app/bootstrap.ts` chooses the platform:
  - **android** (`Capacitor.isNativePlatform()`): `CapacitorSqliteDatabase` (SQLCipher),
    `NativeSecureStore` (Keystore), Bluetooth/Wi-Fi ESC/POS printers, `@capacitor/device`.
  - **web** (dev/E2E): `SqlJsDatabase` + IndexedDB persistence, `DevSessionSecureStore`
    (DEV-ONLY, throws when `VITE_APP_ENV=production`), `MockPrinter`.
  - **tests**: the same use cases/repositories over sql.js in Node with fakes
    (`tests/support/harness.ts`, `fakeServer.ts`).
- Presentation resolves everything via `useContainer()`; components never call SQLite/fetch.
  The `UnitOfWork` takes a `RepositoryFactory`, which is how the atomicity test injects a
  failing audit repository mid-transaction.
- Payments are Open/Closed: `PaymentMethodRegistry.withDefaults()` registers Cash/GCash/Card;
  checkout and the payment dialog only call `registry.get(code).createPayment/validate`.
- Sync op side-effects are a table (`EFFECTS: Record<SyncOperationType, …>`) in
  `PushSyncQueueUseCase`, so a new op type is additive.

## 4. Security decisions

- **Tokens**: access + refresh tokens only in secure storage (`@aparajita/capacitor-secure-storage`,
  Android Keystore-backed); never SQLite/localStorage/logs. Refresh is single-flight; a rejected
  refresh clears tokens and pauses sync (queue kept).
- **Offline auth**: PBKDF2-SHA256 via WebCrypto, **210,000 iterations**, 16-byte random salt,
  constant-time compare; stored in secure storage with profile, last online auth time, failed
  counter and server `offline_policy`. Allowed for the last **5** online users on the device,
  within `max_offline_hours`, below `max_failed_attempts` (then locked until online login);
  clock rollback > 5 min refused. Failures/lockouts logged at `SECURITY` and audited.
- **Manager PIN**: synced bcrypt `pin_hash` verified with `bcryptjs` (`$2y$/$2b$/$2a$`), 6-digit
  format check, per-approver **5 attempts → 5 min lockout** stored locally (not reset by pulls),
  approver must hold `approval.grant` **and** the permission; success/failure audited; approval
  object follows the contract (server re-validates).
- **Database encryption**: `@capacitor-community/sqlite` with `androidIsEncryption: true`; the
  passphrase is 32 random bytes (hex) generated once, stored in secure storage, and handed to the
  plugin via `setEncryptionSecret` (checked with `checkEncryptionSecret` on later starts).
  The web/dev sql.js DB is **unencrypted** (dev/E2E only).
- **Device identity**: uuid generated once (CSPRNG) in secure storage; `X-Device-Id` on every call.
- **Transport**: release `network_security_config` = HTTPS only, system CAs; cleartext only in the
  **debug** source set (10.0.2.2/127.0.0.1/localhost/LAN). `CapacitorHttp` enabled (native HTTP,
  obeys the network config, no WebView CORS); `allowMixedContent: false`; production config refuses
  non-https API URLs. Build-time CSP (`connect-src 'self' <api origin>`, `object-src 'none'`).
- **Android hardening**: `allowBackup=false`, `fullBackupContent=false`, data-extraction rules
  excluding everything; WebView debugging enabled only when the app is debuggable (MainActivity);
  landscape (`sensorLandscape`).
- **Logging**: structured JSON (`DEBUG/INFO/WARNING/ERROR/SECURITY/AUDIT`); redactor removes any
  key containing the words password/pass/token/secret/pin/card/cvv/cvc/pan/authorization/
  passphrase/verifier/salt/hash/cookie (word-based, so "shipping"/"spinner" are untouched) and masks
  `Bearer …` and 12–19-digit runs. `no-console` is enforced by ESLint except in the logger.
- **Input validation**: zod on every API response, UI inputs (cart/checkout, credentials, approval,
  adjustments, register cash) and secure-store JSON; strict row mappers throw on schema drift.
- **Errors to users**: `toUserMessage()` maps domain/remote errors to friendly text; error
  boundaries never render stack traces.

## 5. Known limitations

- E2E specs were **not run against the real backend** (not up during development). The full flow
  was exercised with a Playwright script against a route-mocked API (dev server on :5180): manager
  login → device registration → open register → cashier login → cash sale (change ₱380.00, receipt
  printed) → synced → offline sale (pill "Offline · 1 pending", banner) → reconnect → synced →
  reprint → void with PIN 123456 → synced → X report (expected ₱1,090.00) → Sync/Printer/Inventory
  pages, zero console errors. That script lives outside the repo.
- Refunds, paid-in/out (cash_adjustments), price overrides UI (`price_override` always `null`),
  customers UI and conflict-resolution UI are not implemented.
- Argon2id `pin_hash` cannot be verified on device (reported as "cannot be verified").
- Paper-out detection depends on the printer answering `DLE EOT 4` (see PRINTER.md).
- Hardware printing was not tested on a physical printer (no device available); the Kotlin plugin
  compiles and is registered.
- Web build: sessionStorage secure store is per-tab while IndexedDB is per-origin; opening a new tab
  yields a new device uuid (dev only). sql.js persistence is debounced (200 ms) + flushed on `pagehide`.
- Main JS chunk ≈ 643 kB (196 kB gzip) + 658 kB sql.js WASM (web only); acceptable for an
  installed tablet app, not code-split further.
- Session (signed-in user) is in memory: restarting the app requires signing in again (offline
  login works); tokens persist so background sync continues for queued data only after sign-in.

## 6. Contract deviations / interpretations

1. **Line-discount approval**: sent as `items[].discount.approval` (contract had no slot).
   Backend accepted this (`backend-implementation.md` §7.1).
2. **Approval `mode`**: no online-approval endpoint exists, so the PIN is always verified locally;
   `mode = "ONLINE"` when the API was reachable (`/health` OK) at approval time, else `"OFFLINE_PIN"`.
3. **Register figures** aligned with backend §7.12: `cash_sales` = Σ cash `amount` (not tendered)
   of the session's **non-voided** sales; `cash_refunds = 0`, `cash_adjustments = 0` (features not in
   v1); `variance = actual − expected`. `OPEN_REGISTER` also carries optional `approval`.
4. **Idempotency key = `payload.uuid`** for every op except `AUDIT_EVENTS` (backend §7.6) — verified
   in tests and in the mocked E2E run.
5. **`DUPLICATE` + `original_status: FLAGGED`** is treated as FLAGGED (§7.7); new conflict types
   (`TAX_MISMATCH`, `DUPLICATE_RECEIPT_NUMBER`, …) are stored generically.
6. **Whole-request errors**: `401` without a successful refresh and any `403` pause the queue
   *without* consuming attempts (not the payload's fault); other whole-request `4xx` mark the batch
   `FAILED`. A result missing for a sent key is retried (`MISSING_RESULT`).
7. `max_discount_bp` is enforced client-side for line and order discounts, even with approval (§7.4).
8. Receipt-number day (`YYYYMMDD`) uses the **device's local timezone**; the contract does not say.
9. `AUDIT_EVENTS` does not send the optional per-event `level` (§7.15); actions are `[A-Z_]+`.
10. `pin_hash` may be argon2id per API.md, but only bcrypt is verifiable client-side → recommend the
    backend always issues bcrypt (SECURITY.md already says bcrypt cost ≥ 12).
11. Dev CORS: backend default `CORS_ALLOWED_ORIGINS` has `http://localhost:5173`, while the dev
    server binds `127.0.0.1`; the client avoids the issue with the Vite `/api` proxy (web) and
    CapacitorHttp (Android).

## 7. Toolchain notes / environment findings

- **Capacitor 8 CLI requires Node ≥ 22** (`[fatal] The Capacitor CLI requires NodeJS >=22.0.0`);
  everything else runs on Node 20.20. Used nvm's Node 22.23.2 for `cap add/sync` (`.nvmrc` = 22).
- **Capacitor Android 8 compiles with Java 21**; only JDK 17 was on PATH. Used Android Studio's
  JBR (Java 25) at `/snap/android-studio/current/jbr`, which needs Gradle ≥ 9.1 → wrapper set to
  **Gradle 9.3.1** (already cached) instead of the generated 8.14.3; AGP **8.13.1** (cached),
  Kotlin Gradle plugin **2.2.0** (cached). `org.gradle.jvmargs=-Xmx2g`. `scripts/android-build.sh`
  auto-selects these when defaults are too old.
- **Port 5173 is occupied on this machine by another project's Vite server ("Extrim V3")**.
  `playwright.config.ts` therefore uses `E2E_PORT` (default 5173) and `reuseExistingServer: false`
  so it can never silently test the wrong app: run `E2E_PORT=5180 npm run test:e2e` (or stop the
  other server).

## 8. Exact results (2026-10-02)

| Command | Result |
|---|---|
| `npm run lint` | ✅ 0 errors, 0 warnings (`eslint . --max-warnings=0`) |
| `npm run typecheck` | ✅ `tsc -b --noEmit` clean (app, node, tests, e2e) |
| `npm test` | ✅ **14 files, 102 tests passed** (unit: pricing vectors ×10 + rules, payments, registry extensibility, retry schedule, logger redaction, ESC/POS + formatter, offline login, PIN lockout; integration: migrations, sale atomicity/stock/void/print, sync engine vs fake API incl. server down, partial batch, token refresh, refresh failure, conflicts, rejects, max attempts, single-flight, interruption, pull merge, crash recovery, 50k search, X/Z) |
| `npm run build` | ✅ `dist/` — index 642.6 kB (196.3 kB gzip), sql-wasm 658 kB, CSS 9.7 kB |
| `npm run android:build` (via `scripts/android-build.sh`, Node 22.23.2, JBR 25, Gradle 9.3.1) | ✅ **BUILD SUCCESSFUL** — `app/android/app/build/outputs/apk/debug/app-debug.apk` (≈13.9 MB) |
| `npm run test:e2e` | ✅ 7/7 against the real Laravel backend (run by the coordinator, see docs/TESTING.md) |
