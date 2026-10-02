# Offline-first data & synchronization (Android POS)

The tablet must keep selling when the network or the API is down. Every business write is
committed to the **local SQLite database first** (encrypted with SQLCipher on Android) together
with an **outbox row** (`sync_queue`) in the *same transaction*. A background **SyncEngine**
later pushes the outbox to `POST /api/v1/sync` and pulls catalog changes from
`GET /api/v1/sync/pull`. The server is authoritative and idempotent (docs/API.md).

```
 UI ──► use case ──► ONE SQLite transaction ─────────────────────────────┐
                     sale + items + payments + inventory movements        │
                     + balance update + sync_queue row + audit_logs row   │
                                                                          ▼
                    SyncEngine (single-flight) ── push ──► POST /sync (≤50 ops, in order)
                          ▲          └─── pull ──► GET /sync/pull?since=&page=
   triggers: app start, login, network regained, 60 s timer, backoff deadline, "Sync now"
```

## 1. Local write path (the outbox pattern)

| Use case | Same-transaction writes | Queue op (idempotency key) |
|---|---|---|
| `CompleteSaleUseCase` | receipt counter, `sales`, `sale_items`, `payments`, `inventory_movements` (type `SALE`, −qty) + `inventory.quantity_on_hand`, `audit_logs` `SALE_CREATED` | `CREATE_SALE` (key = **sale uuid**) |
| `VoidSaleUseCase` | `sales.status = VOIDED` (money columns untouched), reversing `VOID` movements (+qty), audit `SALE_VOIDED` | `VOID_SALE` (key = void uuid = `payload.uuid`) |
| `AdjustInventoryUseCase` | movement (`STOCK_IN`/`STOCK_OUT`/`ADJUSTMENT`), balance, audit | `ADJUST_INVENTORY` (key = movement uuid) |
| `OpenRegisterUseCase` | `register_sessions` row, audit | `OPEN_REGISTER` (key = session uuid) |
| `CloseRegisterUseCase` | session closed with Z figures, audit | `CLOSE_REGISTER` (key = close uuid) |
| (push time) | un-batched `audit_logs` assigned a `batch_uuid` | `AUDIT_EVENTS` (key = batch uuid) |

Rules:
- **Payload frozen at enqueue time.** `sync_queue.payload` is the exact snake_case body sent to the
  server; retries resend it byte-for-byte with the same key, so the server's
  `(store, idempotency_key)` + payload-hash check returns `DUPLICATE`, never a double sale.
- **Key = `payload.uuid`** for every op except `AUDIT_EVENTS` (backend rule, see
  `docs/notes/backend-implementation.md` §7.6).
- **Prices come from the local catalog** at checkout (never from UI state) using the shared
  `PricingCalculator` (vectors in `docs/pricing-vectors.json`); `catalog_synced_at` (server time of
  the last completed pull) is sent so the server can validate the price window.
- **Receipt number** `{deviceCode}-{YYYYMMDD}-{seq:05}` uses a per-device, per-local-day counter
  (`receipt_counters`) incremented inside the sale transaction — a rolled-back sale does not
  consume a number.
- **Print after commit.** Printing happens after the transaction; failures only set
  `print_status = FAILED`. Then the SyncEngine is *nudged* (non-blocking).
- Atomicity is tested by injecting a failure into the audit write mid-transaction: nothing is
  persisted and stock is unchanged (`tests/integration/completeSale.test.ts`).

### Concurrency
`SqlDatabase` serializes all access with a FIFO mutex; a transaction holds it from `BEGIN` to
`COMMIT/ROLLBACK`, so two async flows (e.g. a checkout and a background pull) never interleave
statements inside each other's transaction. Code inside a transaction must use the
transaction-bound repositories (`uow.run(r => …)`), never the global ones (that would wait on
the lock it already holds).

## 2. Push: result handling

`PushSyncQueueUseCase` claims due items (`status = PENDING AND (next_retry_at IS NULL OR ≤ now)`,
oldest first, max 50) by flipping them to `IN_FLIGHT`, sends them, and applies each result:

