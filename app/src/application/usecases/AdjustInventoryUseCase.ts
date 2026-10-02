import { z } from 'zod';
import type { Approval } from '../../domain/entities/Approval';
import type { InventoryMovement } from '../../domain/entities/Inventory';
import { NotFoundError, ValidationError } from '../../domain/errors/DomainError';
import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import { PermissionPolicy } from '../../domain/services/PermissionPolicy';
import { newUuid } from '../../domain/valueObjects/Uuid';
import type { Clock } from '../ports/Clock';
import type { Logger } from '../ports/Logger';
import type { SyncTrigger } from '../ports/Network';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';
import { parseOrThrow } from '../shared/validation';
import { adjustInventoryPayload } from '../sync/payloads';

const schema = z.object({
  productUuid: z.string().min(1),
  type: z.enum(['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT']),
  quantity: z.number().int().min(-100_000).max(100_000),
  reason: z.string().trim().min(3, 'Enter a reason').max(255),
});

export type AdjustInventoryInput = z.input<typeof schema> & { approval?: Approval | null };

export class AdjustInventoryUseCase {
  private readonly permissions = new PermissionPolicy();

  constructor(
    private readonly deps: { uow: UnitOfWork; session: SessionManager; clock: Clock; logger: Logger; sync: SyncTrigger },
  ) {}

  async execute(input: AdjustInventoryInput): Promise<InventoryMovement> {
    const req = parseOrThrow(schema, input, 'Invalid adjustment');
    if (req.quantity === 0) throw new ValidationError('Quantity cannot be zero.');
    if (req.type === 'STOCK_IN' && req.quantity < 0) throw new ValidationError('Stock in must be a positive quantity.');
    if (req.type === 'STOCK_OUT' && req.quantity > 0) throw new ValidationError('Stock out must be a negative quantity.');
    const d = this.deps;
    const user = d.session.requireUser();
    const approval = this.permissions.require(user, 'inventory.adjust', input.approval);
    const now = d.clock.now();
    const movement: InventoryMovement = {
      uuid: newUuid(),
      productUuid: req.productUuid,
      type: req.type,
      quantity: req.quantity,
      reference: null,
      reason: req.reason,
      createdAt: now.toISOString(),
      syncStatus: 'PENDING',
    };
    await d.uow.run(async (r) => {
      const [product] = await r.productReader.findByUuids([req.productUuid]);
      if (!product) throw new NotFoundError('Product not found.');
      await r.inventory.applyMovement({ ...movement, reference: movement.uuid });
      await r.syncQueue.enqueue({
        uuid: movement.uuid,
        entityType: 'inventory_movement',
        entityId: movement.uuid,
        operation: 'ADJUST_INVENTORY',
        payload: adjustInventoryPayload(movement, user.uuid, approval),
      });
      await r.audit.append(
        auditEvent('INVENTORY_ADJUSTED', now, user.uuid, { type: 'product', uuid: req.productUuid }, {
          type: req.type,
          quantity: req.quantity,
          reason: req.reason,
          approvedBy: approval?.approvedByUuid ?? null,
        }),
      );
    });
    d.logger.audit('Inventory adjusted', { productUuid: req.productUuid, quantity: req.quantity });
    d.sync.nudge('inventory-adjusted');
    return movement;
  }
}
