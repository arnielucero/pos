import type { Approval } from '../../domain/entities/Approval';
import type { ProductWithStock } from '../../domain/entities/Product';
import type { ApprovedDiscount, Payment, Sale, SaleItem } from '../../domain/entities/Sale';
import { InsufficientStockError, RegisterNotOpenError, ValidationError } from '../../domain/errors/DomainError';
import type { SettingsRepository } from '../../domain/repositories/SettingsRepository';
import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import { DiscountPolicy } from '../../domain/services/DiscountPolicy';
import type { PaymentMethodRegistry } from '../../domain/services/payments/PaymentMethodRegistry';
import { PaymentValidator } from '../../domain/services/payments/PaymentValidator';
import { PermissionPolicy } from '../../domain/services/PermissionPolicy';
import type { PricingCalculator } from '../../domain/services/PricingCalculator';
import { formatReceiptNumber, localDayKey } from '../../domain/services/ReceiptNumber';
import { newUuid } from '../../domain/valueObjects/Uuid';
import { checkoutInputSchema, type CheckoutInput } from '../dto/CartInput';
import type { Clock } from '../ports/Clock';
import type { Logger } from '../ports/Logger';
import type { SyncTrigger } from '../ports/Network';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';
import { parseOrThrow } from '../shared/validation';
import { createSalePayload } from '../sync/payloads';
import type { PrintOutcome, PrintReceiptUseCase } from './PrintReceiptUseCase';

export interface StockWarning {
  readonly productUuid: string;
  readonly name: string;
  readonly requested: number;
  readonly available: number;
}

export interface CompleteSaleResult {
  readonly sale: Sale;
  readonly stockWarnings: readonly StockWarning[];
  readonly print: PrintOutcome | null;
}

export const SETTINGS_CATALOG_SYNCED_AT = 'sync.catalog_synced_at';

/**
 * The checkout transaction (see docs/OFFLINE_SYNC.md):
 *  1. validate input (zod) and domain rules (permissions/approvals, discount limit, payments);
 *  2. price from the LOCAL catalog (never from UI-supplied prices) with PricingCalculator;
 *  3. check local stock (BLOCK → InsufficientStockError, WARN → warnings);
 *  4. ONE SQLite transaction: receipt seq, sale, items, payments, inventory movements +
 *     balance decrement, sync_queue CREATE_SALE (idempotency key = sale uuid), audit row;
 *  5. after commit: print (failure only marks print_status = FAILED) and nudge sync.
 */
export class CompleteSaleUseCase {
  private readonly permissions = new PermissionPolicy();
  private readonly paymentValidator: PaymentValidator;

  constructor(
    private readonly deps: {
      uow: UnitOfWork;
      settings: SettingsRepository;
      pricing: PricingCalculator;
      payments: PaymentMethodRegistry;
      print: PrintReceiptUseCase | null;
      session: SessionManager;
      sync: SyncTrigger;
      clock: Clock;
      logger: Logger;
    },
  ) {
    this.paymentValidator = new PaymentValidator(deps.payments);
  }

