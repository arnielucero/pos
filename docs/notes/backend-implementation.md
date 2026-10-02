# Backend implementation notes (Laravel 13 / PHP 8.3)

Implements `docs/API.md` v1. Location: `backend/`. Setup: `backend/README.md`.

## 1. File tree summary

```
backend/
  app/
    Domain/                      pure business rules, no HTTP
      Pricing/                   PricingCalculator (+ Discount, LineInput, LineResult, PricingResult, DiscountType)
      Sales/                     SaleValidator (steps 4-7, typed Conflict/ConflictType, SaleReview), Exceptions/
      Inventory/                 InventoryLedger (append-only movements + locked balance update), MovementType, LedgerEntry
      Auth/                      Role, Permission, RolePermissions (single source of truth), PermissionResolver, Exceptions/
      Approval/                  ApprovalVerifier (+ AuthorizationOutcome)
      Audit/                     AuditLogger, AuditLevel
      Catalog/                   PriceHistory (interface)
      Register/Exceptions/       session not found / already closed
      Sync/                      OperationType, OperationStatus, OperationResult, PayloadHasher, Exceptions/
      Shared/Exceptions/         DomainException base (code, http status, details, retryable) + generic ones
    Application/                 use cases
      Sync/                      SyncBatchProcessor, IdempotentOperationRunner, PullSyncAction, OperationHandler,
                                 SyncContext, ConflictRecorder
      Sales/                     CompleteSaleAction, VoidSaleAction, CreateSalePayloadRules
      Inventory/                 AdjustInventoryAction
      Register/                  OpenRegisterAction, CloseRegisterAction
      Audit/                     RecordAuditEventsAction
      Auth/                      LoginAction, RefreshAccessTokenAction, LogoutAction, TokenIssuer, DeviceGate
      Devices/                   RegisterDeviceAction, UpdateDeviceStatusAction
      Products/                  SaveProductAction (create/update/delete)
      Shared/                    PayloadValidator, ApprovalRules, StoreUsers, StoreSettings
    Repositories/                EloquentPriceHistory, IdempotencyKeyRepository
    Http/
      Controllers/Api/           thin controllers (Auth, Device, Sync, Sale, Product, AuditLog, Health)
      Requests/                  Form Requests
      Resources/                 API Resources (User, AuthSession, Device, Product, Sale, AuditLog)
      Middleware/                EnsureTokenBoundToDevice (pos.bound), EnsureDeviceIsActive (pos.device), ApiSecurityHeaders
      ApiExceptionRenderer.php   THE single exception -> error-envelope mapping (wired in bootstrap/app.php)
      Responses/ErrorEnvelope.php, RequestContext.php
    Models/                      Eloquent models ($fillable everywhere, secrets $hidden, append-only guards)
    Console/Commands/SeedBulkProducts.php   pos:seed-bulk-products {count=50000}
    Providers/AppServiceProvider.php        gates (one per permission), rate limiters, https in prod
  config/pos.php                 TTLs, rate limits, sync limits, default store settings
  config/cors.php                origins from CORS_ALLOWED_ORIGINS
  database/migrations/           6 domain migrations (+ Laravel cache/jobs, Sanctum tokens)
  database/seeders/DatabaseSeeder.php       demo store/users/products; refuses production
  routes/api.php                 /api/v1/*
  tests/Unit                     PricingCalculatorTest (loads ../docs/pricing-vectors.json), PayloadHasherTest
  tests/Feature                  Auth, Device, CreateSale, SyncOperations, PullAndCatalog, ErrorEnvelopeAndPermissions
  tests/Concerns/PosFixtures.php fixtures + payload builders
```

All app/test PHP files use `declare(strict_types=1)`.

## 2. MySQL schema summary

Money = `BIGINT UNSIGNED` centavos (signed only where a value can be negative: variances, cash adjustments,
stock quantities). Business datetimes are `DATETIME` (UTC). Public ids are `CHAR(36)` uuids.