| Server result | Queue row | Local entity |
|---|---|---|
| `APPLIED` | `DONE` | sale `SYNCED`, `server_id` stored; its movements → `SYNCED` |
| `DUPLICATE` (`original_status` `APPLIED`) | `DONE` | same as APPLIED |
| `FLAGGED`, or `DUPLICATE` with `original_status = FLAGGED` | `DONE` | sale `FLAGGED`; one `sync_conflicts` row per conflict (`PRICE_MISMATCH`, `DISCOUNT_UNAUTHORIZED`, `PRODUCT_INACTIVE`, `NEGATIVE_STOCK`, `TAX_MISMATCH`, `DUPLICATE_RECEIPT_NUMBER`, `REGISTER_TOTALS_MISMATCH`, … handled generically) |
| `REJECTED`, `retryable: true` (e.g. `SALE_NOT_FOUND`, `CONFLICT`, `SERVER_ERROR`) | `PENDING` + backoff | unchanged |
| `REJECTED`, `retryable: false` (e.g. `VALIDATION_FAILED`, `INVALID_TOTALS`, `IDEMPOTENCY_KEY_REUSED`, `SALE_ALREADY_VOIDED`) | `FAILED` (kept forever) | sale `FAILED`; visible in diagnostics; `INVALID_TOTALS`/`IDEMPOTENCY_KEY_REUSED` also logged at `SECURITY` |
| no result for a sent key (partial response) | `PENDING` + backoff (`MISSING_RESULT`) | unchanged (safe: idempotent) |

Whole-request failures:

| Failure | Handling |
|---|---|
| network error / timeout / `408` / `429` / `5xx` | every item in the batch: attempts+1, backoff; engine phase `OFFLINE`/`ERROR`; network re-probed |
| `401 TOKEN_EXPIRED` | `HttpClient` refreshes (single-flight `POST /auth/refresh`, rotated tokens saved to secure storage) and retries once — transparent to the queue |
| refresh rejected / no token / `401 UNAUTHENTICATED` | items **released** to `PENDING` without consuming an attempt; `reauthRequired = true`; engine pauses (`AUTH_REQUIRED`) until an online login. **Nothing is dropped.** |
| `403` (device disabled / store mismatch) | items released, engine `ERROR` (`BLOCKED`), no attempts consumed |
| other `4xx` for the whole request | items `FAILED` (contract: permanent for that payload) |

**Backoff**: after the n‑th failed attempt the next try is scheduled at
`5 s, 15 s, 30 s, 60 s, 300 s, 300 s, …` (`RetryPolicy`); the **8th** failure moves the item to
`FAILED`. A manager with `sync.diagnostics` can *Retry* a failed item (attempts reset, same
key/payload). Items are never deleted.

**Ordering**: items are sent in insertion order within a batch and the server applies them in
order. If a `CREATE_SALE` is in backoff while its `VOID_SALE` becomes due, the server answers
`SALE_NOT_FOUND` (retryable) and the void simply retries later.

## 3. Pull: catalog merge

`PullCatalogUseCase` calls `GET /sync/pull?since=<cursor>&page=n` until `has_more = false`
(500 products/page; inventory is paginated alongside). Each page is applied in **its own
transaction** with idempotent upserts:

- **Products**: upsert by uuid; `deleted: true` → kept locally but `is_active = 0, deleted = 1`
  (history and old receipts still resolve).
- **Inventory**: `server_quantity = server balance` and
  `quantity_on_hand = server balance + Σ(local movements with sync_status = PENDING)`.
  A local sale not yet accepted by the server therefore stays deducted even when a fresher
  server balance arrives; once the server applies it (APPLIED/DUPLICATE/FLAGGED) its movements
  turn `SYNCED`, and the next server balance already includes it — no double counting
  (`tests/integration/pullMerge.test.ts`).
- **Approvers**: upsert of server-owned columns (name, permissions, `pin_hash`, `is_active`);
  local PIN attempt counters/lockouts are preserved; `is_active:false` hides them.
- **Settings**: merged into `store.settings` (tax rate, receipt header/footer, `max_discount_bp`, …).

The cursor advances **only after the last page**, to the *first* page's `server_time` minus a
2‑minute overlap (`sync.pull_since`), and `sync.catalog_synced_at` is set to that `server_time`.
A crash mid-pull just repeats pages (upserts are idempotent).

## 4. SyncEngine

`app/src/infrastructure/synchronization/SyncEngine.ts`

- **Single-flight lock**: concurrent triggers join the running sync and schedule exactly one
  follow-up run (no parallel pushes, no double sends — tested).
- **Triggers**: `start()` (app start), `afterSignIn()` (login), network transition to `ONLINE`,
  a 60 s periodic timer, a wake-up timer at the earliest `next_retry_at`, the *Sync now* button,
  and a `nudge()` after every local write.
