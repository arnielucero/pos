# Receipt printing (Android POS)

Receipts are printed as raw **ESC/POS** bytes to 58 mm or 80 mm thermal printers over
**Bluetooth Classic (SPP)** or **Wi‑Fi/LAN (raw TCP, port 9100)**. A **MockPrinter** renders
the same receipt as text for the web build, development and tests.

A printer failure **never fails a sale**: the sale is committed first, then printed; if printing
fails the sale's `print_status` becomes `FAILED`, a `PRINT_FAILED` audit event is recorded, and
the cashier can reprint later from *Transactions*.

## Layers

```
PrintReceiptUseCase / ReprintReceiptUseCase           (application — builds a Receipt from a Sale)
        │  Receipt (printer-agnostic DTO, integer centavos)
        ▼
ReceiptPrinter  (port: discover, connect, print, printTest, cut, disconnect, status)
        │
        ├── ConfigurablePrinter        picks the implementation from Printer settings
        │      ├── MockPrinter         web/dev/tests (text via ReceiptFormatter.toText)
        │      ├── BluetoothEscPosPrinter ─┐
        │      └── WifiEscPosPrinter ──────┤  share NativeEscPosPrinter (TS)
        │                                  ▼
        │                     EscPosPrinterPlugin (Capacitor bridge, registerPlugin('EscPosPrinter'))
        │                                  ▼
        │      android/app/src/main/java/ph/hmr/pos/printer/EscPosPrinterPlugin.kt  (Kotlin)
        │
        └── ReceiptFormatter (Receipt → lines → bytes) ── EscPosEncoder (pure byte builder)
```

| File | Role |
|---|---|
| `app/src/application/ports/ReceiptPrinter.ts` | `ReceiptPrinter`, `PrinterSettings`, `PrinterSettingsStore` interfaces |
| `app/src/infrastructure/printer/EscPosEncoder.ts` | Pure ESC/POS encoder + ASCII mapping + column helpers |
| `app/src/infrastructure/printer/ReceiptFormatter.ts` | Receipt layout for 32/48 columns, text + ESC/POS output |
| `app/src/infrastructure/printer/NativeEscPosPrinter.ts` | `BluetoothEscPosPrinter`, `WifiEscPosPrinter`, native error mapping |
| `app/src/infrastructure/printer/EscPosPrinterPlugin.ts` | TypeScript definition of the native plugin |
| `app/src/infrastructure/printer/MockPrinter.ts` | In-memory printer (web/E2E/tests) |
| `app/src/infrastructure/printer/ConfigurablePrinter.ts` | Settings-driven delegate + SQLite-backed settings store |
| `app/android/app/src/main/java/ph/hmr/pos/printer/EscPosPrinterPlugin.kt` | Native transport |
| `app/android/app/src/main/java/ph/hmr/pos/MainActivity.kt` | Registers the plugin before `super.onCreate` |

## EscPosEncoder (pure)

| Method | Bytes |
|---|---|
| `init()` | `ESC @` (1B 40) |
| `align(left/center/right)` | `ESC a n` (1B 61 00/01/02) |
| `bold(on)` | `ESC E n` (1B 45 01/00) |
| `doubleSize(on)` | `GS ! n` (1D 21 11/00) — double width + height |
| `text(s)` / `line(s)` | ASCII bytes (+ `LF` 0A) |
| `feed(n)` | `ESC d n` |
| `cut()` | `GS V 66 3` (1D 56 42 03) — feed + partial cut (widely supported) |
| `openCashDrawer()` | `ESC p 0 25 250` (1B 70 00 19 FA) — kick pin 2 |
| `PAPER_STATUS_REQUEST` | `DLE EOT 4` (10 04 04) |

**Code-page safety.** Printers ship with different default code pages (PC437, PC850, GB18030…).
Rather than switching code pages per model, every string is mapped to printable 7‑bit ASCII:
`₱` → `P`, en/em dashes → `-`, smart quotes → `'`/`"`, `…` → `...`, `ñ` → `n`, accented
letters are stripped via NFKD, anything else becomes `?`. Prices therefore print as
`P1,234.50`. (Unit-tested in `tests/unit/escpos.test.ts`.)

**Widths.** 58 mm paper = **32 columns**, 80 mm = **48 columns** (Font A). `ReceiptFormatter`
word-wraps names, right-aligns amounts with `twoColumn`, halves the width for double-size
header lines, and is tested to never emit a line wider than the paper.

Receipt content: store header (from synced `receipt_header`), `*** REPRINT ***` /
`*** VOIDED ***` markers, receipt number, date, cashier, terminal code, each line (name,
`qty x unit`, line gross, line discount), subtotal, discounts, TOTAL, VAT-inclusive tax line,
tenders with references, change, footer. The drawer kick is appended only for cash sales when
*Open cash drawer* is enabled, and never on reprints.

## Native plugin (Kotlin)

`EscPosPrinterPlugin` (`@CapacitorPlugin(name = "EscPosPrinter")`):

