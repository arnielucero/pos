import type { Receipt } from '../application/dto/Receipt';
import type { Clock } from '../application/ports/Clock';
import type { Logger } from '../application/ports/Logger';
import type { PrinterSettings, PrinterSettingsStore, ReceiptPrinter } from '../application/ports/ReceiptPrinter';
import type { SecureStore } from '../application/ports/SecureStore';
import { SessionManager } from '../application/session/SessionManager';
import { AdjustInventoryUseCase } from '../application/usecases/AdjustInventoryUseCase';
import { CloseRegisterUseCase } from '../application/usecases/CloseRegisterUseCase';
import { CompleteSaleUseCase } from '../application/usecases/CompleteSaleUseCase';
import { LoginUseCase } from '../application/usecases/LoginUseCase';
import { LogoutUseCase } from '../application/usecases/LogoutUseCase';
import { OfflineLoginUseCase } from '../application/usecases/OfflineLoginUseCase';
import { OpenRegisterUseCase } from '../application/usecases/OpenRegisterUseCase';
import { PrinterSettingsUseCase } from '../application/usecases/PrinterSettingsUseCase';
import { PrintReceiptUseCase } from '../application/usecases/PrintReceiptUseCase';
import { PullCatalogUseCase } from '../application/usecases/PullCatalogUseCase';
import { PushSyncQueueUseCase } from '../application/usecases/PushSyncQueueUseCase';
import { InventoryQueryUseCase, SyncStatusUseCase, TransactionHistoryUseCase } from '../application/usecases/QueryUseCases';
import { RegisterDeviceUseCase } from '../application/usecases/RegisterDeviceUseCase';
import { ReprintReceiptUseCase } from '../application/usecases/ReprintReceiptUseCase';
import { RequestApprovalUseCase } from '../application/usecases/RequestApprovalUseCase';
import { SearchProductsUseCase } from '../application/usecases/SearchProductsUseCase';
import { SignInUseCase } from '../application/usecases/SignInUseCase';
import { VoidSaleUseCase } from '../application/usecases/VoidSaleUseCase';
import { PaymentMethodRegistry } from '../domain/services/payments/PaymentMethodRegistry';
import { PricingCalculator } from '../domain/services/PricingCalculator';
import type { SettingsRepository } from '../domain/repositories/SettingsRepository';
import { HttpApiGateway } from '../infrastructure/api/HttpApiGateway';
import { HttpClient, type FetchFn } from '../infrastructure/api/HttpClient';
import { BcryptPinVerifier } from '../infrastructure/authentication/BcryptPinVerifier';
import { Pbkdf2PasswordHasher } from '../infrastructure/authentication/Pbkdf2PasswordHasher';
import { SecureOfflineCredentialStore, SecureTokenStore } from '../infrastructure/authentication/SecureTokenStore';
import { Migrator } from '../infrastructure/database/Migrator';
import type { SqlDatabase } from '../infrastructure/database/SqlDatabase';
import { SecureDeviceIdentity } from '../infrastructure/device/SecureDeviceIdentity';
import type { MemorySink } from '../infrastructure/logging/StructuredLogger';
import { NetworkDetector, type ConnectivitySource } from '../infrastructure/network/NetworkDetector';
import { ConfigurablePrinter, SqlitePrinterSettingsStore, type PrinterFactory } from '../infrastructure/printer/ConfigurablePrinter';
import { ReceiptFormatter } from '../infrastructure/printer/ReceiptFormatter';
import { createSqliteRepositories, SqliteUnitOfWork } from '../infrastructure/repositories/SqliteUnitOfWork';
import { SyncEngine } from '../infrastructure/synchronization/SyncEngine';
import type { AppConfig } from './config';

