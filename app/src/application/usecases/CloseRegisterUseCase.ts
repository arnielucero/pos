import { z } from 'zod';
import type { Approval } from '../../domain/entities/Approval';
import type { RegisterReport } from '../../domain/entities/Register';
import { RegisterNotOpenError } from '../../domain/errors/DomainError';
import type { TransactionalRepositories, UnitOfWork } from '../../domain/repositories/UnitOfWork';
import { PermissionPolicy } from '../../domain/services/PermissionPolicy';
import { RegisterReportCalculator } from '../../domain/services/RegisterReportCalculator';
import { newUuid } from '../../domain/valueObjects/Uuid';
import type { Clock } from '../ports/Clock';
import type { Logger } from '../ports/Logger';
import type { SyncTrigger } from '../ports/Network';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';
import { parseOrThrow } from '../shared/validation';
import { closeRegisterPayload } from '../sync/payloads';

const schema = z.object({ actualCash: z.number().int().min(0).max(1_000_000_000) });

/** X report (mid-shift, read-only) and Z report (closes the session, queues CLOSE_REGISTER). */
export class CloseRegisterUseCase {
  private readonly permissions = new PermissionPolicy();
  private readonly calculator = new RegisterReportCalculator();

  constructor(
    private readonly deps: { uow: UnitOfWork; session: SessionManager; clock: Clock; logger: Logger; sync: SyncTrigger },
  ) {}

  async xReport(): Promise<RegisterReport> {
    const d = this.deps;
    d.session.requireUser();
    const current = d.session.getState().registerSession;
    if (!current) throw new RegisterNotOpenError();
    return d.uow.run((r) => this.compute(r, 'X', current.uuid, null));
  }

  async close(input: { actualCash: number; approval?: Approval | null }): Promise<RegisterReport> {
    const { actualCash } = parseOrThrow(schema, input, 'Invalid cash count');
    const d = this.deps;
    const user = d.session.requireUser();
    const current = d.session.getState().registerSession;
    if (!current) throw new RegisterNotOpenError();
    const approval = this.permissions.require(user, 'register.close', input.approval);
    const now = d.clock.now();
    const report = await d.uow.run(async (r) => {
      const z = await this.compute(r, 'Z', current.uuid, actualCash);
      const variance = z.variance ?? 0;
      await r.registers.close(current.uuid, {
        closedAt: now.toISOString(),
        closedByUuid: user.uuid,
        actualCash,
        expectedCash: z.expectedCash,
        cashSales: z.cashSales,
        cashRefunds: z.cashRefunds,
        cashAdjustments: z.cashAdjustments,
        variance,
      });
      const closeUuid = newUuid();
      await r.syncQueue.enqueue({
        uuid: closeUuid,
        entityType: 'register_session',
        entityId: current.uuid,
        operation: 'CLOSE_REGISTER',
        payload: closeRegisterPayload({
          uuid: closeUuid,
          sessionUuid: current.uuid,
          closedByUuid: user.uuid,
          closedAt: now.toISOString(),
          actualCash,
          expectedCash: z.expectedCash,
          cashSales: z.cashSales,
          cashRefunds: z.cashRefunds,
          cashAdjustments: z.cashAdjustments,
          variance,
          approval,
        }),
      });
      await r.audit.append(
        auditEvent('REGISTER_CLOSED', now, user.uuid, { type: 'register_session', uuid: current.uuid }, {
          expectedCash: z.expectedCash,
          actualCash,
          variance,
          approvedBy: approval?.approvedByUuid ?? null,
        }),
      );
      return z;
    });
    d.logger.audit('Register closed', { sessionUuid: current.uuid, variance: report.variance });
    d.session.update({ registerSession: null });
    d.sync.nudge('register-closed');
    return report;
  }

  private async compute(
    r: TransactionalRepositories,
    kind: 'X' | 'Z',
    sessionUuid: string,
    actualCash: number | null,
  ): Promise<RegisterReport> {
    const session = await r.registers.findByUuid(sessionUuid);
    if (!session) throw new RegisterNotOpenError();
    const sales = await r.saleReader.listBySession(sessionUuid);
    return this.calculator.compute(kind, session, sales, this.deps.clock.now().toISOString(), actualCash);
  }
}
