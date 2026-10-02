import initSqlJs, { type SqlJsStatic } from 'sql.js';
import type { Clock } from '../../src/application/ports/Clock';
import type { Logger } from '../../src/application/ports/Logger';
import type { SyncTrigger } from '../../src/application/ports/Network';
import type { NetworkState, NetworkStatusProvider } from '../../src/application/ports/Network';
import type { PrinterSettingsStore } from '../../src/application/ports/ReceiptPrinter';
import { DEFAULT_PRINTER_SETTINGS } from '../../src/application/ports/ReceiptPrinter';
import { SessionManager } from '../../src/application/session/SessionManager';
import { CompleteSaleUseCase } from '../../src/application/usecases/CompleteSaleUseCase';
import { OpenRegisterUseCase } from '../../src/application/usecases/OpenRegisterUseCase';
import { PrintReceiptUseCase } from '../../src/application/usecases/PrintReceiptUseCase';
import { VoidSaleUseCase } from '../../src/application/usecases/VoidSaleUseCase';
import type { Product } from '../../src/domain/entities/Product';
import type { DeviceInfo, UserProfile } from '../../src/domain/entities/User';
import type { TransactionalRepositories } from '../../src/domain/repositories/UnitOfWork';
import { PaymentMethodRegistry } from '../../src/domain/services/payments/PaymentMethodRegistry';
import { PricingCalculator } from '../../src/domain/services/PricingCalculator';
import { Migrator } from '../../src/infrastructure/database/Migrator';
import { SqlJsDatabase } from '../../src/infrastructure/database/SqlJsDatabase';
import { StructuredLogger } from '../../src/infrastructure/logging/StructuredLogger';
import { MockPrinter } from '../../src/infrastructure/printer/MockPrinter';
import {
  createSqliteRepositories,
  SqliteUnitOfWork,
  type RepositoryFactory,
} from '../../src/infrastructure/repositories/SqliteUnitOfWork';

let SQL: SqlJsStatic | null = null;

export async function sqlJs(): Promise<SqlJsStatic> {
  SQL ??= await initSqlJs();
  return SQL;
}

export async function openTestDb(bytes?: Uint8Array): Promise<SqlJsDatabase> {
  const db = await SqlJsDatabase.open(await sqlJs(), null, bytes);
  await new Migrator(db).migrate();
  return db;
}

export const silentLogger: Logger = new StructuredLogger([], 'ERROR');