| Table | Key columns | Unique / indexes / constraints |
|---|---|---|
| stores | id, uuid, code, name, settings JSON (per-store overrides) | UQ uuid, UQ code |
| users | uuid, store_id FK, name, email, password (bcrypt), pin_hash (bcrypt ≥12, nullable), role ENUM(ADMIN,MANAGER,SUPERVISOR,CASHIER,INVENTORY), is_active | UQ uuid, UQ email, IX(store_id, role, is_active) |
| devices | uuid, store_id FK, code (POS-NN), name, type, status ENUM(ACTIVE,DISABLED), registered_by FK, registered_at, last_sync_at | UQ uuid, UQ(store_id, code) |
| personal_access_tokens | Sanctum + device_uuid, refresh_family_id | UQ token (sha256), IX device_uuid, IX refresh_family_id, IX expires_at |
| refresh_tokens | token_hash CHAR(64) sha256, family_id, user_id FK, device_id FK null, device_uuid, access_token_id, expires_at, revoked_at, replaced_by FK self | UQ token_hash, IX family_id, IX access_token_id |
| products | uuid, store_id FK, sku, barcode, name, category, is_active, track_stock, deleted_at (soft delete) | UQ uuid, UQ(store_id, sku), IX(store_id, barcode), IX(store_id, updated_at), IX(store_id, name) |
| product_prices | product_id FK, price, effective_from, effective_to NULL=current, created_by | IX(product_id, effective_from), IX(product_id, effective_to); CHECK effective_to ≥ effective_from |
| inventory_movements (append-only) | uuid, product_id, store_id, type ENUM(STOCK_IN,STOCK_OUT,SALE,RETURN,ADJUSTMENT,TRANSFER,VOID), quantity signed, reference_type/uuid, reason, user_id, device_id, approved_by, occurred_at (client), created_at | UQ uuid, IX(store_id, product_id, created_at), IX(reference_type, reference_uuid); CHECK quantity <> 0 |
| inventory_balances | product_id, store_id, quantity_on_hand signed, updated_at | UQ(product_id, store_id), IX(store_id, updated_at) |
| register_sessions | uuid, store_id, device_id, opened_by, opened_at, opening_cash, status ENUM(OPEN,CLOSED), synced_by | UQ uuid, IX(store_id, status), IX(device_id, status) |
| register_closures (append-only) | uuid, register_session_id, closed_by, approved_by, closed_at, actual_cash, client_{expected_cash,cash_sales,cash_refunds,cash_adjustments,variance}, server_{expected_cash,cash_sales,variance}, status ENUM(RECONCILED,FLAGGED) | UQ uuid, UQ register_session_id |
| sales | uuid, store_id, device_id, cashier_id, synced_by, register_session_id FK null, register_session_uuid, receipt_number, client_receipt_number, status ENUM(COMPLETED,FLAGGED,VOIDED), subtotal, discount_total, order_discount_{type,value,amount,approval}, tax_total, tax_rate_bp, total, cash_change, client_created_at, catalog_synced_at, received_at, payload_hash | **UQ(store_id, uuid)**, **UQ(store_id, receipt_number)**, IX(store_id, client_created_at), IX(store_id, status), IX register_session_uuid; CHECK total ≥ 0 AND total ≤ subtotal |
| sale_items | uuid, sale_id, product_id, product_name/sku snapshot, quantity, unit_price, server_unit_price, discount_{type,value,approval}, price_override JSON, line_gross, line_discount, line_total | UQ(sale_id, uuid), IX(product_id, sale_id); CHECK quantity > 0; CHECK line_discount ≤ line_gross AND line_total = line_gross − line_discount |
| payments | uuid, sale_id, method ENUM(CASH,GCASH,CARD), amount, tendered, change_amount (`change` is reserved in MySQL), reference | UQ(sale_id, uuid), IX(sale_id, method); CHECK tendered ≥ amount |
| sale_voids | uuid, sale_id, store_id, voided_by, approved_by, approval JSON, reason, voided_at, device_id, synced_by | UQ uuid, **UQ sale_id** (a sale can be voided once) |
| idempotency_keys | store_id, key, operation_type, payload_hash, entity_uuid, result JSON, device_id, user_id | **UQ(store_id, key)** |
| sync_conflicts | uuid, store_id, device_id, reference_type/uuid (owning sale / register_closure), entity_type/uuid (offending row), conflict_type, message, local_payload JSON, server_payload JSON, resolution_status ENUM(OPEN,RESOLVED,DISMISSED), resolved_by, resolved_at | UQ uuid, IX(store_id, resolution_status), IX(reference_type, reference_uuid) |
| audit_logs (append-only) | uuid, action, level ENUM(INFO,WARNING,SECURITY,AUDIT), source ENUM(SERVER,DEVICE), user_id, device_id, store_id, entity_type/uuid, metadata JSON, ip_address, occurred_at | UQ uuid, IX(store_id, occurred_at), IX(store_id, action), IX(entity_type, entity_uuid) |

