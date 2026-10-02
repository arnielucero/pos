# API Contract — v1

This file is the **canonical contract** between the Android POS (`app/`) and the Laravel
backend (`backend/`). Both sides are implemented and tested against it. Change it first,
then change code.

- Base URL: `https://<host>/api/v1`
- Content type: `application/json` (requests and responses)
- All timestamps: ISO‑8601 UTC with `Z` (e.g. `2026-10-02T01:42:00Z`)
- **All money is integer centavos** (`₱120.00` → `12000`). Never floats.
- **Quantities are positive integers** (units). Weighted items are out of scope for v1.
- Percentages are **basis points** (`12.5%` → `1250`).
- Public identifiers are UUIDs (v4). Server auto-increment ids are never required by the client.

## Common headers

| Header | When | Notes |
|---|---|---|
| `Authorization: Bearer <access_token>` | every authenticated call | Sanctum personal access token |
| `X-Device-Id: <device uuid>` | **every** call, including login | Must be a registered, active device for authenticated calls |
| `Idempotency-Key: <uuid>` | `POST /sales`, each op inside `POST /sync` carries its own key | For sales the key **is** the sale uuid |
| `Accept: application/json` | always | |

## Error envelope

Every non-2xx response:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Human readable, no internals", "details": { "field": ["msg"] } } }
```

Error codes (non-exhaustive): `UNAUTHENTICATED` (401), `TOKEN_EXPIRED` (401), `INVALID_CREDENTIALS` (401),
`FORBIDDEN` (403), `DEVICE_NOT_REGISTERED` (403), `DEVICE_DISABLED` (403), `DEVICE_STORE_MISMATCH` (403),
`NOT_FOUND` (404), `IDEMPOTENCY_KEY_REUSED` (409), `VALIDATION_FAILED` (422), `INVALID_TOTALS` (422),
`UNKNOWN_PRODUCT` (422), `RATE_LIMITED` (429), `SERVER_ERROR` (500 — never includes stack traces).

**Retry semantics for the client:** network errors, `408`, `429`, `5xx` are retryable.
`401 TOKEN_EXPIRED` → refresh then retry. Other `4xx` are **permanent** for that payload
(the operation goes to `FAILED` and is shown to a manager; it is never deleted).

## Roles and permissions

Server is authoritative; the client mirrors these only for UX.

| Permission | ADMIN | MANAGER | SUPERVISOR | CASHIER | INVENTORY |
|---|:-:|:-:|:-:|:-:|:-:|
| `sale.create` | ✓ | ✓ | ✓ | ✓ | |
| `sale.void` | ✓ | ✓ | ✓ | | |
| `sale.refund` | ✓ | ✓ | | | |
| `sale.reprint` | ✓ | ✓ | ✓ | ✓ | |
| `discount.apply` | ✓ | ✓ | ✓ | | |
| `price.override` | ✓ | ✓ | | | |
| `inventory.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `inventory.adjust` | ✓ | ✓ | | | ✓ |
| `product.edit` | ✓ | ✓ | | | |
| `report.view` | ✓ | ✓ | ✓ | | ✓ |
| `register.open` | ✓ | ✓ | ✓ | ✓ | |
| `register.close` | ✓ | ✓ | ✓ | | |
| `settings.edit` | ✓ | ✓ | | | |
| `device.register` | ✓ | ✓ | | | |
| `approval.grant` | ✓ | ✓ | ✓ | | |
| `sync.diagnostics` | ✓ | ✓ | | | |

A user without a permission may still perform the action **if** a user holding both that
permission and `approval.grant` approves it (manager PIN). Approved actions carry an
`approval` object (see below).

## Pricing algorithm (must be identical on client and server)

Implemented in `app/src/domain/services/PricingCalculator.ts` and
`backend/app/Domain/Pricing/PricingCalculator.php`, with **shared test vectors** in
`docs/pricing-vectors.json` that both test suites load.

`roundHalfUp(x)` = round to nearest integer, .5 away from zero (inputs are non-negative).

For each line:
1. `line_gross = unit_price × quantity`
2. Line discount (optional):
   - `PERCENT`: `line_discount = roundHalfUp(line_gross × value / 10000)`, `0 ≤ value ≤ 10000`
   - `AMOUNT`: `line_discount = value`
   - then `line_discount = min(line_discount, line_gross)`
