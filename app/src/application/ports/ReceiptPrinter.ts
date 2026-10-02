import type { Receipt } from '../dto/Receipt';

export type PrinterType = 'MOCK' | 'BLUETOOTH' | 'WIFI';
export type PaperWidth = 58 | 80;

export interface PrinterDevice {
  readonly id: string;
  readonly name: string;
  readonly type: PrinterType;
}

export interface PrinterStatus {
  readonly connected: boolean;
  /** null = unknown / not supported by the printer. */
  readonly paperOut: boolean | null;
  readonly message: string | null;
}

export interface ReceiptPrinter {
  discover(): Promise<readonly PrinterDevice[]>;
  connect(): Promise<void>;
  print(receipt: Receipt): Promise<void>;
  /** Raw test page. */
  printTest(): Promise<void>;
  cut(): Promise<void>;
  disconnect(): Promise<void>;
  status(): Promise<PrinterStatus>;
}

export interface PrinterSettings {
  readonly type: PrinterType;
  /** Bluetooth MAC address or TCP host. */
  readonly address: string;
  readonly port: number;
  readonly name: string;
  readonly paperWidth: PaperWidth;
  readonly openDrawer: boolean;
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  type: 'MOCK',
  address: '',
  port: 9100,
  name: '',
  paperWidth: 58,
  openDrawer: false,
};

export interface PrinterSettingsStore {
  get(): Promise<PrinterSettings>;
  save(settings: PrinterSettings): Promise<void>;
}
