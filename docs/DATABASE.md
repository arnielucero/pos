# Database

Two databases with different jobs:

- **Device — SQLite** (`app/src/infrastructure/database/migrations.ts`). The POS's primary store while
  selling. Encrypted with SQLCipher on Android; sql.js (unencrypted, IndexedDB-persisted) in the web dev/E2E build.
- **Server — MySQL 8** (`backend/database/migrations/`). Authoritative record of synchronized financial data.

Shared rules on both sides: money is integer centavos, quantities are integers, public ids are UUIDs,
timestamps are UTC. Financial rows are **append-only** — a void is a separate record plus reversing
inventory movements; a sale's money columns never change after insert.

## Uniqueness guarantees (duplicate protection lives in the database)

| Guarantee | Device (SQLite) | Server (MySQL) |
|---|---|---|
| A sale exists once | `sales.uuid UNIQUE` | `UNIQUE(store_id, uuid)` |
| Receipt numbers don't repeat | `sales.receipt_number UNIQUE` | `UNIQUE(store_id, receipt_number)` |
| An operation applies once | `sync_queue.uuid UNIQUE` (= idempotency key) | `idempotency_keys UNIQUE(store_id, key)` |
| A sale is voided once | status check in the use case | `sale_voids UNIQUE(sale_id)` |
| Device identity | secure storage | `devices.uuid UNIQUE`, `UNIQUE(store_id, code)` |
| Inventory movement once | `inventory_movements.uuid PK` | `inventory_movements.uuid UNIQUE` |

## Inventory model

Ledger + balance on both sides. Every stock change is an `inventory_movements` row
(`STOCK_IN, STOCK_OUT, SALE, RETURN, ADJUSTMENT, TRANSFER, VOID`, signed quantity, reference to the
source document). The balance table is updated in the **same transaction** as the movement, so reads are
a single indexed lookup. On the device, `quantity_on_hand = server_quantity + Σ unsynced local movements`,
so a catalog pull never erases deductions from sales that haven't synced yet.


## Device schema (SQLite)

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

## Server schema (MySQL)

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
