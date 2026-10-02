import type { Approval } from '../../domain/entities/Approval';
import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import { PermissionPolicy } from '../../domain/services/PermissionPolicy';
import type { Clock } from '../ports/Clock';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';
import type { PrintOutcome, PrintReceiptUseCase } from './PrintReceiptUseCase';

/** Reprints an existing sale's receipt (marked REPRINT). Never creates a new sale. */
export class ReprintReceiptUseCase {
  private readonly permissions = new PermissionPolicy();

  constructor(
    private readonly deps: { print: PrintReceiptUseCase; uow: UnitOfWork; session: SessionManager; clock: Clock },
  ) {}

  async execute(saleUuid: string, approval?: Approval | null): Promise<PrintOutcome> {
    const user = this.deps.session.requireUser();
    const granted = this.permissions.require(user, 'sale.reprint', approval);
    await this.deps.uow.run((r) =>
      r.audit.append(
        auditEvent('SALE_REPRINTED', this.deps.clock.now(), user.uuid, { type: 'sale', uuid: saleUuid }, {
          approvedBy: granted?.approvedByUuid ?? null,
        }),
      ),
    );
    return this.deps.print.execute(saleUuid, { reprint: true });
  }
}
