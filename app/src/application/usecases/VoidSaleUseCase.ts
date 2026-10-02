import { z } from 'zod';
import type { Approval } from '../../domain/entities/Approval';
import { InvalidStateError, NotFoundError } from '../../domain/errors/DomainError';
import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import { PermissionPolicy } from '../../domain/services/PermissionPolicy';
import { newUuid } from '../../domain/valueObjects/Uuid';
import type { Clock } from '../ports/Clock';
import type { Logger } from '../ports/Logger';
import type { SyncTrigger } from '../ports/Network';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';
import { parseOrThrow } from '../shared/validation';
import { voidSalePayload } from '../sync/payloads';

const schema = z.object({
  saleUuid: z.string().min(1),
  reason: z.string().trim().min(3, 'Enter a reason').max(255),
});

/** Voids a sale locally (status VOIDED, reversing movements) and queues VOID_SALE. */
export class VoidSaleUseCase {
  private readonly permissions = new PermissionPolicy();

  constructor(
    private readonly deps: { uow: UnitOfWork; session: SessionManager; clock: Clock; logger: Logger; sync: SyncTrigger },
  ) {}

  async execute(input: { saleUuid: string; reason: string; approval?: Approval | null }): Promise<void> {
    const { saleUuid, reason } = parseOrThrow(schema, input, 'Invalid void request');
    const d = this.deps;
    const user = d.session.requireUser();
    const approval = this.permissions.require(user, 'sale.void', input.approval);
    const now = d.clock.now();
    const voidedAt = now.toISOString();
    const voidUuid = newUuid();
    await d.uow.run(async (r) => {
      const sale = await r.saleReader.findByUuid(saleUuid);
      if (!sale) throw new NotFoundError('Sale not found.');
      if (sale.status === 'VOIDED') throw new InvalidStateError('This sale is already voided.');
      await r.saleWriter.markVoided(sale.uuid, reason, voidedAt);
      const original = await r.inventory.listByReference(sale.uuid);
      for (const m of original.filter((x) => x.type === 'SALE')) {
        await r.inventory.applyMovement({
          uuid: newUuid(),
          productUuid: m.productUuid,
          type: 'VOID',
          quantity: -m.quantity,
          reference: voidUuid,
          reason,
          createdAt: voidedAt,
          syncStatus: 'PENDING',
        });
      }
      await r.syncQueue.enqueue({
        uuid: voidUuid,
        entityType: 'sale',
        entityId: sale.uuid,
        operation: 'VOID_SALE',
        payload: voidSalePayload({ uuid: voidUuid, saleUuid: sale.uuid, reason, voidedAt, voidedByUuid: user.uuid, approval }),
      });
      await r.audit.append(
        auditEvent('SALE_VOIDED', now, user.uuid, { type: 'sale', uuid: sale.uuid }, {
          reason,
          receiptNumber: sale.receiptNumber,
          approvedBy: approval?.approvedByUuid ?? null,
          approvalMode: approval?.mode ?? null,
        }),
      );
    });
    d.logger.audit('Sale voided', { saleUuid, approvedBy: approval?.approvedByUuid ?? null });
    d.sync.nudge('sale-voided');
  }
}
