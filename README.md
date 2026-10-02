# HMR POS — offline-first Android tablet POS

An Android tablet point-of-sale and inventory app that keeps selling without internet and syncs
safely with a Laravel backend when the connection comes back.

- **Client** (`app/`): React + TypeScript (strict) + Capacitor 8, SQLite (SQLCipher on device),
  Keystore-backed secure storage, Bluetooth/Wi-Fi ESC/POS printing through a Kotlin plugin.
- **Server** (`backend/`): Laravel 13 + Sanctum, MySQL 8 (SQLite for local dev/tests).

A completed sale is committed to the tablet's database before any network call. A durable sync queue
then pushes it with an idempotency key. The server recomputes every price and total, and it stores
suspicious sales as `FLAGGED` for review instead of dropping them.

## Quick start (local dev)

Requirements: PHP 8.3 + Composer, Node 22 (Capacitor CLI; Node 20 works for everything else),
JDK 21+ and the Android SDK for APK builds.

```bash
# backend → http://127.0.0.1:8080/api/v1
cd backend
composer install && cp .env.example .env && php artisan key:generate
touch database/database.sqlite && php artisan migrate --seed
php artisan serve --port=8080

# client (web dev build: sql.js + mock printer) → http://127.0.0.1:5173
cd app
npm install && npm run dev

# Android debug APK
cd app && scripts/android-build.sh
```

Demo users (dev seeder only; it refuses to run in production): `admin@`, `manager@` (PIN 123456),
`supervisor@` (PIN 654321), `cashier@`, `inventory@pos.test`, password `password`.
First sign-in on a new device must be a manager or admin, who registers the tablet.

## Checks

```bash
cd backend && php artisan test                       # 81 tests
cd app && npm run lint && npm run typecheck && npm test   # 102 tests
cd app && E2E_PORT=5180 npm run test:e2e             # needs the backend running, see docs/TESTING.md
```

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, SOLID mapping, key flows |
| [docs/API.md](docs/API.md) | Canonical v1 REST contract, pricing algorithm, sync ops |
| [docs/OFFLINE_SYNC.md](docs/OFFLINE_SYNC.md) | Sync queue, retries, idempotency, conflicts, recovery |
| [docs/DATABASE.md](docs/DATABASE.md) | Device SQLite + server MySQL schemas, uniqueness guarantees |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model and mitigations, token/PIN/offline-auth decisions |
| [docs/PRINTER.md](docs/PRINTER.md) | ESC/POS abstraction, Bluetooth/Wi-Fi plugin, failure handling |
| [docs/TESTING.md](docs/TESTING.md) | Test levels, how to run, results, gaps |

## Known limitations (v1)

Not built yet: refunds/returns, cash paid-in/out, a price-override UI, a customer UI, a conflict-resolution
UI, and server endpoints for user/PIN/store-settings management. Hardware printing has not been tested on a
physical printer. Weighted (non-integer) quantities are not supported. See the notes in `docs/notes/`.
