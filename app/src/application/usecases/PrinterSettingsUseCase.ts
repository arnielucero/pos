import type { Approval } from '../../domain/entities/Approval';
import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import { PermissionPolicy } from '../../domain/services/PermissionPolicy';
import type { Clock } from '../ports/Clock';
import type { PrinterDevice, PrinterSettings, PrinterSettingsStore, PrinterStatus, ReceiptPrinter } from '../ports/ReceiptPrinter';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';

/** Printer configuration (settings.edit or approval), discovery and test print. */
export class PrinterSettingsUseCase {
  private readonly permissions = new PermissionPolicy();

  constructor(
    private readonly deps: {
      store: PrinterSettingsStore;
      printer: ReceiptPrinter;
      uow: UnitOfWork;
      session: SessionManager;
      clock: Clock;
    },
  ) {}

  get(): Promise<PrinterSettings> {
    return this.deps.store.get();
  }

  async save(settings: PrinterSettings, approval?: Approval | null): Promise<void> {
    const user = this.deps.session.requireUser();
    const granted = this.permissions.require(user, 'settings.edit', approval);
    await this.deps.store.save(settings);
    await this.deps.uow.run((r) =>
      r.audit.append(
        auditEvent('PRINTER_SETTINGS_CHANGED', this.deps.clock.now(), user.uuid, null, {
          type: settings.type,
          paperWidth: settings.paperWidth,
          approvedBy: granted?.approvedByUuid ?? null,
        }),
      ),
    );
  }

  /** Lists paired printers using the given (unsaved) printer type. */
  async discover(settings: PrinterSettings): Promise<readonly PrinterDevice[]> {
    const current = await this.deps.store.get();
    if (current.type !== settings.type) return [];
    return this.deps.printer.discover();
  }

  async testPrint(): Promise<PrinterStatus> {
    await this.deps.printer.printTest();
    return this.deps.printer.status();
  }
}