  async execute(rawInput: CheckoutInput): Promise<CompleteSaleResult> {
    const input = parseOrThrow(checkoutInputSchema, rawInput, 'Invalid checkout');
    const d = this.deps;
    const user = d.session.requireUser();
    const device = d.session.requireDevice();
    const register = d.session.getState().registerSession;
    if (!register || register.status !== 'OPEN') throw new RegisterNotOpenError();

    this.permissions.require(user, 'sale.create', rawInput.approvals?.saleCreate);
    const hasDiscount =
      input.lines.some((l) => l.discount !== null && l.discount.value > 0) ||
      (input.orderDiscount !== null && input.orderDiscount.value > 0);
    const discountApproval: Approval | null = hasDiscount
      ? this.permissions.require(user, 'discount.apply', rawInput.approvals?.discount)
      : null;

    const settings = await d.settings.getStoreSettings();
    const catalogSyncedAt = await d.settings.get(SETTINGS_CATALOG_SYNCED_AT);
    const discountPolicy = new DiscountPolicy(settings.maxDiscountBp);
    const now = d.clock.now();
    const createdAt = now.toISOString();
    const saleUuid = newUuid();

    const { sale, warnings } = await d.uow.run(async (r) => {
      const uuids = [...new Set(input.lines.map((l) => l.productUuid))];
      const products = new Map<string, ProductWithStock>((await r.productReader.findByUuids(uuids)).map((p) => [p.uuid, p]));
      const lines = input.lines.map((l) => {
        const product = products.get(l.productUuid);
        if (!product) throw new ValidationError('A product in the cart no longer exists in the catalog.');
        if (!product.isActive || product.deleted) throw new ValidationError(`${product.name} is no longer sold.`);
        return { line: l, product };
      });

      const priced = d.pricing.calculate({
        items: lines.map(({ line, product }) => ({ unitPrice: product.price, quantity: line.quantity, discount: line.discount })),
        orderDiscount: input.orderDiscount,
        taxRateBp: settings.taxRateBp,
      });
      lines.forEach(({ line, product }, i) => {
        discountPolicy.assertWithinLimit(line.discount, priced.lines[i]?.lineGross ?? 0, product.name);
      });
      discountPolicy.assertWithinLimit(input.orderDiscount, priced.linesNet, 'Order discount');

      const payments: Payment[] = input.payments.map((p) => ({ ...p }));
      this.paymentValidator.validate(priced.total, payments);

      // Stock check on aggregated quantities (same product may appear on several lines).
      const requested = new Map<string, number>();
      for (const { line, product } of lines) {
        if (product.trackStock) requested.set(product.uuid, (requested.get(product.uuid) ?? 0) + line.quantity);
      }
      const shortages: StockWarning[] = [];
      for (const [uuid, qty] of requested) {
        const product = products.get(uuid);
        const available = product?.quantityOnHand ?? 0;
        if (product && qty > available) shortages.push({ productUuid: uuid, name: product.name, requested: qty, available });
      }
      if (shortages.length > 0 && settings.stockPolicy === 'BLOCK') throw new InsufficientStockError(shortages);

      const seq = await r.receiptCounter.next(localDayKey(now));
      const items: SaleItem[] = lines.map(({ line, product }, i) => {
        const p = priced.lines[i];
        if (!p) throw new ValidationError('Pricing failed');
        const discount: ApprovedDiscount | null =
          line.discount && line.discount.value > 0 ? { ...line.discount, approval: discountApproval } : null;
        return {
          uuid: newUuid(),
          productUuid: product.uuid,
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitPrice: product.price,
          discount,
          lineGross: p.lineGross,
          lineDiscount: p.lineDiscount,
          lineTotal: p.lineTotal,
        };
      });
      const sale: Sale = {
        uuid: saleUuid,
        receiptNumber: formatReceiptNumber(device.code, localDayKey(now), seq),
        serverId: null,
        cashierUuid: user.uuid,
        cashierName: user.name,
        storeUuid: user.store.uuid,
        deviceUuid: device.uuid,
        registerSessionUuid: register.uuid,
        subtotal: priced.subtotal,
        orderDiscount:
          input.orderDiscount && input.orderDiscount.value > 0 ? { ...input.orderDiscount, approval: discountApproval } : null,
        orderDiscountAmount: priced.orderDiscount,
        discountTotal: priced.discountTotal,
        taxTotal: priced.taxTotal,
        total: priced.total,
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        syncStatus: 'PENDING',
        printStatus: 'PENDING',
        catalogSyncedAt,
        createdAt,
        updatedAt: createdAt,
        voidedAt: null,
        voidReason: null,
        items,
        payments,
      };

      await r.saleWriter.insert(sale);
      for (const [productUuid, qty] of requested) {
        await r.inventory.applyMovement({
          uuid: newUuid(),
          productUuid,
          type: 'SALE',
          quantity: -qty,
          reference: sale.uuid,
          reason: null,
          createdAt,
          syncStatus: 'PENDING',
        });
      }
      await r.syncQueue.enqueue({
        uuid: sale.uuid,
        entityType: 'sale',
        entityId: sale.uuid,
        operation: 'CREATE_SALE',
        payload: createSalePayload(sale),
      });
      await r.audit.append(
        auditEvent('SALE_CREATED', now, user.uuid, { type: 'sale', uuid: sale.uuid }, {
          receiptNumber: sale.receiptNumber,
          total: sale.total,
          discountApprovedBy: discountApproval?.approvedByUuid ?? null,
          stockWarnings: shortages.length,
        }),
      );
      return { sale, warnings: shortages };
    });

    d.logger.audit('Sale completed', { saleUuid: sale.uuid, receiptNumber: sale.receiptNumber, total: sale.total });

    let print: PrintOutcome | null = null;
    if (d.print) {
      try {
        print = await d.print.execute(sale.uuid);
      } catch (e) {
        d.logger.error('Unexpected print error (sale is saved)', { error: String(e) });
      }
    }
    d.sync.nudge('sale-completed');
    const printStatus = print === null ? sale.printStatus : print.ok ? 'PRINTED' : 'FAILED';
    return { sale: { ...sale, printStatus }, stockWarnings: warnings, print };
  }
}
