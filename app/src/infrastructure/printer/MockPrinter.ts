import type { Receipt } from '../../application/dto/Receipt';
import type { Logger } from '../../application/ports/Logger';
import type { PrinterDevice, PrinterStatus, ReceiptPrinter } from '../../application/ports/ReceiptPrinter';
import { PrinterConnectionError } from '../../domain/errors/DomainError';
import { ReceiptFormatter } from './ReceiptFormatter';

/** In-memory printer for web/dev/tests. Keeps the last printed receipts as text. */
export class MockPrinter implements ReceiptPrinter {
  readonly printed: string[] = [];
  failNext: PrinterConnectionError | null = null;
  private connected = false;

  constructor(
    private readonly logger: Logger | null = null,
    private readonly paperWidth: 58 | 80 = 58,
  ) {}

  discover(): Promise<readonly PrinterDevice[]> {
    return Promise.resolve([{ id: 'mock', name: 'Mock printer (screen)', type: 'MOCK' }]);
  }

  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  print(receipt: Receipt): Promise<void> {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      return Promise.reject(e);
    }
    this.connected = true;
    const text = new ReceiptFormatter(this.paperWidth).toText(receipt);
    this.printed.push(text);
    if (this.printed.length > 20) this.printed.shift();
    this.logger?.debug('MockPrinter printed receipt', { receiptNumber: receipt.receiptNumber });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mock-printer:printed', { detail: text }));
    }
    return Promise.resolve();
  }

  printTest(): Promise<void> {
    this.printed.push('TEST PRINT OK');
    return Promise.resolve();
  }

  cut(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.connected = false;
    return Promise.resolve();
  }

  status(): Promise<PrinterStatus> {
    return Promise.resolve({ connected: this.connected, paperOut: false, message: 'Mock printer' });
  }

  static notConfigured(): PrinterConnectionError {
    return new PrinterConnectionError('NOT_CONFIGURED', 'No printer configured.');
  }
}
