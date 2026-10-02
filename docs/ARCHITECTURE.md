# Architecture

```
┌──────────────────────── Android tablet (Capacitor) ────────────────────────┐
│ presentation  React pages/components/hooks ── useContainer() ──┐            │
│                                                                ▼            │
│ application   use cases (CompleteSale, VoidSale, PushSyncQueue, …) + ports  │
│                                                                ▼            │
│ domain        entities, value objects, PricingCalculator, policies, errors  │
│                                                                ▲            │
│ infrastructure SQLite repos · HttpApiGateway · SyncEngine · ESC/POS printer │
│               · Keystore secure storage · NetworkDetector · logger          │
│                   │ SQLCipher DB          │ Kotlin plugin (BT SPP / TCP 9100)│
└───────────────────┼───────────────────────┼─────────────────────────────────┘
                    │ HTTPS /api/v1 (sync queue, idempotency keys)
┌───────────────────▼──────────────── Laravel ────────────────────────────────┐
│ routes → middleware (auth:sanctum, device binding, throttle, can:)          │
│ → thin Controllers → Form Requests → Application actions                    │
│ → Domain services (PricingCalculator, SaleValidator, InventoryLedger, …)    │
│ → Repositories / Eloquent → MySQL                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Principles applied

- **Offline-first**: every POS action goes `UI → use case → repository → SQLite`; network work happens only
  in the sync engine (`UI → … → SQLite → sync_queue → Laravel`). Checkout never waits for the API.
- **Dependency inversion**: use cases depend on interfaces in `domain/repositories` and `application/ports`.
  `app/src/app/container.ts` is the only place concrete classes are wired; `bootstrap.ts` picks the
  Android (SQLCipher, Keystore, Bluetooth/Wi-Fi printers) or web (sql.js, dev secure store, mock printer) set.
  Tests wire the same use cases over sql.js in Node with fake gateways.
- **Single responsibility / interface segregation**: separate `ProductReader`/`ProductWriter`,
  `SaleReader`/`SaleWriter`, `SyncQueue`, `InventoryRepository`, `ReceiptPrinter`, … instead of a
  `PosRepository`/`PosService`. On the server: one action per use case, one exception renderer, one
  permission matrix (`RolePermissions`).
- **Open/closed**: payment methods register in `PaymentMethodRegistry` (Cash, GCash, Card); sync op
  side-effects are a lookup table; printers implement one interface (Bluetooth, Wi-Fi, Mock).
- **Liskov**: any `ReceiptPrinter` / `SqlDatabase` / `SecureStore` implementation is swappable — the
  integration tests run the production use cases on a different `SqlDatabase` implementation.
- **Server is authoritative**: the client computes totals for UX; Laravel recomputes them using the same
  algorithm (shared vectors in `docs/pricing-vectors.json`) and re-checks every permission.

## Key flows

**Complete sale** (`CompleteSaleUseCase`): validate cart → permissions/approval → price with
`PricingCalculator` → validate payments → stock check → **one SQLite transaction** (sale, items, payments,
inventory movements + balances, receipt counter, `sync_queue` CREATE_SALE, audit) → commit → print
(failure only sets `print_status = FAILED`) → nudge sync engine (non-blocking).

**Sync** (`SyncEngine`, see [OFFLINE_SYNC.md](OFFLINE_SYNC.md)): single-flight; pushes due queue items in
batches to `POST /sync`, applies per-op results (APPLIED/DUPLICATE/FLAGGED/REJECTED), backoff
5s→15s→30s→60s→300s, max 8 attempts, then `FAILED` (kept, visible to managers). Pulls catalog,
balances, approvers and settings incrementally.

**Server sale** (`CompleteSaleAction` via `IdempotentOperationRunner`): idempotency lookup → schema →
actor/device checks → recompute totals → price window, discount, product, tax, stock checks → one DB
transaction writing sale, items, payments, ledger, balances, conflicts, idempotency row and audit.

## Repository layout

```
app/       React + TypeScript + Capacitor client (android/ contains the Kotlin printer plugin)
backend/   Laravel 13 API
docs/      contract, design and operations docs; notes/ holds detailed implementation notes
```

Detailed file trees: [notes/app-implementation.md](notes/app-implementation.md),
[notes/backend-implementation.md](notes/backend-implementation.md).