/** Platform-specific infrastructure handed to the composition root. */
export interface PlatformServices {
  readonly platform: 'android' | 'web' | 'test';
  readonly config: AppConfig;
  readonly db: SqlDatabase;
  readonly secureStore: SecureStore;
  readonly fetchFn: FetchFn;
  readonly connectivity: ConnectivitySource;
  readonly printerFactories: Readonly<Record<PrinterSettings['type'], PrinterFactory>>;
  readonly defaultPrinter?: PrinterSettings;
  readonly logger: Logger;
  readonly memoryLog: MemorySink | null;
  readonly clock: Clock;
  readonly describeDevice?: () => Promise<{ model: string; platform: string }>;
  readonly pbkdf2Iterations?: number;
}

export interface Container {
  readonly platform: PlatformServices['platform'];
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly memoryLog: MemorySink | null;
  readonly session: SessionManager;
  readonly network: NetworkDetector;
  readonly sync: SyncEngine;
  readonly printer: ReceiptPrinter;
  readonly printerSettings: PrinterSettingsStore;
  readonly paymentMethods: PaymentMethodRegistry;
  readonly pricing: PricingCalculator;
  readonly settings: SettingsRepository;
  readonly db: SqlDatabase;
  readonly useCases: {
    readonly signIn: SignInUseCase;
    readonly logout: LogoutUseCase;
    readonly registerDevice: RegisterDeviceUseCase;
    readonly openRegister: OpenRegisterUseCase;
    readonly closeRegister: CloseRegisterUseCase;
    readonly searchProducts: SearchProductsUseCase;
    readonly completeSale: CompleteSaleUseCase;
    readonly voidSale: VoidSaleUseCase;
    readonly adjustInventory: AdjustInventoryUseCase;
    readonly printReceipt: PrintReceiptUseCase;
    readonly reprintReceipt: ReprintReceiptUseCase;
    readonly requestApproval: RequestApprovalUseCase;
    readonly pullCatalog: PullCatalogUseCase;
    readonly pushSyncQueue: PushSyncQueueUseCase;
    readonly transactions: TransactionHistoryUseCase;
    readonly inventory: InventoryQueryUseCase;
    readonly syncStatus: SyncStatusUseCase;
    readonly printerSettings: PrinterSettingsUseCase;
  };
  /** Plain-text receipt rendering for on-screen preview. */
  receiptText(receipt: Receipt): Promise<string>;
  /** Restores device + open register after sign-in and kicks off a sync. */
  afterSignIn(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Composition root: wires interfaces to implementations. Platform differences live only in
 * PlatformServices (see bootstrap.web.ts / bootstrap.native.ts / tests).
 */
export async function buildContainer(p: PlatformServices): Promise<Container> {
  const logger = p.logger;
  await new Migrator(p.db, logger.child('db')).migrate();

  const repos = createSqliteRepositories(p.db);
  const uow = new SqliteUnitOfWork(p.db);
  const session = new SessionManager();
  const tokens = new SecureTokenStore(p.secureStore);
  const deviceIdentity = new SecureDeviceIdentity(p.secureStore, p.describeDevice);
  const http = new HttpClient({
    baseUrl: p.config.apiBaseUrl,
    fetchFn: p.fetchFn,
    tokens,
    deviceUuid: () => deviceIdentity.getDeviceUuid(),
    logger: logger.child('http'),
    now: () => p.clock.now(),
    onAuthLost: () => {
      session.update({ reauthRequired: true });
    },
  });
  const api = new HttpApiGateway(http);
  const network = new NetworkDetector(p.connectivity, api, logger.child('network'));
  const pricing = new PricingCalculator();
  const paymentMethods = PaymentMethodRegistry.withDefaults();
  const printerSettings = new SqlitePrinterSettingsStore(repos.settings, p.defaultPrinter);
  const printer = new ConfigurablePrinter(printerSettings, p.printerFactories, logger.child('printer'));
  const hasher = new Pbkdf2PasswordHasher(p.pbkdf2Iterations);
  const offlineCredentials = new SecureOfflineCredentialStore(p.secureStore);
  const clock = p.clock;

  const pushSyncQueue = new PushSyncQueueUseCase({ gateway: api, uow, session, clock, logger: logger.child('push') });
  const pullCatalog = new PullCatalogUseCase({ gateway: api, uow, settings: repos.settings, clock, logger: logger.child('pull') });
  const sync = new SyncEngine({
    push: pushSyncQueue,
    pull: pullCatalog,
    queue: repos.syncQueue,
    network,
    session,
    logger: logger.child('sync'),
    now: () => clock.now(),
  });

  const printReceipt = new PrintReceiptUseCase({
    saleReader: repos.saleReader,
    saleWriter: repos.saleWriter,
    settings: repos.settings,
    printer,
    printerSettings,
    payments: paymentMethods,
    uow,
    session,
    clock,
    logger: logger.child('print'),
  });
  const login = new LoginUseCase({ auth: api, tokens, offlineCredentials, hasher, deviceIdentity, uow, session, clock, logger });
  const offlineLogin = new OfflineLoginUseCase({ offlineCredentials, hasher, deviceIdentity, uow, session, clock, logger });
  const openRegister = new OpenRegisterUseCase({ uow, session, clock, logger, sync });

  const useCases = {
    signIn: new SignInUseCase(login, offlineLogin, network),
    logout: new LogoutUseCase({ auth: api, tokens, network, uow, session, clock, logger }),
    registerDevice: new RegisterDeviceUseCase({ devices: api, deviceIdentity, uow, session, clock, logger }),
    openRegister,
    closeRegister: new CloseRegisterUseCase({ uow, session, clock, logger, sync }),
    searchProducts: new SearchProductsUseCase(repos.productReader),
    completeSale: new CompleteSaleUseCase({
      uow,
      settings: repos.settings,
      pricing,
      payments: paymentMethods,
      print: printReceipt,
      session,
      sync,
      clock,
      logger: logger.child('sale'),
    }),
    voidSale: new VoidSaleUseCase({ uow, session, clock, logger, sync }),
    adjustInventory: new AdjustInventoryUseCase({ uow, session, clock, logger, sync }),
    printReceipt,
    reprintReceipt: new ReprintReceiptUseCase({ print: printReceipt, uow, session, clock }),
    requestApproval: new RequestApprovalUseCase({
      approvers: repos.approvers,
      pinVerifier: new BcryptPinVerifier(),
      uow,
      session,
      network,
      clock,
      logger: logger.child('approval'),
    }),
    pullCatalog,
    pushSyncQueue,
    transactions: new TransactionHistoryUseCase(repos.saleReader),
    inventory: new InventoryQueryUseCase(repos.inventory),
    syncStatus: new SyncStatusUseCase({ queue: repos.syncQueue, conflicts: repos.conflicts, audit: repos.audit, session }),
    printerSettings: new PrinterSettingsUseCase({ store: printerSettings, printer, uow, session, clock }),
  };

  return {
    platform: p.platform,
    config: p.config,
    logger,
    memoryLog: p.memoryLog,
    session,
    network,
    sync,
    printer,
    printerSettings,
    paymentMethods,
    pricing,
    settings: repos.settings,
    db: p.db,
    useCases,
    async receiptText(receipt) {
      const s = await printerSettings.get();
      return new ReceiptFormatter(s.paperWidth).toText(receipt);
    },
    async afterSignIn() {
      if (!session.getState().device) return;
      await openRegister.restore();
      const empty = (await repos.productReader.countActive()) === 0;
      const run = sync.syncNow('login');
      if (empty && network.current() !== 'OFFLINE') {
        // First sign-in: wait (bounded) for the catalog so the POS is usable immediately.
        await Promise.race([run, new Promise((r) => setTimeout(r, 15_000))]);
      }
    },
    async start() {
      const device = await deviceIdentity.getRegisteredDevice();
      session.update({ device });
      await network.start();
      await sync.start();
    },
    async stop() {
      await sync.stop();
      network.stop();
    },
  };
}
