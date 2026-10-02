# Security Model

Guiding assumption: **the client is hostile.** Anything shipped in the APK can be extracted,
and an attacker may run a modified app or call the API directly. The Laravel server is the
authority for every synchronized financial record. Client-side checks exist for UX and for
offline continuity, never as the security boundary.

## Threat model

| # | Threat | Impact | Mitigations |
|---|---|---|---|
| 1 | **Lost / stolen tablet** | Access to cached sales, customers, tokens | SQLite encrypted with SQLCipher; passphrase generated on first run and held in Android Keystore-backed secure storage. Tokens only in secure storage. `allowBackup=false`. Offline sessions expire (`max_offline_hours`, default 72h) and lock after `max_failed_attempts`. A manager can **disable the device** server-side (`PATCH /devices/{uuid}`) → all its tokens stop working immediately (device middleware). Minimal PII stored (customers are optional, name/phone only). |
| 2 | **Reverse-engineering the APK** | Discover endpoints, logic, secrets | No secrets ship in the bundle: `VITE_*` contains only the API URL and env name. No API keys, no DB credentials, no signing keys in the repo. All authorization is enforced server-side, so knowing the logic grants nothing. Release builds disable WebView debugging. |
| 3 | **Token theft** | Session hijack | Short-lived access tokens (12h) **bound to the device id** (a stolen token used with another `X-Device-Id` is rejected). Refresh tokens are opaque, stored hashed (SHA-256), single-use with rotation; reuse of a rotated refresh token revokes the whole token family (detects theft). HTTPS only (HSTS in production, cleartext disabled in the Android network security config except debug builds). Logout revokes both tokens. |
| 4 | **Unauthorized cashier** | Sales/voids by wrong person | Per-user login; role → permission matrix enforced by Laravel policies on every request and on every synced op (`cashier_uuid` must be an active user of the same store with `sale.create`). Offline login only for users who logged in online on *this* device recently. |
| 5 | **Manager PIN theft / brute force** | Unauthorized voids/discounts | PINs never stored in plaintext: server stores bcrypt (cost ≥ 12). For offline approval the device receives the bcrypt hash (see trade-off below). Local attempt counter + lockout; every approval is audited with `mode: ONLINE | OFFLINE_PIN`; the server re-validates that the approver holds `approval.grant` **and** the specific permission. PIN changes take effect on the next pull. |
| 6 | **Offline transaction tampering** (edit SQLite / modified app) | Under-priced sales, fake discounts | Server **recomputes** every line, discount, tax and total from quantities and unit prices (shared pricing algorithm + shared test vectors). Arithmetic mismatch → `REJECTED INVALID_TOTALS` + `SECURITY` audit entry. Unit price must match a server price effective during the device's offline window, else `FLAGGED PRICE_MISMATCH`. Discount limits (`max_discount_bp`) and permissions re-checked → `FLAGGED`. Flagged sales are kept (money changed hands) but surfaced for manager review. |
| 7 | **Duplicate transactions** | Double-counted revenue/stock | Every sale has a client UUID used as the idempotency key. Enforced by DB unique constraints `idempotency_keys(store_id, key)`, `sales(store_id, uuid)`, `sales(store_id, receipt_number)` — concurrent duplicates hit the constraint and return `DUPLICATE`. |
| 8 | **Replay attacks** | Re-submitting captured requests | Same as #7: a replayed op returns the original result and creates nothing. A captured request with a modified body but same key → `IDEMPOTENCY_KEY_REUSED`. Tokens expire and are device-bound. TLS prevents capture in transit. |
| 9 | **Modified prices / quantities** in requests | Revenue loss | #6. Quantities must be positive integers (DB CHECK + validation); prices are compared to server price history. |
| 10 | **Fake API requests** (scripts, other devices) | Data injection | Authentication + active registered device required for every authenticated endpoint; device must belong to the user's store. Rate limits: login 5/min per email+ip, API 120/min/user, sync 60/min/device. Form Request validation, `$fillable` mass-assignment protection, Eloquent bindings (no raw string SQL). |
| 11 | **Printer manipulation** (rogue Bluetooth printer, sniffing) | Receipt spoofing, info leak | Receipts are not proof of payment for the backend; the server record is authoritative. Receipts contain no card data or tokens. Only paired printers are selectable; printer choice is a privileged setting. Print status is tracked separately from the sale, so print failures can't corrupt sales. |
| 12 | **Malicious local data modification** (rooted device) | Altered queue/history | Encrypted DB raises the bar; the server is authoritative for anything that syncs; local audit log is uploaded (`AUDIT_EVENTS`). A rooted device can still delete *unsynced* sales before upload — mitigated by frequent sync and register reconciliation (Z report expected vs actual cash, server-side `REGISTER_TOTALS_MISMATCH`). |
| 13 | **Information leakage via errors/logs** | Credential exposure | API returns a fixed JSON error envelope, never stack traces (`APP_DEBUG=false` in prod). Client logger redacts `password`, `token`, `pin`, `card`, `cvv`, `authorization` keys before writing. Sync diagnostics with technical detail are visible only with `sync.diagnostics`. |

## Key decisions and trade-offs

### Token storage
Access + refresh tokens live in the Android Keystore-backed secure storage plugin, never in
`localStorage`, SQLite or logs. The web/dev build (used for local development and Playwright E2E)
falls back to `sessionStorage`; this fallback **refuses to run** when `VITE_APP_ENV=production`.

### Offline login
On each successful online login the app stores, in secure storage, a PBKDF2-SHA256 verifier of
the password (≥ 210,000 iterations, random 16-byte salt), the user profile/permissions, and the
time of the last online authentication. Offline login is accepted only if:
- the user logged in online on this device before,
- `now − last_online_auth < max_offline_hours` (server-provided policy),
- the local failed-attempt counter is below `max_failed_attempts` (then the device locks until an online login).

The plaintext password is never stored. Trade-off: a verifier on the device is attackable offline
if both the device and the Keystore are compromised; PBKDF2 cost and the encrypted DB make this
expensive, and the server never trusts the offline session — synced ops are re-authorized server-side.

### Manager PIN offline
Alternatives considered:
1. **Online-only approvals** — safest, but voids/discounts would stop working offline (rejected: violates the offline requirement).
2. **Per-device one-time codes** — needs pre-provisioned code lists; operationally heavy.
3. **Sync bcrypt PIN hashes to the device** (chosen) — enables offline approval; risk is offline brute force of a 6-digit PIN (10⁶ space) if the encrypted DB *and* Keystore are extracted. Mitigations: bcrypt cost ≥ 12, encrypted storage, local lockout, all offline approvals audited and re-checked by the server, PINs rotated by changing them server-side, device disable on loss.

### Database encryption
`@capacitor-community/sqlite` in encrypted (SQLCipher) mode. The passphrase is random, created on
first launch, and stored in secure storage — never derived from user input, never in code.

### Financial integrity
Sales are append-only. Voids are separate records plus reversing inventory movements. Sync conflict
resolution never edits a completed sale's money columns.

## Operational checklist (production)
- `APP_ENV=production`, `APP_DEBUG=false`, HTTPS termination with HSTS, `SANCTUM_STATEFUL_DOMAINS` empty (token auth only).
- `CORS_ALLOWED_ORIGINS` limited to `https://localhost,capacitor://localhost` (the Capacitor WebView origins).
- Release APK signed with a key held outside the repo; `minifyEnabled` + WebView debugging off.
- Rotate seeded demo users/passwords — the seeder refuses to run in production.
- Queue workers supervised (systemd/supervisor); DB backups; monitor `SECURITY` audit entries and `FLAGGED` sales.