| Method | Behaviour |
|---|---|
| `listPairedDevices()` | Bonded Bluetooth devices `{ devices: [{ name, address }] }` |
| `connectBluetooth({ address, timeoutMs=8000 })` | RFCOMM to SPP UUID `00001101-0000-1000-8000-00805F9B34FB`; cancels discovery first; falls back to an *insecure* RFCOMM socket (many cheap printers require it) |
| `connectTcp({ host, port=9100, timeoutMs=5000 })` | Raw TCP socket, `TCP_NODELAY`, 5 s read timeout |
| `write({ data })` | Base64 → bytes, written in 1 KiB chunks with flush (small printer buffers) |
| `queryStatus({ n=4, timeoutMs=800 })` | Sends `DLE EOT n`, returns `{ status }` or `-1` if the printer stays silent |
| `disconnect()` / `isConnected()` | Closes / reports the current link |

**Threading & timeouts.** All IO runs on a dedicated single-thread executor (`escpos-io`), never
the main thread. Every call is guarded by a watchdog (`escpos-watchdog`) that, on timeout,
closes the pending/active socket (which unblocks `connect()`/`write()`), and rejects with
`TIMEOUT`. Each call settles exactly once (atomic flag).

**Permissions.** Android 12+ (API 31+) requires runtime `BLUETOOTH_CONNECT` (+ `BLUETOOTH_SCAN`,
declared `neverForLocation`); the plugin requests them through Capacitor's permission alias
`bluetooth` and resumes the original call in `@PermissionCallback`. On Android ≤ 11 the legacy
`BLUETOOTH`/`BLUETOOTH_ADMIN` install-time permissions are used (`maxSdkVersion="30"`).

**Error codes** (rejection `code`), mapped in TS by `mapNativePrinterError` to
`PrinterConnectionError(reason)`:

| Code | When | Message shown |
|---|---|---|
| `BLUETOOTH_DISABLED` | adapter off | "Bluetooth is turned off. Turn it on and try again." |
| `PERMISSION_DENIED` | runtime permission refused / `SecurityException` | "Allow Nearby devices for HMR POS." |
| `NOT_CONNECTED` | write/status without a link | "The printer is not connected." |
| `TIMEOUT` | watchdog fired / socket timeout | "The printer did not respond in time." |
| `IO_ERROR` | any other IO failure (link dropped, refused, bad address) | "Could not send data to the printer." |
| `UNSUPPORTED` | device without Bluetooth | — |

`NativeEscPosPrinter.send()` auto-connects, and on a failed write reconnects **once** and retries
(Bluetooth printers drop idle links). Data is idempotent at the receipt level only in the sense
that a retry may print a duplicate copy — acceptable for receipts, never for money.

## Paper-out detection and its limits

Before printing, `status()` sends `DLE EOT 4` (paper roll sensor) and treats bits 5–6
(`0x60`) as *paper end*. If the printer reports paper-out, printing is refused with
`PAPER_OUT` → `print_status = FAILED` (cashier can reload paper and reprint).

Limits (documented, by design):
- Many low-cost Bluetooth printers are **write-only** over SPP and never answer `DLE EOT`;
  the plugin then returns `-1` and the app treats paper state as *unknown* (prints anyway).
- Some printers answer `DLE EOT` only when idle; a reply may be lost mid-job.
- Status reflects the sensor at query time; paper running out *during* a long receipt is not
  detected. A successful `write()` means bytes reached the printer, not that ink hit paper.
- Raw TCP 9100 is one-way on some network printers (same `-1` behaviour).

## Printer settings page

*Printer* tab: choose **Bluetooth**, **Wi‑Fi / LAN** or **Screen (no printer)**; for Bluetooth
tap *Find paired printers* (pair in Android settings first) and pick one; for Wi‑Fi enter IP/host
and port (default 9100); choose **58 mm / 80 mm**; toggle *Open cash drawer on cash sales*;
*Save* / *Save & test print*. Saving requires `settings.edit` or a manager PIN approval and is
audited (`PRINTER_SETTINGS_CHANGED`). Settings are stored in the SQLite `settings` table
(`printer.settings`), not in secure storage (nothing secret).

## Testing

- `tests/unit/escpos.test.ts`: exact command bytes, ASCII mapping, paper-out bits, column
  helpers, formatter width for 58/80 mm, cut + drawer-kick tail.
- `tests/integration/completeSale.test.ts`: printer failure → sale persisted, `print_status=FAILED`,
  `PRINT_FAILED` audit, reprint succeeds and creates no new sale.
- E2E (web) uses `MockPrinter`; the sale-complete dialog shows the rendered receipt text
  (`data-testid="receipt-preview"`).
- Manual hardware checklist: pair a 58 mm BT printer → Find → select → Save & test print;
  turn Bluetooth off → expect "Bluetooth is turned off"; deny Nearby devices → "permission";
  power the printer off mid-shift → sale completes, receipt shows *not printed*, reprint after
  power-on works; remove paper on a printer that supports `DLE EOT 4` → "out of paper".
