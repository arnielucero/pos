import type { Receipt } from '../../application/dto/Receipt';
import type { Logger } from '../../application/ports/Logger';
import type {
  PrinterDevice,
  PrinterSettings,
  PrinterSettingsStore,
  PrinterStatus,
  ReceiptPrinter,
} from '../../application/ports/ReceiptPrinter';
import { DEFAULT_PRINTER_SETTINGS } from '../../application/ports/ReceiptPrinter';
import type { SettingsRepository } from '../../domain/repositories/SettingsRepository';
import { z } from 'zod';

export type PrinterFactory = (settings: PrinterSettings) => ReceiptPrinter;

/**
 * ReceiptPrinter that delegates to the implementation selected in Printer settings
 * (MOCK / BLUETOOTH / WIFI). Rebuilt whenever settings change.
 */
export class ConfigurablePrinter implements ReceiptPrinter {
  private current: { key: string; printer: ReceiptPrinter } | null = null;

  constructor(
    private readonly settings: PrinterSettingsStore,
    private readonly factories: Readonly<Record<PrinterSettings['type'], PrinterFactory>>,
    private readonly logger: Logger,
  ) {}

  private async resolve(): Promise<ReceiptPrinter> {
    const s = await this.settings.get();
    const key = JSON.stringify(s);
    if (this.current?.key !== key) {
      if (this.current) await this.current.printer.disconnect().catch(() => undefined);
      this.current = { key, printer: this.factories[s.type](s) };
      this.logger.info('Printer configured', { type: s.type, paperWidth: s.paperWidth });
    }
    return this.current.printer;
  }

  async discover(): Promise<readonly PrinterDevice[]> {
    return (await this.resolve()).discover();
  }
  async connect(): Promise<void> {
    await (await this.resolve()).connect();
  }
  async print(receipt: Receipt): Promise<void> {
    await (await this.resolve()).print(receipt);
  }
  async printTest(): Promise<void> {
    await (await this.resolve()).printTest();
  }
  async cut(): Promise<void> {
    await (await this.resolve()).cut();
  }
  async disconnect(): Promise<void> {
    await (await this.resolve()).disconnect();
  }
  async status(): Promise<PrinterStatus> {
    return (await this.resolve()).status();
  }
}

const settingsSchema = z.object({
  type: z.enum(['MOCK', 'BLUETOOTH', 'WIFI']),
  address: z.string().max(255),
  port: z.number().int().min(1).max(65535),
  name: z.string().max(255),
  paperWidth: z.union([z.literal(58), z.literal(80)]),
  openDrawer: z.boolean(),
});

const KEY = 'printer.settings';

/** Printer settings live in the SQLite settings table (not secret). */
export class SqlitePrinterSettingsStore implements PrinterSettingsStore {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly defaults: PrinterSettings = DEFAULT_PRINTER_SETTINGS,
  ) {}

  async get(): Promise<PrinterSettings> {
    const raw = await this.repo.get(KEY);
    if (!raw) return this.defaults;
    try {
      const v = settingsSchema.safeParse(JSON.parse(raw));
      return v.success ? v.data : this.defaults;
    } catch {
      return this.defaults;
    }
  }

  async save(settings: PrinterSettings): Promise<void> {
    const v = settingsSchema.parse(settings);
    await this.repo.set(KEY, JSON.stringify(v));
  }
}
