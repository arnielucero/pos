import type { Receipt } from '../../application/dto/Receipt';
import type { Logger } from '../../application/ports/Logger';
import type { PrinterDevice, PrinterSettings, PrinterStatus, ReceiptPrinter } from '../../application/ports/ReceiptPrinter';
import { PrinterConnectionError, type PrinterFailureReason } from '../../domain/errors/DomainError';
import { EscPosEncoder, isPaperOut } from './EscPosEncoder';
import type { EscPosPrinterPlugin } from './EscPosPrinterPlugin';
import { ReceiptFormatter } from './ReceiptFormatter';

const KNOWN: readonly PrinterFailureReason[] = ['BLUETOOTH_DISABLED', 'PERMISSION_DENIED', 'NOT_CONNECTED', 'TIMEOUT', 'IO_ERROR'];

/** Maps native plugin rejections (error.code) to typed PrinterConnectionError. */
export function mapNativePrinterError(e: unknown): PrinterConnectionError {
  if (e instanceof PrinterConnectionError) return e;
  const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
  const reason = KNOWN.find((k) => k === code) ?? 'IO_ERROR';
  const messages: Record<PrinterFailureReason, string> = {
    BLUETOOTH_DISABLED: 'Bluetooth is turned off. Turn it on and try again.',
    PERMISSION_DENIED: 'Bluetooth permission was denied. Allow "Nearby devices" for HMR POS.',
    NOT_CONNECTED: 'The printer is not connected.',
    TIMEOUT: 'The printer did not respond in time.',
    IO_ERROR: 'Could not send data to the printer.',
    PAPER_OUT: 'The printer is out of paper.',
    NOT_CONFIGURED: 'No printer configured.',
    UNSUPPORTED: 'Not supported on this device.',
  };
  return new PrinterConnectionError(reason, messages[reason]);
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Shared ESC/POS printer over the native Kotlin plugin; subclasses only differ in how they
 * connect (Bluetooth Classic SPP vs raw TCP 9100).
 */
abstract class NativeEscPosPrinter implements ReceiptPrinter {
  constructor(
    protected readonly plugin: EscPosPrinterPlugin,
    protected readonly settings: PrinterSettings,
    protected readonly logger: Logger,
  ) {}

  protected abstract doConnect(): Promise<void>;
  abstract discover(): Promise<readonly PrinterDevice[]>;

  async connect(): Promise<void> {
    try {
      if ((await this.plugin.isConnected()).connected) return;
      await this.doConnect();
    } catch (e) {
      throw mapNativePrinterError(e);
    }
  }

  private async send(bytes: Uint8Array): Promise<void> {
    await this.connect();
    try {
      await this.plugin.write({ data: toBase64(bytes) });
    } catch (e) {
      // One reconnect attempt: printers drop idle Bluetooth links.
      this.logger.warning('Printer write failed, reconnecting once', { error: String(e) });
      try {
        await this.plugin.disconnect();
        await this.doConnect();
        await this.plugin.write({ data: toBase64(bytes) });
      } catch (e2) {
        throw mapNativePrinterError(e2);
      }
    }
  }

  async print(receipt: Receipt): Promise<void> {
    const st = await this.status().catch(() => null);
    if (st?.paperOut === true) throw new PrinterConnectionError('PAPER_OUT', 'The printer is out of paper.');
    await this.send(new ReceiptFormatter(this.settings.paperWidth).toEscPos(receipt));
  }

  async printTest(): Promise<void> {
    const e = new EscPosEncoder()
      .init()
      .align('center')
      .bold(true)
      .line('HMR POS')
      .bold(false)
      .line('Printer test OK')
      .line(`${String(this.settings.paperWidth)}mm paper`)
      .line('1234567890'.repeat(5).slice(0, this.settings.paperWidth === 80 ? 48 : 32))
      .feed(3)
      .cut();
    await this.send(e.encode());
  }

  async cut(): Promise<void> {
    await this.send(new EscPosEncoder().cut().encode());
  }

  async disconnect(): Promise<void> {
    try {
      await this.plugin.disconnect();
    } catch (e) {
      throw mapNativePrinterError(e);
    }
  }

  async status(): Promise<PrinterStatus> {
    try {
      const { connected } = await this.plugin.isConnected();
      if (!connected) return { connected: false, paperOut: null, message: null };
      const { status } = await this.plugin.queryStatus({ n: 4, timeoutMs: 800 });
      // -1: the printer did not answer DLE EOT (many cheap BT printers are write-only).
      return { connected: true, paperOut: status < 0 ? null : isPaperOut(status), message: null };
    } catch (e) {
      return { connected: false, paperOut: null, message: mapNativePrinterError(e).message };
    }
  }
}

export class BluetoothEscPosPrinter extends NativeEscPosPrinter {
  async discover(): Promise<readonly PrinterDevice[]> {
    try {
      const { devices } = await this.plugin.listPairedDevices();
      return devices.map((d) => ({ id: d.address, name: d.name || d.address, type: 'BLUETOOTH' as const }));
    } catch (e) {
      throw mapNativePrinterError(e);
    }
  }

  protected doConnect(): Promise<void> {
    if (!this.settings.address) throw new PrinterConnectionError('NOT_CONFIGURED', 'Choose a Bluetooth printer first.');
    return this.plugin.connectBluetooth({ address: this.settings.address, timeoutMs: 8000 });
  }
}

export class WifiEscPosPrinter extends NativeEscPosPrinter {
  discover(): Promise<readonly PrinterDevice[]> {
    // Network printers are entered manually (host/IP + port 9100).
    return Promise.resolve([]);
  }

  protected doConnect(): Promise<void> {
    if (!this.settings.address) throw new PrinterConnectionError('NOT_CONFIGURED', 'Enter the printer IP address first.');
    return this.plugin.connectTcp({ host: this.settings.address, port: this.settings.port || 9100, timeoutMs: 5000 });
  }
}
