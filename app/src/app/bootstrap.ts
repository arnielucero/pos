import { Capacitor } from '@capacitor/core';
import { systemClock } from '../application/ports/Clock';
import { ConsoleSink, MemorySink, StructuredLogger } from '../infrastructure/logging/StructuredLogger';
import { CapacitorConnectivity } from '../infrastructure/network/CapacitorConnectivity';
import { MockPrinter } from '../infrastructure/printer/MockPrinter';
import { loadConfig } from './config';
import { buildContainer, type Container } from './container';

/** Chooses native (Android) or web (dev/E2E) infrastructure and builds the container. */
export async function bootstrap(): Promise<Container> {
  const config = loadConfig(import.meta.env);
  const memoryLog = new MemorySink();
  const logger = new StructuredLogger(
    [new ConsoleSink(), memoryLog],
    config.appEnv === 'production' ? 'INFO' : 'DEBUG',
  );
  const connectivity = new CapacitorConnectivity();
  const fetchFn = (input: string, init: RequestInit): Promise<Response> => fetch(input, init);
  const mock = (): MockPrinter => new MockPrinter(logger.child('mock-printer'));

  if (Capacitor.isNativePlatform()) {
    if (config.apiBaseUrl.startsWith('/')) {
      // Relative URLs only work behind the Vite dev proxy; the WebView origin is https://localhost.
      throw new Error('Native builds need an absolute VITE_API_BASE_URL');
    }
    const [{ CapacitorSqliteDatabase }, { NativeSecureStore }, printerMod, { EscPosPrinterNative }, { Device }] =
      await Promise.all([
        import('../infrastructure/database/CapacitorSqliteDatabase'),
        import('../infrastructure/authentication/SecureStores'),
        import('../infrastructure/printer/NativeEscPosPrinter'),
        import('../infrastructure/printer/EscPosPrinterPlugin'),
        import('@capacitor/device'),
      ]);
    const secureStore = new NativeSecureStore();
    const db = await CapacitorSqliteDatabase.open('hmrpos', secureStore);
    const printerLogger = logger.child('printer');
    return buildContainer({
      platform: 'android',
      config,
      db,
      secureStore,
      fetchFn,
      connectivity,
      logger,
      memoryLog,
      clock: systemClock,
      printerFactories: {
        MOCK: mock,
        BLUETOOTH: (s) => new printerMod.BluetoothEscPosPrinter(EscPosPrinterNative, s, printerLogger),
        WIFI: (s) => new printerMod.WifiEscPosPrinter(EscPosPrinterNative, s, printerLogger),
      },
      defaultPrinter: { type: 'BLUETOOTH', address: '', port: 9100, name: '', paperWidth: 58, openDrawer: false },
      describeDevice: async () => {
        const info = await Device.getInfo();
        return { model: `${info.manufacturer} ${info.model}`, platform: info.platform };
      },
    });
  }

  const [{ DevSessionSecureStore }, { openWebDatabase }] = await Promise.all([
    import('../infrastructure/authentication/SecureStores'),
    import('../infrastructure/database/openWebDatabase'),
  ]);
  // DEV-ONLY: throws when VITE_APP_ENV=production (a production web build is not supported).
  const secureStore = new DevSessionSecureStore(config.appEnv);
  const db = await openWebDatabase();
  const notSupported = (): MockPrinter => mock();
  return buildContainer({
    platform: 'web',
    config,
    db,
    secureStore,
    fetchFn,
    connectivity,
    logger,
    memoryLog,
    clock: systemClock,
    printerFactories: { MOCK: mock, BLUETOOTH: notSupported, WIFI: notSupported },
  });
}
