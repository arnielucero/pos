import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../../src/application/session/SessionManager';
import { RequestApprovalUseCase } from '../../src/application/usecases/RequestApprovalUseCase';
import { ApprovalFailedError } from '../../src/domain/errors/DomainError';
import { BcryptPinVerifier } from '../../src/infrastructure/authentication/BcryptPinVerifier';
import { createSqliteRepositories, SqliteUnitOfWork } from '../../src/infrastructure/repositories/SqliteUnitOfWork';
import { CASHIER, count, FakeClock, FakeNetwork, MANAGER, openTestDb, silentLogger } from '../support/harness';

describe('RequestApprovalUseCase (manager PIN)', () => {
  let useCase: RequestApprovalUseCase;
  let clock: FakeClock;
  let network: FakeNetwork;
  let db: Awaited<ReturnType<typeof openTestDb>>;

  beforeEach(async () => {
    db = await openTestDb();
    const repos = createSqliteRepositories(db);
    // $2y$ like Laravel; cost 4 to keep the test fast (production hashes are cost ≥ 12).
    const hash = bcrypt.hashSync('123456', 4).replace(/^\$2[ab]\$/, '$2y$');
    await repos.approvers.upsertMany([
      { userUuid: MANAGER.uuid, name: MANAGER.name, permissions: MANAGER.permissions, pinHash: hash, isActive: true },
      { userUuid: 'sup', name: 'Sam Supervisor', permissions: ['approval.grant', 'sale.void'], pinHash: hash, isActive: true },
      { userUuid: 'argon', name: 'Argon Admin', permissions: ['approval.grant', 'sale.void'], pinHash: '$argon2id$v=19$m=65536,t=4,p=1$abc$def', isActive: true },
      { userUuid: 'gone', name: 'Gone', permissions: ['approval.grant', 'sale.void'], pinHash: hash, isActive: false },
    ]);
    const session = new SessionManager();
    session.update({ user: CASHIER });
    clock = new FakeClock();
    network = new FakeNetwork('OFFLINE');
    useCase = new RequestApprovalUseCase({
      approvers: repos.approvers,
      pinVerifier: new BcryptPinVerifier(),
      uow: new SqliteUnitOfWork(db),
      session,
      network,
      clock,
      logger: silentLogger,
    });
  });

  const req = (pin: string, approverUuid = MANAGER.uuid) => ({ permission: 'sale.void' as const, approverUuid, pin, reason: 'Customer changed mind' });

  it('grants an OFFLINE_PIN approval for the right PIN and audits it', async () => {
    const a = await useCase.execute(req('123456'));
    expect(a).toMatchObject({ approvedByUuid: MANAGER.uuid, mode: 'OFFLINE_PIN', permission: 'sale.void', reason: 'Customer changed mind' });
    expect(await count(db, 'audit_logs', "action = 'APPROVAL_GRANTED'")).toBe(1);
  });

  it('uses mode ONLINE when the API is reachable', async () => {
    network.state = 'ONLINE';
    await expect(useCase.execute(req('123456'))).resolves.toMatchObject({ mode: 'ONLINE' });
  });

  it('only lists approvers holding approval.grant AND the permission', async () => {
    expect((await useCase.listApprovers('sale.void')).map((a) => a.name).sort()).toEqual(['Argon Admin', 'Maria Manager', 'Sam Supervisor']);
    expect((await useCase.listApprovers('inventory.adjust')).map((a) => a.name)).toEqual(['Maria Manager']);
    await expect(useCase.execute({ ...req('123456', 'sup'), permission: 'inventory.adjust' })).rejects.toBeInstanceOf(ApprovalFailedError);
    await expect(useCase.execute(req('123456', 'gone'))).rejects.toBeInstanceOf(ApprovalFailedError);
  });

  it('locks out after 5 wrong PINs, then unlocks after the lockout window', async () => {
    for (let i = 4; i >= 1; i--) {
      await expect(useCase.execute(req('000000'))).rejects.toMatchObject({ remainingAttempts: i });
    }
    await expect(useCase.execute(req('000000'))).rejects.toMatchObject({ remainingAttempts: 0 });
    // Correct PIN refused while locked.
    await expect(useCase.execute(req('123456'))).rejects.toBeInstanceOf(ApprovalFailedError);
    expect(await count(db, 'audit_logs', "action = 'APPROVAL_FAILED'")).toBe(5);
    clock.advance(5 * 60_000 + 1);
    await expect(useCase.execute(req('123456'))).resolves.toMatchObject({ approvedByUuid: MANAGER.uuid });
  });

  it('rejects malformed PINs and unsupported (argon2id) hashes', async () => {
    await expect(useCase.execute(req('12345'))).rejects.toBeInstanceOf(ApprovalFailedError);
    await expect(useCase.execute(req('123456', 'argon'))).rejects.toThrow(/cannot be verified/);
  });
});