3. `line_total = line_gross − line_discount`

Order:
4. `subtotal = Σ line_gross`
5. `lines_net = Σ line_total`
6. Order discount (optional) applies to `lines_net`, same PERCENT/AMOUNT rule, capped at `lines_net` → `order_discount`
7. `discount_total = Σ line_discount + order_discount`
8. `total = lines_net − order_discount`
9. Prices are **VAT-inclusive**. `tax_total = roundHalfUp(total × tax_rate_bp / (10000 + tax_rate_bp))`
   (informational; `tax_rate_bp` is the store setting, default `1200`).

Payments:
- Each payment has `method`, `amount` (applied to the sale), `tendered`, `change`.
- Non-cash (`GCASH`, `CARD`): `tendered = amount`, `change = 0`, `reference` required (external terminal / wallet ref no.).
- `CASH`: `change = tendered − amount`, `change ≥ 0`. At most one CASH payment per sale.
- `Σ amount == total` exactly. Change is only ever produced by the cash payment.

## Approval object

```json
{ "approved_by_uuid": "uuid", "approved_at": "2026-10-02T01:00:00Z", "mode": "ONLINE" | "OFFLINE_PIN", "reason": "string ≤ 255" }
```

Server re-validates that `approved_by_uuid` is an active user in the same store holding
`approval.grant` **and** the permission being approved. Offline approvals are always audited.

---

## Auth

### `POST /auth/login`
Rate limit: 5/min per (email, ip). Headers: `X-Device-Id`.

```json
{ "email": "cashier@store1.test", "password": "secret" }
```

`200`:

```json
{
  "access_token": "1|plain...", "access_expires_at": "…Z",
  "refresh_token": "opaque-64-chars", "refresh_expires_at": "…Z",
  "user": { "uuid": "…", "name": "…", "email": "…", "role": "CASHIER",
            "permissions": ["sale.create", "…"], "store": { "uuid": "…", "code": "STORE-001", "name": "…" } },
  "device": { "uuid": "…", "code": "POS-01", "status": "ACTIVE" } | null,
  "offline_policy": { "max_offline_hours": 72, "max_failed_attempts": 5 },
  "server_time": "…Z"
}
```

- Access token lifetime 12h, bound to the device (`X-Device-Id`) — using it from another device id → `401 UNAUTHENTICATED`.
- Refresh token: opaque random, **stored hashed** server-side, lifetime 30 days, single use (rotated on refresh; reuse of a rotated token revokes the whole family).
- If the device is unregistered: users with `device.register` get `200` with `"device": null` (client must call `/devices/register` next); other users get `403 DEVICE_NOT_REGISTERED`.
- Failed logins → `401 INVALID_CREDENTIALS` (no user enumeration), audited as `LOGIN_FAILED`.

### `POST /auth/refresh`
`{ "refresh_token": "…" }` + `X-Device-Id` → same shape as login (new access + new refresh token).

### `POST /auth/logout` (auth) → `204`. Revokes current access token and its refresh token family.

### `GET /auth/me` (auth) → `{ "user": {…same as login…} }`

## Devices

### `POST /devices/register` (auth, `device.register`)
```json
{ "device_uuid": "uuid", "device_name": "Front counter tablet", "device_type": "ANDROID_TABLET" }
```
`201` → `{ "data": { "uuid": "…", "code": "POS-03", "name": "…", "status": "ACTIVE", "store_uuid": "…", "registered_at": "…Z" } }`.
Idempotent per `device_uuid` (re-registering the same uuid in the same store returns `200` with the existing device).
`code` is server-assigned, unique per store, and is the prefix of receipt numbers.

### `GET /devices` (auth, `device.register`) → list for the user's store.
### `PATCH /devices/{uuid}` (auth, `device.register`) `{ "status": "ACTIVE" | "DISABLED" }`.

## Catalog / pull sync

### `GET /sync/pull?since=<ISO ts>&page=<n>` (auth)
Incremental download of everything the POS needs offline for the device's store.
Omit `since` for a full download. Page size 500 products.