Plus Laravel's `cache`/`cache_locks` (rate limiter store), `jobs`, `sessions`, `password_reset_tokens`.
All FKs are `RESTRICT` on financial tables. CHECK constraints are added only when the driver is MySQL
(SQLite cannot `ALTER TABLE ADD CONSTRAINT`). Append-only is also enforced at model level
(`updating`/`deleting` throw on movements, items, payments, audit logs; `Sale` throws if any money column
changes — only `status` may change, for voids).

**MySQL verification:** a throwaway MySQL 8.0.46 instance (own datadir in a temp dir, port 3399, deleted
afterwards — no existing database was touched) ran `migrate:fresh --seed` (all 6 CHECK constraints created)
and the full test suite: 81/81 green. A live `php artisan serve --port=8080` with 4 workers received 4
concurrent identical `POST /sales`: 1× 201 APPLIED + 3× 200 DUPLICATE, exactly 1 sale and 1 stock movement.

## 3. Endpoints

Base `/api/v1`. Every route gets `ApiSecurityHeaders`. "bound" = `auth:sanctum` + `pos.bound`
(token's device uuid must equal `X-Device-Id`, user active) + `throttle:api` (120/min/user).
"device" = bound + `pos.device` (X-Device-Id registered, same store, ACTIVE).

| Method & path | Middleware | Permission |
|---|---|---|
| GET /health | — | public |
| POST /auth/login | throttle:login (5/min per email+ip) | — |
| POST /auth/refresh | throttle:refresh (20/min per device+ip) | — |
| POST /auth/logout | bound | — |
| GET /auth/me | bound | — |
| POST /devices/register | bound | device.register |
| GET /devices | device | device.register |
| PATCH /devices/{uuid} | device | device.register (DISABLED also revokes all tokens of that device) |
| GET /sync/pull | device | any authenticated (updates devices.last_sync_at) |
| POST /sync | device + throttle:sync (60/min per X-Device-Id) | per operation (see actions); updates last_sync_at |
| POST /sales | device + throttle:sync | cashier_uuid must hold sale.create |
| GET /sales | device | report.view |
| GET /sales/{uuid} | device | sale.reprint or report.view (gate `sale.view`) |
| GET /products | device | inventory.view |
| POST /products, PUT /products/{uuid}, DELETE /products/{uuid} | device | product.edit |
| GET /audit-logs | device | report.view |

Permissions are Laravel gates generated from `App\Domain\Auth\RolePermissions` (route `can:` middleware);
sync operations check the *acting* user named in the payload (cashier/voided_by/adjusted_by/…), which may
differ from the syncing user (recorded as `synced_by`).

## 4. Security decisions

- **Access tokens**: Sanctum, 12 h (`expires_at` + `sanctum.expiration`), stored as sha256 by Sanctum. Each
  token row carries `device_uuid` (header at login) and `refresh_family_id`. `pos.bound` rejects a token
  presented with any other `X-Device-Id` (401 UNAUTHENTICATED). Expired-but-genuine tokens → `TOKEN_EXPIRED`
  (renderer looks the token up; expired rows are pruned daily with 24 h grace).
- **Refresh tokens**: 64-char random, only the sha256 is stored, 30 days, single use. Refresh runs in a
  transaction with `SELECT … FOR UPDATE`; it rotates (old row `revoked_at` + `replaced_by`, old access token
  deleted). Presenting a rotated token = reuse → whole family (refresh + access tokens) revoked, SECURITY audit
  `REFRESH_TOKEN_REUSE`. Device mismatch or inactive user on refresh also revokes the family.
- **Logout** deletes the access token and revokes its family. Disabling a device revokes all its tokens.
- **No user enumeration**: unknown email runs a dummy bcrypt check; same 401 `INVALID_CREDENTIALS` body.
  Inactive users get the same response. All failures audited `LOGIN_FAILED` (SECURITY); success `LOGIN`; `LOGOUT`.
- **Device rules** at login/refresh/middleware: unknown → 403 DEVICE_NOT_REGISTERED (login allowed with
  `device: null` only for `device.register` holders), other store → DEVICE_STORE_MISMATCH, disabled → DEVICE_DISABLED.
- **Rate limits**: login 5/min/(email, ip); api 120/min/user; sync 60/min/device; 429 `RATE_LIMITED` with `Retry-After`.
- **Error hygiene**: every `api/*` error goes through `ApiExceptionRenderer` → envelope; unexpected exceptions
  → 500 `SERVER_ERROR` with a generic message even when `APP_DEBUG=true` (no traces, no SQL). Domain exceptions
  are not reported to logs; unexpected ones are.
- **Secrets never serialized**: `User::$hidden = [password, pin_hash, remember_token]`; resources whitelist
  fields. The only place a `pin_hash` leaves the server is `approvers[]` in authenticated `/sync/pull`
  (bcrypt cost from `POS_PIN_BCRYPT_ROUNDS`, default 12; tests use 4).
- **Mass assignment**: explicit `$fillable` on every model; `preventSilentlyDiscardingAttributes` outside production.
- **Money input**: `integer:strict` (JSON numbers only, no floats/strings), upper bound ₱10B to keep all
  products of integers far below PHP_INT_MAX.
- **HTTPS**: `URL::forceScheme('https')` and HSTS header only in production; also `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- **CORS**: `api/*` only, origins from `CORS_ALLOWED_ORIGINS` (default `http://localhost:5173,https://localhost,capacitor://localhost`),
  explicit allowed headers incl. `X-Device-Id`, `Idempotency-Key`; no credentials.
- **Seeder** throws in production; demo password `password` is documented as dev-only.

## 5. Sync, idempotency and conflict strategy

`IdempotentOperationRunner` (used by `POST /sync` per op and by `POST /sales`):
1. `payload_hash = sha256(type + "\n" + canonical JSON)` (objects key-sorted recursively, lists keep order).
2. Existing `idempotency_keys(store_id, key)`: same hash → `DUPLICATE` (http 200, original entity_uuid,
   server_id, conflicts, plus `original_status`); different hash → `REJECTED IDEMPOTENCY_KEY_REUSED` (409, not retryable).
3. Otherwise the handler runs inside ONE `DB::transaction` (3 attempts on deadlock) that also inserts the
   idempotency row. Rejections (`DomainException`) roll everything back; afterwards the handler may audit
   (INVALID_TOTALS → SECURITY `SALE_REJECTED_INVALID_TOTALS`) and the runner writes WARNING `SYNC_OP_REJECTED`
   for non-retryable rejections.
4. Concurrency: a `UniqueConstraintViolationException` (sales uuid/receipt, idempotency key, …) → re-read the
   key; if the winner stored it → `DUPLICATE`/`REUSED`; otherwise `REJECTED CONFLICT` (409, retryable).
5. Any other exception → `REJECTED SERVER_ERROR` 500, retryable.

Batch: ≤ 50 ops (else whole request 422), applied in order, each its own transaction. A malformed op
(missing/invalid key, unknown type, payload not object) becomes a per-op `REJECTED VALIDATION_FAILED`.
For every type except `AUDIT_EVENTS`, `idempotency_key` must equal `payload.uuid`.

| Situation | Outcome | Notes |
|---|---|---|
| Schema invalid | REJECTED VALIDATION_FAILED 422 | details = field errors |
| Cashier/actor not active in store or lacks permission (no valid approval) | REJECTED FORBIDDEN 403 | |
| product_uuid not in store (incl. trashed) | REJECTED UNKNOWN_PRODUCT 422 | details.product_uuids |
| Line/order arithmetic, Σpayments ≠ total, bad cash change, >1 CASH, non-cash tendered≠amount/change≠0, tax_total > total | REJECTED INVALID_TOTALS 422 + SECURITY audit | nothing stored |
| `PRICE_MISMATCH` | FLAGGED | unit_price not equal to any `product_prices` row effective at an instant of [catalog_synced_at, created_at] (created_at clamped to receive time; null catalog_synced_at ⇒ instant created_at) and no valid `price_override` (cashier has price.override, or approver with approval.grant + price.override). local = client price, server = price at created_at |
| `DISCOUNT_UNAUTHORIZED` | FLAGGED | line or order discount > 0 without discount.apply / valid approval, or above `max_discount_bp` of its base (server_value = max allowed) |
| `PRODUCT_INACTIVE` | FLAGGED | product currently `is_active=false`, or `deleted_at ≤ created_at` |
| `TAX_MISMATCH` | FLAGGED | tax_total ≠ VAT of total at the store's *current* tax rate |
| `DUPLICATE_RECEIPT_NUMBER` | FLAGGED | another sale already has the receipt number → stored as `<receipt>-D<8 hex of sale uuid>` (original kept in `client_receipt_number`) |
| `NEGATIVE_STOCK` | FLAGGED | SALE movement applied anyway; server_value = resulting balance |
| `REGISTER_TOTALS_MISMATCH` | FLAGGED (closure status FLAGGED) | client cash_sales / expected_cash ≠ server recomputation |
| VOID: sale unknown | REJECTED SALE_NOT_FOUND 404, **retryable** | ordering |
| VOID: already voided | REJECTED SALE_ALREADY_VOIDED 409 | |
| CLOSE: session unknown | REJECTED REGISTER_SESSION_NOT_FOUND 404, **retryable** | |
| CLOSE: already closed | REJECTED REGISTER_ALREADY_CLOSED 409 | |
| CLOSE: variance ≠ actual − expected (client) | REJECTED INVALID_TOTALS 422 | |

Every FLAGGED item gets one `sync_conflicts` row (OPEN) and audit `SYNC_FLAGGED`; stored sales always get
`SALE_CREATED` (AUDIT) and SALE movements; every approval used (online or offline PIN) is audited `APPROVAL_USED`
(sales) or recorded in the action's audit metadata (void/adjust/close). Voids create a `sale_voids` row,
reversing `VOID` movements and set `sales.status = VOIDED` (money columns untouched).
Register close: `server_cash_sales = Σ CASH payments.amount` of non-voided sales whose `register_session_uuid`
is the session; `server_expected = opening_cash + server_cash_sales − cash_refunds + cash_adjustments`
(refunds/adjustments taken from the client — the server has no refund model yet).

Pull: `since` filters `products.updated_at`/`deleted_at` and `inventory_balances.updated_at` (`>=`);
products and inventory are paged with the same `page`/size (500); `has_more` if either has more.
Approvers (role with approval.grant AND a PIN set, inactive ones included with `is_active:false` so devices can
drop them) and settings (config defaults overlaid by `stores.settings`) are sent in full on every page.
Product edits always bump `updated_at`; price changes close the current price row and open a new one.

## 6. Tests

Command: `cd backend && php artisan test` (SQLite `:memory:`, `RefreshDatabase`).

**Result: 81 tests, 551 assertions, all passing (~1.5 s).** Also 81/81 on MySQL 8.0.46 (see §2).
`vendor/bin/pint` clean.

Coverage: all 10 pricing vectors from `docs/pricing-vectors.json` + rounding; canonical hash; login shape /
no secrets / uniform failures / inactive user / unregistered-disabled-foreign device at login / refresh
rotation / reuse revokes family / refresh from another device / logout / TOKEN_EXPIRED after 13 h / login
429; token-device binding, middleware 403 codes, admin bootstrap on unregistered device, registration
idempotency + code assignment, cross-store registration, disable revokes tokens; CREATE_SALE happy path,
DUPLICATE replay (also key-reordered payload), POST /sales 201→200, key reuse 409, tampered totals +
SECURITY audit, cash change / payment sum, GCash reference, price change inside/outside window,
price override approval (manager ok, supervisor not), unauthorized discount, approved discount, max discount
cap, inactive & soft-deleted products, negative stock, unknown product, foreign-store cashier, synced_by ≠
cashier, schema errors, simulated concurrent duplicate via unique index, receipt collision, future
created_at clamp; void permission/approval/already voided/not-found retryable; inventory adjust by role,
cashier denied w/o approval, supervisor approval insufficient, manager approval ok, sign rules; register
open/sale/close reconciled and mismatch flagged + close errors; mixed batch (APPLIED/REJECTED/REJECTED/
APPLIED/DUPLICATE) with independent commits; 51-op batch 422; audit event dedupe; key ≠ uuid; pull full
shape/approvers/settings overrides/incremental/soft-deletes/pagination; product permissions & price history;
error envelopes for 401/403/404/405/422/429/500 (no internals), report permissions, CORS allow/deny,
security headers.

## 7. Contract deviations / clarifications (client agent: please read)

1. **Line discount approval**: `items[].discount` accepts an optional `approval` object (same shape as
   `order_discount.approval`). The contract had no way to approve a line discount for a cashier.
2. **`TAX_MISMATCH` conflict** (new type): `tax_total` that differs from the server's VAT at the *current*
   store tax rate is FLAGGED, not REJECTED (the rate can change while a device is offline). `tax_total > total` is INVALID_TOTALS.
3. **`DUPLICATE_RECEIPT_NUMBER` conflict** (new type): a receipt number already used by a *different* sale
   uuid no longer violates the unique index — the sale is stored as `<receipt>-D<first 8 hex of uuid>` and FLAGGED
   (money changed hands, never drop it). `GET /sales/{uuid}` returns both `receipt_number` and `client_receipt_number`.
4. **Discount cap applies even with approval** (`≤ max_discount_bp`, per contract wording "and must be").
5. **`POST /sales` body**: success → `{ "data": <Sale as GET /sales/{uuid}>, "result": <sync op result> }`
   (201 APPLIED/FLAGGED, 200 DUPLICATE). Rejection → error envelope with the op's status (409 IDEMPOTENCY_KEY_REUSED,
   422 INVALID_TOTALS/UNKNOWN_PRODUCT/VALIDATION_FAILED, 403 FORBIDDEN …). Header `Idempotency-Key` must equal body `uuid` (422 otherwise).
6. **`idempotency_key` must equal `payload.uuid`** for CREATE_SALE, VOID_SALE, ADJUST_INVENTORY, OPEN_REGISTER,
   CLOSE_REGISTER (AUDIT_EVENTS: any uuid). Mismatch → REJECTED VALIDATION_FAILED.
7. DUPLICATE results carry an extra `original_status` (`APPLIED`/`FLAGGED`).
8. **Additional error codes**: `SALE_NOT_FOUND` (404, retryable), `SALE_ALREADY_VOIDED` (409),
   `REGISTER_SESSION_NOT_FOUND` (404, retryable), `REGISTER_ALREADY_CLOSED` (409), `CONFLICT` (409, retryable —
   lost a race on a unique index without a stored winner), `METHOD_NOT_ALLOWED` (405); in op results
   `SERVER_ERROR` uses http_status 500 and `retryable: true`. Invalid/inactive/foreign cashier or actor → `FORBIDDEN` 403.
9. **Pre-registration routes**: `/auth/me`, `/auth/logout`, `/devices/register` need only a device-bound token
   (so an admin who logged in with `device: null` can register). All other authenticated routes need a
   registered ACTIVE device of the user's store. A missing `X-Device-Id` on an authenticated call → 401 (binding fails).
10. `/auth/refresh` is rate-limited (20/min per device+ip) and re-checks the device (403 DEVICE_* codes possible).
11. **Validation details**: money/quantity fields must be JSON integers (strings/floats → VALIDATION_FAILED);
    `receipt_number` ≤ 48 chars `[A-Za-z0-9_-]`; `items` 1..500; `payments` may be empty only if total is 0;
    non-cash `reference` required is a schema rule (VALIDATION_FAILED), non-cash tendered/change rules are INVALID_TOTALS.
12. **CLOSE_REGISTER**: variance ≠ actual_cash − expected_cash (client's own numbers) → REJECTED INVALID_TOTALS;
    voided sales are excluded from cash_sales; up to two REGISTER_TOTALS_MISMATCH conflicts (cash_sales, expected_cash).
    `approval` optional on OPEN_REGISTER too.
13. A sale referencing a `register_session_uuid` not (yet) on the server is accepted (FK null, uuid kept).
14. **Pull**: inventory is paginated alongside products (same page); approvers include inactive approvers
    (`is_active: false`); `GET /products` items also include `quantity_on_hand`.
15. **AUDIT_EVENTS**: optional per-event `level` (INFO|WARNING|SECURITY|AUDIT, default INFO); ≤ 500 events;
    `action` must match `^[A-Z0-9_]+$`; result `entity_uuid` is null.
16. `POST /products` accepts optional `uuid` and `initial_stock`; responses use `{ "data": … }` wrapping.

## 8. Known limitations

- No endpoints for user management, setting PINs, editing store settings, or resolving `sync_conflicts`
  (rows and `resolution_status/resolved_by` columns exist). Users/PINs come from the seeder only.
- `sale.refund` / RETURN flow not implemented; register close takes cash_refunds/adjustments from the client.
- `is_active` has no history: PRODUCT_INACTIVE uses the *current* flag (soft-delete uses `deleted_at` vs created_at).
- Price history supports only "effective now" changes (no scheduled future prices); pull relies on the product's `updated_at` bump.
- One open register session per device is not enforced.
- Device-uploaded audit metadata is stored as sent (the client must not put secrets in it).
- Refresh is strict: two concurrent refreshes with the same token from one client look like reuse and revoke the family.
- Rate limiting uses the configured cache store (`database` by default); multi-server deployments need Redis.
- SQLite ignores `lockForUpdate`; concurrency guarantees rely on MySQL row locks + unique indexes (verified once
  on MySQL 8, see §2). CHECK constraints exist only on MySQL.
