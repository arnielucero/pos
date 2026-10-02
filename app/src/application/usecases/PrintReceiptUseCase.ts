import type { Sale } from '../../domain/entities/Sale';
import { NotFoundError, PrinterConnectionError } from '../../domain/errors/DomainError';
import type { SaleReader, SaleWriter } from '../../domain/repositories/SaleRepository';
import type { SettingsRepository } from '../../domain/repositories/SettingsRepository';
import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import type { PaymentMethodRegistry } from '../../domain/services/payments/PaymentMethodRegistry';
import type { Receipt } from '../dto/Receipt';
import type { Clock } from '../ports/Clock';
import type { Logger } from '../ports/Logger';
import type { PrinterSettingsStore, ReceiptPrinter } from '../ports/ReceiptPrinter';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';

export type PrintOutcome =
  | { readonly ok: true; readonly receipt: Receipt }
  | { readonly ok: false; readonly receipt: Receipt | null; readonly error: PrinterConnectionError };

/**
 * Prints a sale receipt. Printer failures NEVER throw: they set print_status = FAILED, are
 * audited (PRINT_FAILED) and returned to the caller so the UI can offer a reprint.
 */
export class PrintReceiptUseCase {
  constructor(
    private readonly deps: {
      saleReader: SaleReader;
      saleWriter: SaleWriter;
      settings: SettingsRepository;
      printer: ReceiptPrinter;
      printerSettings: PrinterSettingsStore;
      payments: PaymentMethodRegistry;
      uow: UnitOfWork;
      session: SessionManager;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async buildReceipt(sale: Sale, isReprint: boolean): Promise<Receipt> {
    const settings = await this.deps.settings.getStoreSettings();
    const printer = await this.deps.printerSettings.get();
    const device = this.deps.session.getState().device;
    const hasCash = sale.payments.some((p) => p.method === 'CASH');
    return {
      headerLines: settings.receiptHeader.split('\n'),
      receiptNumber: sale.receiptNumber,
      createdAt: sale.createdAt,
      cashierName: sale.cashierName,
      deviceCode: device?.code ?? '',
      lines: sale.items.map((i) => ({
        name: i.name,
        sku: i.sku,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineGross: i.lineGross,
        lineDiscount: i.lineDiscount,
        lineTotal: i.lineTotal,
      })),
      subtotal: sale.subtotal,
      discountTotal: sale.discountTotal,
      total: sale.total,
      taxTotal: sale.taxTotal,
      taxRateBp: settings.taxRateBp,
      payments: sale.payments.map((p) => ({
        label: this.deps.payments.has(p.method) ? this.deps.payments.get(p.method).label : p.method,
        amount: p.amount,
        tendered: p.tendered,
        change: p.change,
        reference: p.reference,
      })),
      change: sale.payments.reduce((s, p) => s + p.change, 0),
      footerLines: settings.receiptFooter.split('\n'),
      isReprint,
      isVoided: sale.status === 'VOIDED',
      openDrawer: printer.openDrawer && hasCash && !isReprint,
    };
  }

  async execute(saleUuid: string, options: { reprint?: boolean } = {}): Promise<PrintOutcome> {
    const d = this.deps;
    const sale = await d.saleReader.findByUuid(saleUuid);
    if (!sale) throw new NotFoundError('Sale not found.');
    let receipt: Receipt | null = null;
    try {
      receipt = await this.buildReceipt(sale, options.reprint ?? false);
      await d.printer.print(receipt);
      await d.saleWriter.updatePrintStatus(sale.uuid, 'PRINTED');
      return { ok: true, receipt };
    } catch (e) {
      const error =
        e instanceof PrinterConnectionError ? e : new PrinterConnectionError('IO_ERROR', 'The receipt could not be printed.');
      d.logger.warning('Receipt print failed', { saleUuid, reason: error.reason });
      try {
        await d.saleWriter.updatePrintStatus(sale.uuid, 'FAILED');
        await d.uow.run((r) =>
          r.audit.append(
            auditEvent('PRINT_FAILED', d.clock.now(), d.session.getState().user?.uuid ?? null, { type: 'sale', uuid: sale.uuid }, {
              reason: error.reason,
              reprint: options.reprint ?? false,
            }),
          ),
        );
      } catch (inner) {
        d.logger.error('Could not record print failure', { error: String(inner) });
      }
      return { ok: false, receipt, error };
    }
  }
}