```json
{
  "server_time": "…Z",
  "has_more": false,
  "products": [
    { "uuid": "…", "sku": "CR-001", "barcode": "4800000000011", "name": "Chicken Rice",
      "category": "Meals", "price": 12000, "is_active": true, "track_stock": true,
      "updated_at": "…Z", "deleted": false }
  ],
  "inventory": [ { "product_uuid": "…", "quantity_on_hand": 25, "updated_at": "…Z" } ],
  "approvers": [ { "user_uuid": "…", "name": "Maria Manager", "permissions": ["approval.grant", "sale.void", "…"],
                   "pin_hash": "$argon2id$…" | "$2y$…", "is_active": true } ],
  "settings": { "tax_rate_bp": 1200, "currency": "PHP", "receipt_header": "HMR POS\nSTORE-001",
                "receipt_footer": "Thank you!", "max_discount_bp": 5000, "offline_max_hours": 72 }
}
```

- Client stores `server_time` of the **first** page as the next `since` once all pages are applied
  (with a 2-minute overlap; upserts are idempotent).
- `deleted: true` → product soft-deleted on server; client marks it inactive (keeps it for history).
- `pin_hash` is a slow hash (bcrypt cost ≥ 12) of the approver's 6-digit PIN. See SECURITY.md for the trade-off.

### `GET /products?search=&page=` (auth) — paginated, server-side search (admin screens).
### `POST /products`, `PUT /products/{uuid}` (auth, `product.edit`) — creates/updates; a price change
closes the current `product_prices` row and opens a new one. `DELETE /products/{uuid}` soft-deletes.

## Push sync

### `POST /sync` (auth) — rate limit 60/min per device
Batch of queued operations, applied **in order**, each independently (one failure does not
roll back the others). Max 50 ops per request.

```json
{
  "operations": [
    { "idempotency_key": "uuid", "type": "CREATE_SALE", "payload": { … } }
  ]
}
```

`200`:

```json
{
  "results": [
    { "idempotency_key": "uuid", "status": "APPLIED" | "DUPLICATE" | "FLAGGED" | "REJECTED",
      "http_status": 201, "entity_uuid": "…", "server_id": 123,
      "conflicts": [ { "type": "PRICE_MISMATCH", "entity_type": "sale_item", "entity_uuid": "…",
                       "local_value": 12000, "server_value": 13000, "message": "…" } ],
      "error": null | { "code": "INVALID_TOTALS", "message": "…" },
      "retryable": false }
  ],
  "server_time": "…Z"
}
```

- `APPLIED`: created now. `DUPLICATE`: same key + same payload hash already applied → returns the original result.
  `FLAGGED`: stored (money changed hands, so we never drop it) but needs manager review; `conflicts` explains why.
  `REJECTED`: not stored; `retryable` tells the client whether to retry.
- Same `idempotency_key` with a **different** payload hash → `REJECTED`, `IDEMPOTENCY_KEY_REUSED`, not retryable.
- Idempotency is enforced by DB unique constraints (`idempotency_keys(store_id, key)`, `sales(store_id, uuid)`,
  `sales(store_id, receipt_number)`), not only application checks.

### Operation types and payloads

#### `CREATE_SALE` (key = sale uuid). Also available standalone as `POST /sales` with `Idempotency-Key` header (201 new / 200 replay).

```json
{
  "uuid": "…", "receipt_number": "POS-03-20261002-00042",
  "cashier_uuid": "…", "register_session_uuid": "…",
  "created_at": "…Z", "catalog_synced_at": "…Z",
  "items": [
    { "uuid": "…", "product_uuid": "…", "quantity": 2, "unit_price": 12000,
      "discount": { "type": "PERCENT", "value": 1000 } | null,
      "price_override": { "original_price": 12000, "approval": {…} } | null,
      "line_gross": 24000, "line_discount": 2400, "line_total": 21600 }
  ],
  "order_discount": { "type": "AMOUNT", "value": 1000, "approval": {…} | null } | null,
  "subtotal": 24000, "discount_total": 3400, "tax_total": 2207, "total": 20600,
  "payments": [ { "uuid": "…", "method": "CASH", "amount": 20600, "tendered": 50000, "change": 29400, "reference": null } ]
}
```

Server validation, in order:
1. Schema validation → `REJECTED VALIDATION_FAILED` (not retryable).
2. Device active and in the user's store; `cashier_uuid` is an active user of that store with `sale.create`
   (the syncing user may differ from the cashier — recorded as `synced_by`).