export class FakeClock implements Clock {
  constructor(public current = new Date('2026-10-02T01:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class FakeNetwork implements NetworkStatusProvider {
  constructor(public state: NetworkState = 'ONLINE') {}
  current(): NetworkState {
    return this.state;
  }
  subscribe(): () => void {
    return () => undefined;
  }
  refresh(): Promise<NetworkState> {
    return Promise.resolve(this.state);
  }
}

export class RecordingTrigger implements SyncTrigger {
  readonly reasons: string[] = [];
  nudge(reason: string): void {
    this.reasons.push(reason);
  }
}

export const STORE = { uuid: '0b8f2a8e-3c4d-4e5f-8a9b-0c1d2e3f4a5b', code: 'STORE-001', name: 'Store 1' };

export const CASHIER: UserProfile = {
  uuid: '11111111-1111-4111-8111-111111111111',
  name: 'Carla Cashier',
  email: 'cashier@pos.test',
  role: 'CASHIER',
  permissions: ['sale.create', 'sale.reprint', 'inventory.view', 'register.open'],
  store: STORE,
};

export const MANAGER: UserProfile = {
  uuid: '22222222-2222-4222-8222-222222222222',
  name: 'Maria Manager',
  email: 'manager@pos.test',
  role: 'MANAGER',
  permissions: [
    'sale.create',
    'sale.void',
    'sale.refund',
    'sale.reprint',
    'discount.apply',
    'price.override',
    'inventory.view',
    'inventory.adjust',
    'product.edit',
    'report.view',
    'register.open',
    'register.close',
    'settings.edit',
    'device.register',
    'approval.grant',
    'sync.diagnostics',
  ],
  store: STORE,
};

export const DEVICE: DeviceInfo = { uuid: '33333333-3333-4333-8333-333333333333', code: 'POS-01', status: 'ACTIVE' };

export const CHICKEN: Product = {
  uuid: 'aaaaaaaa-0000-4000-8000-000000000001',
  sku: 'CR-001',
  barcode: '4800000000011',
  name: 'Chicken Rice',
  category: 'Meals',
  price: 12000,
  isActive: true,
  trackStock: true,
  updatedAt: '2026-10-01T00:00:00Z',
  deleted: false,
};

export const COFFEE: Product = {
  uuid: 'aaaaaaaa-0000-4000-8000-000000000002',
  sku: 'CF-001',
  barcode: '4800000000028',
  name: 'Coffee',
  category: 'Drinks',
  price: 9000,
  isActive: true,
  trackStock: false,
  updatedAt: '2026-10-01T00:00:00Z',
  deleted: false,
};

export class StaticPrinterSettings implements PrinterSettingsStore {
  get() {
    return Promise.resolve(DEFAULT_PRINTER_SETTINGS);
  }
  save(): Promise<void> {
    return Promise.resolve();
  }
}

/** Fully wired sale stack over a fresh sql.js DB, signed in with an open register. */
export async function saleHarness(options: { user?: UserProfile; factory?: RepositoryFactory; stock?: number } = {}) {
  const db = await openTestDb();
  const repos: TransactionalRepositories = createSqliteRepositories(db);
  const factory = options.factory ?? createSqliteRepositories;
  const uow = new SqliteUnitOfWork(db, factory);
  const clock = new FakeClock();
  const session = new SessionManager();
  session.update({ user: options.user ?? CASHIER, authMode: 'ONLINE', device: DEVICE });
  const trigger = new RecordingTrigger();
  const printer = new MockPrinter();
  const payments = PaymentMethodRegistry.withDefaults();
  await repos.productWriter.upsertMany([CHICKEN, COFFEE]);
  await repos.inventory.applyServerBalances([
    { productUuid: CHICKEN.uuid, quantityOnHand: options.stock ?? 10, updatedAt: '2026-10-01T00:00:00Z' },
  ]);
  const print = new PrintReceiptUseCase({
    saleReader: repos.saleReader,
    saleWriter: repos.saleWriter,
    settings: repos.settings,
    printer,
    printerSettings: new StaticPrinterSettings(),
    payments,
    uow: new SqliteUnitOfWork(db),
    session,
    clock,
    logger: silentLogger,
  });
  const completeSale = new CompleteSaleUseCase({
    uow,
    settings: repos.settings,
    pricing: new PricingCalculator(),
    payments,
    print,
    session,
    sync: trigger,
    clock,
    logger: silentLogger,
  });
  const openRegister = new OpenRegisterUseCase({ uow: new SqliteUnitOfWork(db), session, clock, logger: silentLogger, sync: trigger });
  const voidSale = new VoidSaleUseCase({ uow: new SqliteUnitOfWork(db), session, clock, logger: silentLogger, sync: trigger });
  const asManager = session.getState().user;
  session.update({ user: MANAGER });
  await openRegister.execute({ openingCash: 200000 });
  session.update({ user: asManager });
  return { db, repos, uow, clock, session, trigger, printer, payments, print, completeSale, openRegister, voidSale };
}

export function cashPayment(amount: number, tendered: number) {
  return {
    uuid: globalThis.crypto.randomUUID(),
    method: 'CASH',
    amount,
    tendered,
    change: tendered - amount,
    reference: null,
  };
}

export async function count(db: SqlJsDatabase, table: string, where = '1=1'): Promise<number> {
  const rows = await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
  return Number(rows[0]?.['n'] ?? 0);
}
