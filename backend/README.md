# HMR POS — Laravel backend

API for the offline-first Android POS (`../app`). The contract is `../docs/API.md`; implementation notes,
schema and design decisions are in `../docs/notes/backend-implementation.md`.

Requirements: PHP 8.3, Composer 2, SQLite (dev/tests) or MySQL 8 (production).

## Setup (local dev, SQLite)

```bash
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate --seed
php artisan serve --port=8080        # API at http://localhost:8080/api/v1  (never use 8000)
```

Health check: `curl http://localhost:8080/api/v1/health`

### Demo data (DEV ONLY — the seeder refuses to run when APP_ENV=production)

Store `STORE-001` "HMR Demo Store", 30 products with stock, and one user per role.
**All passwords are `password`** — development only, never deploy these accounts.

| Email | Role | PIN |
|---|---|---|
| admin@pos.test | ADMIN | — |
| manager@pos.test | MANAGER | 123456 |
| supervisor@pos.test | SUPERVISOR | 654321 |
| cashier@pos.test | CASHIER | — |
| inventory@pos.test | INVENTORY | — |

A device `POS-01` with uuid `00000000-0000-4000-8000-000000000001` is pre-registered, so you can log in
with `X-Device-Id: 00000000-0000-4000-8000-000000000001` as any user. Any other device uuid must first be
registered by an admin/manager (`POST /api/v1/devices/register`).

```bash
curl -s localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -H 'X-Device-Id: 00000000-0000-4000-8000-000000000001' \
  -d '{"email":"cashier@pos.test","password":"password"}'
```

Performance data: `php artisan pos:seed-bulk-products 50000` (adds N products with price + stock).

## Tests

```bash
php artisan test          # PHPUnit, SQLite in-memory (includes ../docs/pricing-vectors.json)
vendor/bin/pint           # formatting
```

The suite is database-agnostic; to run it against a **throwaway** MySQL 8 database:
`DB_CONNECTION=mysql DB_HOST=… DB_PORT=… DB_DATABASE=pos_test DB_USERNAME=… DB_PASSWORD=… php artisan test`
(RefreshDatabase wipes that database — never point it at shared data).

## Production checklist

- `APP_ENV=production`, `APP_DEBUG=false`, MySQL 8 settings in `.env`, `php artisan migrate --force`.
- HTTPS only: the app forces `https` URLs and sends HSTS in production; terminate TLS at the proxy.
- `CORS_ALLOWED_ORIGINS` limited to the app origins (`capacitor://localhost`, `https://localhost`).
- Run the scheduler (`php artisan schedule:run` every minute) — it prunes expired access tokens.
- Use a shared cache (e.g. Redis) for rate limiting when running more than one app server.
- Create real users/PINs; the demo seeder must never be run.