3. Every `product_uuid` exists in the store's catalog (even if inactive/deleted) else `REJECTED UNKNOWN_PRODUCT`.
4. **Recompute** every line and the totals with the pricing algorithm from the client's quantities, unit prices
   and discounts. Any arithmetic mismatch with the client's numbers, or `Σ payments.amount ≠ total`, or bad
   cash change → `REJECTED INVALID_TOTALS` (a genuine client never produces this; treated as tampering, audited as `SECURITY`).
5. Price check: `unit_price` must equal a server price that was effective at some instant in
   `[catalog_synced_at, created_at]` (created_at clamped to server receive time). Otherwise, unless a valid
   `price_override` approval exists → conflict `PRICE_MISMATCH`.
6. Discounts require `discount.apply` (cashier) or a valid approval; and must be ≤ `max_discount_bp` of the
   line/order → else conflict `DISCOUNT_UNAUTHORIZED`.
7. Product inactive/deleted at `created_at` → conflict `PRODUCT_INACTIVE`.
8. Stock: sale is applied even if it drives the balance negative (goods physically left) → conflict `NEGATIVE_STOCK`.
9. Any conflict → stored with `status = FLAGGED`, a `sync_conflicts` row per conflict, audit `SYNC_FLAGGED`.
   Otherwise `status = COMPLETED`. Both create inventory movements (type `SALE`) and an audit `SALE_CREATED`.
   All of it inside **one DB transaction**.

#### `VOID_SALE` (key = new uuid)
```json
{ "uuid": "void-uuid", "sale_uuid": "…", "reason": "Customer changed mind", "voided_at": "…Z",
  "voided_by_uuid": "…", "approval": {…} | null }
```
Requires `sale.void` for `voided_by_uuid` or a valid approval. Sale must exist (if the sale op is still
earlier in the same batch it will already be applied). Creates reversing inventory movements (`VOID`),
sets sale `status = VOIDED` (the sale row's financial fields never change), audit `SALE_VOIDED`.
Voiding an already-voided sale → `REJECTED SALE_ALREADY_VOIDED`, not retryable.
If the sale does not exist yet → `REJECTED SALE_NOT_FOUND`, **retryable** (ordering).

#### `ADJUST_INVENTORY` (key = movement uuid)
```json
{ "uuid": "…", "product_uuid": "…", "type": "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT", "quantity": -3,
  "reason": "Damaged", "adjusted_by_uuid": "…", "created_at": "…Z", "approval": {…} | null }
```
`quantity` is signed (positive adds stock). `STOCK_IN` must be > 0, `STOCK_OUT` < 0. Requires `inventory.adjust`
or approval. Audit `INVENTORY_ADJUSTED`.

#### `OPEN_REGISTER` (key = session uuid)
```json
{ "uuid": "…", "opened_by_uuid": "…", "opened_at": "…Z", "opening_cash": 200000 }
```

#### `CLOSE_REGISTER` (key = new uuid)
```json
{ "uuid": "close-uuid", "session_uuid": "…", "closed_by_uuid": "…", "closed_at": "…Z",
  "actual_cash": 512300, "expected_cash": 512500, "cash_sales": 312500, "cash_refunds": 0,
  "cash_adjustments": 0, "variance": -200, "approval": {…} | null }
```
Server recomputes `cash_sales` and `expected_cash` from the synced sales of that session and records both the
client and server figures; a difference becomes conflict `REGISTER_TOTALS_MISMATCH` (FLAGGED, not rejected).
Requires `register.close` or approval.

#### `AUDIT_EVENTS` (key = uuid of the batch)
```json
{ "events": [ { "uuid": "…", "action": "PRINT_FAILED", "user_uuid": "…", "entity_type": "sale",
                "entity_uuid": "…", "metadata": {…}, "occurred_at": "…Z" } ] }
```
Device-side audit trail upload; deduplicated by event uuid.

## Sales (read)

- `GET /sales/{uuid}` (auth) → `{ "data": { …sale with items, payments, status, conflicts… } }`
- `GET /sales?from=&to=&status=&page=` (auth, `report.view`)

## Audit

- `GET /audit-logs?action=&from=&to=&page=` (auth, `report.view`)

## Health

- `GET /health` (no auth) → `{ "status": "ok", "server_time": "…Z" }` — used by the client to tell
  "network up" apart from "API reachable".

---

## Implementation clarifications (v1, as built)

These refine the contract above and are implemented by both sides.


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

