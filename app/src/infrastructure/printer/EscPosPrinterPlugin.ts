import { registerPlugin } from '@capacitor/core';

/** Bridge to android/app/src/main/java/ph/hmr/pos/printer/EscPosPrinterPlugin.kt */
export interface EscPosPrinterPlugin {
  listPairedDevices(): Promise<{ devices: { name: string; address: string }[] }>;
  connectBluetooth(options: { address: string; timeoutMs?: number }): Promise<void>;
  connectTcp(options: { host: string; port?: number; timeoutMs?: number }): Promise<void>;
  write(options: { data: string }): Promise<void>;
  /** Sends DLE EOT n and returns the status byte (or -1 when the printer does not answer). */
  queryStatus(options: { n: number; timeoutMs?: number }): Promise<{ status: number }>;
  disconnect(): Promise<void>;
  isConnected(): Promise<{ connected: boolean }>;
}

export const EscPosPrinterNative = registerPlugin<EscPosPrinterPlugin>('EscPosPrinter');
