<?php

declare(strict_types=1);

namespace App\Application\Register;

use App\Application\Shared\ApprovalRules;
use App\Application\Shared\PayloadValidator;
use App\Application\Shared\StoreUsers;
use App\Application\Sync\IgnoresRejections;
use App\Application\Sync\OperationHandler;
use App\Application\Sync\SyncContext;
use App\Domain\Approval\ApprovalVerifier;
use App\Domain\Audit\AuditLevel;
use App\Domain\Audit\AuditLogger;
use App\Domain\Auth\Exceptions\ForbiddenException;
use App\Domain\Auth\Permission;
use App\Domain\Sync\OperationResult;
use App\Domain\Sync\OperationType;
use App\Models\RegisterSession;
use Carbon\CarbonImmutable;

final class OpenRegisterAction implements OperationHandler
{
    use IgnoresRejections;

    public function __construct(
        private readonly PayloadValidator $validator,
        private readonly StoreUsers $users,
        private readonly ApprovalVerifier $approvals,
        private readonly AuditLogger $audit,
    ) {}

    public function type(): OperationType
    {
        return OperationType::OPEN_REGISTER;
    }

    public function handle(SyncContext $ctx, array $payload, string $payloadHash): OperationResult
    {
        $data = $this->validator->validate($payload, [
            'uuid' => ['required', 'uuid'],
            'opened_by_uuid' => ['required', 'uuid'],
            'opened_at' => ['required', 'date'],
            'opening_cash' => ['required', 'integer:strict', 'min:0', 'max:1000000000000'],
            ...ApprovalRules::for('approval'),
        ]);

        $actor = $this->users->requireActive($data['opened_by_uuid'], $ctx->storeId(), 'opened_by_uuid');
        $this->approvals->authorize($actor, Permission::REGISTER_OPEN, $data['approval'] ?? null)
            ?? throw new ForbiddenException('Opening a register requires register.open or a valid approval.');

        $openedAt = CarbonImmutable::parse($data['opened_at'])->utc();
        $session = RegisterSession::create([
            'uuid' => $data['uuid'],
            'store_id' => $ctx->storeId(),
            'device_id' => $ctx->device->id,
            'opened_by' => $actor->id,
            'opened_at' => $openedAt,
            'opening_cash' => (int) $data['opening_cash'],
            'status' => 'OPEN',
            'synced_by' => $ctx->user->id,
        ]);

        $this->audit->log('REGISTER_OPENED', AuditLevel::AUDIT, $ctx->storeId(), $actor->id, $ctx->device->id, 'register_session',
            $session->uuid, ['opening_cash' => $session->opening_cash], occurredAt: $openedAt, ip: $ctx->ip);

        return OperationResult::stored($session->uuid, (int) $session->id);
    }
}