- **Interruptible & resumable**: `stop()` aborts the in-flight HTTP request (AbortController);
  claimed items go back to `PENDING` without consuming attempts. On startup
  `resetInFlight()` turns any `IN_FLIGHT` rows left by a crash/kill back into `PENDING`
  (`tests/integration/crashRecovery.test.ts`).
- **Phases** exposed to the UI: `IDLE`, `SYNCING`, `OFFLINE`, `ERROR`, `AUTH_REQUIRED`, with
  pending/in-flight/failed counts, flagged sales and `lastSyncAt`.

### Network detection
`NetworkDetector` combines the OS signal (`@capacitor/network`; `navigator.onLine` on web) with an
API probe (`GET /health`, 4 s timeout):

| State | Meaning |
|---|---|
| `OFFLINE` | OS reports no connectivity |
| `UNSTABLE` | connected, but `/health` failed or timed out (captive portal, API down) |
| `ONLINE` | connected and `/health` answered `{status:"ok"}` |

It re-probes on every OS change, every 30 s while degraded and every 120 s while online, and
after a failed push.

## 5. What the cashier sees

- Header pill: `🟢 Synced · Last sync 09:42`, `🟡 3 pending`, `🔄 Syncing · 3 pending`,
  `🔴 Offline · 5 pending`, `🟠 Unstable · 2 pending`, `⚠ Sync error`, `⚠ Sign in again to sync`.
- Offline banner: "You are offline. Sales continue normally. N transactions pending."
- Transactions list shows per-sale `PENDING / SYNCED / FLAGGED / FAILED` and `NOT PRINTED`.
- *Sync* page: counts, last sync, last error, *Sync now*; with `sync.diagnostics`: failed ops
  (code, message, attempts, Retry), pending ops (next retry), conflicts, recent audit and log.

## 6. Offline authentication & approvals (summary)

- **Online login** stores access + refresh tokens and a **PBKDF2‑SHA256 verifier**
  (210,000 iterations, 16‑byte random salt, WebCrypto) of the password in secure storage
  (Android Keystore-backed), with the profile, last online auth time and a failed-attempt counter.
- **Offline login** is allowed only for the **last 5 users** who signed in online on this device,
  within `max_offline_hours`, while failed attempts `< max_failed_attempts`; reaching the limit
  locks offline login for that user until a successful online login. Clock rollback > 5 min is refused.
- The sign-in screen tries online first and falls back to offline **only on network failures**
  (never on `INVALID_CREDENTIALS`).
- **Manager PIN approvals** are verified locally against the synced bcrypt `pin_hash`
  (`bcryptjs`, `$2y$` accepted), with a 5‑attempt / 5‑minute per-approver lockout; every success
  and failure is audited and the server re-validates the approver. The approval object carries
  `mode: ONLINE` when the API was reachable at approval time, otherwise `OFFLINE_PIN`.

## 7. Failure scenarios

| Scenario | Outcome |
|---|---|
| Network drops during checkout | Sale is local; nothing to wait for. Queue row `PENDING`. |
| App killed right after commit, before push | Row is `PENDING` on restart; pushed at next trigger. |
| App killed during push | Row `IN_FLIGHT` → reset to `PENDING` on start; re-push uses the same key → `DUPLICATE` if the server had applied it. |
| Server applied but response lost | Same as above (`DUPLICATE`, original result returned). |
| Price changed on server while offline | Sale stored, `FLAGGED` with `PRICE_MISMATCH` for manager review; money never dropped. |
| Stock goes negative on server | Sale applied, `FLAGGED` `NEGATIVE_STOCK`. |
| Refresh token revoked | Push paused, banner asks for online sign-in; queue intact. |
| Tablet offline for days | Sales continue until `max_offline_hours` blocks *new offline logins*; already signed-in session continues; everything syncs when back. |
| Corrupt/invalid server response | Treated as retryable (`INVALID_RESPONSE`), backoff, max 8 attempts. |

## 8. Known limitations

- Refunds and paid-in/paid-out are not implemented (`cash_refunds` and `cash_adjustments` are 0).
- No automatic conflict *resolution* UI — conflicts are recorded and shown; resolution happens in
  the back office (server-side `sync_conflicts`).
- Web build (dev/E2E) persists sql.js to IndexedDB with a 200 ms debounce and flush on
  `pagehide`; it is unencrypted and not for production use.
