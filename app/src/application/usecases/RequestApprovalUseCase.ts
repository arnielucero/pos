import { z } from 'zod';
import type { Approval, Approver } from '../../domain/entities/Approval';
import { PERMISSIONS, type Permission } from '../../domain/entities/Permission';
import { ApprovalFailedError } from '../../domain/errors/DomainError';
import type { ApproverRepository } from '../../domain/repositories/ApproverRepository';
import type { UnitOfWork } from '../../domain/repositories/UnitOfWork';
import { PinAttemptPolicy } from '../../domain/services/PinAttemptPolicy';
import type { Clock } from '../ports/Clock';
import type { PinVerifier } from '../ports/Credentials';
import type { Logger } from '../ports/Logger';
import type { NetworkStatusProvider } from '../ports/Network';
import type { SessionManager } from '../session/SessionManager';
import { auditEvent } from '../shared/audit';
import { parseOrThrow } from '../shared/validation';

const schema = z.object({
  permission: z.enum(PERMISSIONS),
  approverUuid: z.string().min(1),
  pin: z.string(),
  reason: z.string().trim().min(1, 'Reason is required').max(255),
});

export type ApprovalRequest = z.input<typeof schema>;

/**
 * Manager PIN approval. Verifies the PIN against the synced bcrypt `pin_hash`, applies a local
 * per-approver attempt limit + lockout, audits every outcome, and returns the contract approval
 * object. The server re-validates the approver (API.md "Approval object").
 */
export class RequestApprovalUseCase {
  constructor(
    private readonly deps: {
      approvers: ApproverRepository;
      pinVerifier: PinVerifier;
      uow: UnitOfWork;
      session: SessionManager;
      network: NetworkStatusProvider;
      clock: Clock;
      logger: Logger;
      attemptPolicy?: PinAttemptPolicy;
    },
  ) {}

  private get policy(): PinAttemptPolicy {
    return this.deps.attemptPolicy ?? new PinAttemptPolicy();
  }

  /** Approvers able to approve `permission` (for the approver picker). */
  async listApprovers(permission: Permission): Promise<readonly Approver[]> {
    const all = await this.deps.approvers.listActive();
    return all.filter((a) => canApprove(a, permission));
  }

  async execute(input: ApprovalRequest): Promise<Approval> {
    const req = parseOrThrow(schema, input, 'Invalid approval request');
    const d = this.deps;
    const now = d.clock.now();
    const requester = d.session.getState().user;
    const approver = await d.approvers.findByUuid(req.approverUuid);
    if (!approver || !approver.isActive || !canApprove(approver, req.permission)) {
      throw new ApprovalFailedError('This person cannot approve this action.', null);
    }
    if (this.policy.isLocked(approver, now)) {
      d.logger.security('PIN approval attempted while locked', { approverUuid: approver.userUuid });
      throw new ApprovalFailedError('Too many wrong PINs. Approval is locked for a few minutes.', 0);
    }
    if (!d.pinVerifier.supports(approver.pinHash)) {
      throw new ApprovalFailedError('This manager PIN cannot be verified on this device.', null);
    }
    const ok = /^\d{6}$/.test(req.pin) && (await d.pinVerifier.verify(req.pin, approver.pinHash));
    if (!ok) {
      const next = this.policy.onFailure(approver, now);
      await d.uow.run(async (r) => {
        await r.approvers.updateAttempts(approver.userUuid, next.failedAttempts, next.lockedUntil);
        await r.audit.append(
          auditEvent('APPROVAL_FAILED', now, requester?.uuid ?? null, { type: 'user', uuid: approver.userUuid }, {
            permission: req.permission,
            locked: next.lockedUntil !== null,
          }),
        );
      });
      d.logger.security('Wrong manager PIN', { approverUuid: approver.userUuid, locked: next.lockedUntil !== null });
      if (next.lockedUntil) throw new ApprovalFailedError('Too many wrong PINs. Approval is locked for a few minutes.', 0);
      const remaining = this.policy.remaining({ failedAttempts: next.failedAttempts });
      throw new ApprovalFailedError(`Wrong PIN. ${String(remaining)} attempt(s) left.`, remaining);
    }

    const mode = d.network.current() === 'ONLINE' ? 'ONLINE' : 'OFFLINE_PIN';
    const approval: Approval = {
      approvedByUuid: approver.userUuid,
      approvedByName: approver.name,
      approvedAt: now.toISOString(),
      mode,
      reason: req.reason,
      permission: req.permission,
    };
    await d.uow.run(async (r) => {
      await r.approvers.updateAttempts(approver.userUuid, 0, null);
      await r.audit.append(
        auditEvent('APPROVAL_GRANTED', now, requester?.uuid ?? null, { type: 'user', uuid: approver.userUuid }, {
          permission: req.permission,
          mode,
          reason: req.reason,
        }),
      );
    });
    d.logger.audit('Manager approval granted', { permission: req.permission, mode, approverUuid: approver.userUuid });
    return approval;
  }
}

function canApprove(a: Approver, permission: string): boolean {
  return a.permissions.includes('approval.grant') && a.permissions.includes(permission);
}
