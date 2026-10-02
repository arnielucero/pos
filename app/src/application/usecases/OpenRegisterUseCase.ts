import { z } from 'zod';
import type { Approval } from '../../domain/entities/Approval';
import type { RegisterSession } from '../../domain/entities/Register';
import { InvalidStateError } from '../../domain/errors/DomainError';
import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import { PermissionPolicy } from '../../domain/services/PermissionPolicy';
import { newUuid } from '../../domain/valueObjects/Uuid';
import type { Clock } from '../ports/Clock';
import type { Logger } from '../ports/Logger';
import type { SyncTrigger } from '../ports/Network';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';
import { parseOrThrow } from '../shared/validation';
import { openRegisterPayload } from '../sync/payloads';

const schema = z.object({ openingCash: z.number().int().min(0).max(100_000_000) });

export class OpenRegisterUseCase {
  private readonly permissions = new PermissionPolicy();

  constructor(
    private readonly deps: { uow: UnitOfWork; session: SessionManager; clock: Clock; logger: Logger; sync: SyncTrigger },
  ) {}

  /** Loads the open session for this device (if any) into the session state. */
  async restore(): Promise<RegisterSession | null> {
    const device = this.deps.session.getState().device;
    if (!device) return null;
    const open = await this.deps.uow.run((r) => r.registers.findOpen(device.uuid));
    this.deps.session.update({ registerSession: open });
    return open;
  }

  async execute(input: { openingCash: number; approval?: Approval | null }): Promise<RegisterSession> {
    const { openingCash } = parseOrThrow(schema, input, 'Invalid opening cash');
    const d = this.deps;
    const user = d.session.requireUser();
    const device = d.session.requireDevice();
    const approval = this.permissions.require(user, 'register.open', input.approval);
    const now = d.clock.now();
    const session: RegisterSession = {
      uuid: newUuid(),
      deviceUuid: device.uuid,
      storeUuid: user.store.uuid,
      openedByUuid: user.uuid,
      openedAt: now.toISOString(),
      openingCash,
      status: 'OPEN',
      closedAt: null,
      closedByUuid: null,
      actualCash: null,
      expectedCash: null,
      cashSales: null,
      cashRefunds: null,
      cashAdjustments: null,
      variance: null,
    };
    await d.uow.run(async (r) => {
      if (await r.registers.findOpen(device.uuid)) throw new InvalidStateError('A register session is already open.');
      await r.registers.insert(session);
      await r.syncQueue.enqueue({
        uuid: session.uuid,
        entityType: 'register_session',
        entityId: session.uuid,
        operation: 'OPEN_REGISTER',
        payload: openRegisterPayload(session, approval),
      });
      await r.audit.append(
        auditEvent('REGISTER_OPENED', now, user.uuid, { type: 'register_session', uuid: session.uuid }, {
          openingCash,
          approvedBy: approval?.approvedByUuid ?? null,
        }),
      );
    });
    d.logger.audit('Register opened', { sessionUuid: session.uuid, openingCash });
    d.session.update({ registerSession: session });
    d.sync.nudge('register-opened');
    return session;
  }
}
