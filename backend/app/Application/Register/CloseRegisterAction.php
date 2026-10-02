<?php

declare(strict_types=1);

namespace App\Application\Register;

use App\Application\Shared\ApprovalRules;
use App\Application\Shared\PayloadValidator;
use App\Application\Shared\StoreUsers;
use App\Application\Sync\ConflictRecorder;
use App\Application\Sync\IgnoresRejections;
use App\Application\Sync\OperationHandler;
use App\Application\Sync\SyncContext;
use App\Domain\Approval\ApprovalVerifier;
use App\Domain\Audit\AuditLevel;
use App\Domain\Audit\AuditLogger;
use App\Domain\Auth\Exceptions\ForbiddenException;
use App\Domain\Auth\Permission;
use App\Domain\Register\Exceptions\RegisterAlreadyClosedException;
use App\Domain\Register\Exceptions\RegisterSessionNotFoundException;
use App\Domain\Sales\Conflict;
use App\Domain\Sales\ConflictType;
use App\Domain\Sales\Exceptions\InvalidTotalsException;
use App\Domain\Sync\OperationResult;
use App\Domain\Sync\OperationType;
use App\Models\Payment;
use App\Models\RegisterClosure;
use App\Models\RegisterSession;
use App\Models\Sale;
use Carbon\CarbonImmutable;

/**
 * CLOSE_REGISTER: the server recomputes cash_sales / expected_cash from synced sales and records both
 * client and server figures. Differences are REGISTER_TOTALS_MISMATCH conflicts (FLAGGED, never rejected).
 */
final class CloseRegisterAction implements OperationHandler
{
    use IgnoresRejections;

    public function __construct(
        private readonly PayloadValidator $validator,
        private readonly StoreUsers $users,
        private readonly ApprovalVerifier $approvals,
        private readonly ConflictRecorder $conflictRecorder,
        private readonly AuditLogger $audit,
    ) {}

    public function type(): OperationType
    {
        return OperationType::CLOSE_REGISTER;
    }

    public function handle(SyncContext $ctx, array $payload, string $payloadHash): OperationResult
    {
        $money = ['required', 'integer:strict', 'min:0', 'max:1000000000000'];
        $signed = ['required', 'integer:strict', 'between:-1000000000000,1000000000000'];
        $data = $this->validator->validate($payload, [
            'uuid' => ['required', 'uuid'],
            'session_uuid' => ['required', 'uuid'],
            'closed_by_uuid' => ['required', 'uuid'],
            'closed_at' => ['required', 'date'],
            'actual_cash' => $money,
            'expected_cash' => $signed,
            'cash_sales' => $money,
            'cash_refunds' => $money,
            'cash_adjustments' => $signed,
            'variance' => $signed,
            ...ApprovalRules::for('approval'),
        ]);
        if ((int) $data['variance'] !== (int) $data['actual_cash'] - (int) $data['expected_cash']) {
            throw new InvalidTotalsException('variance must equal actual_cash - expected_cash.');
        }

        $actor = $this->users->requireActive($data['closed_by_uuid'], $ctx->storeId(), 'closed_by_uuid');
        $auth = $this->approvals->authorize($actor, Permission::REGISTER_CLOSE, $data['approval'] ?? null)
            ?? throw new ForbiddenException('Closing a register requires register.close or a valid approval.');

        /** @var RegisterSession|null $session */
        $session = RegisterSession::query()->where('store_id', $ctx->storeId())->where('uuid', $data['session_uuid'])->lockForUpdate()->first();
        if ($session === null) {
            throw new RegisterSessionNotFoundException;
        }
        if ($session->status === 'CLOSED') {
            throw new RegisterAlreadyClosedException;
        }

        $serverCashSales = (int) Payment::query()
            ->join('sales', 'sales.id', '=', 'payments.sale_id')
            ->where('sales.store_id', $ctx->storeId())
            ->where('sales.register_session_uuid', $session->uuid)
            ->where('sales.status', '!=', Sale::STATUS_VOIDED)
            ->where('payments.method', 'CASH')
            ->sum('payments.amount');
        $serverExpected = $session->opening_cash + $serverCashSales - (int) $data['cash_refunds'] + (int) $data['cash_adjustments'];

        $conflicts = [];
        foreach (['cash_sales' => $serverCashSales, 'expected_cash' => $serverExpected] as $field => $serverValue) {
            if ((int) $data[$field] !== $serverValue) {
                $conflicts[] = new Conflict(ConflictType::REGISTER_TOTALS_MISMATCH, 'register_closure', $data['uuid'], (int) $data[$field],
                    $serverValue, "Client {$field} differs from the server calculation for this session.");
            }
        }

        $closedAt = CarbonImmutable::parse($data['closed_at'])->utc();
        $closure = RegisterClosure::create([
            'uuid' => $data['uuid'],
            'register_session_id' => $session->id,
            'store_id' => $ctx->storeId(),
            'closed_by' => $actor->id,
            'approved_by' => $auth->approver?->id,
            'closed_at' => $closedAt,
            'actual_cash' => (int) $data['actual_cash'],
            'client_expected_cash' => (int) $data['expected_cash'],
            'client_cash_sales' => (int) $data['cash_sales'],
            'client_cash_refunds' => (int) $data['cash_refunds'],
            'client_cash_adjustments' => (int) $data['cash_adjustments'],
            'client_variance' => (int) $data['variance'],
            'server_expected_cash' => $serverExpected,
            'server_cash_sales' => $serverCashSales,
            'server_variance' => (int) $data['actual_cash'] - $serverExpected,
            'status' => $conflicts === [] ? 'RECONCILED' : 'FLAGGED',
            'synced_by' => $ctx->user->id,
        ]);
        $session->status = 'CLOSED';
        $session->save();

        $this->conflictRecorder->record($ctx, 'register_closure', $closure->uuid, $conflicts);
        if ($conflicts !== []) {
            $this->audit->log('SYNC_FLAGGED', AuditLevel::WARNING, $ctx->storeId(), $ctx->user->id, $ctx->device->id,
                'register_session', $session->uuid, ['conflicts' => ['REGISTER_TOTALS_MISMATCH']], ip: $ctx->ip);
        }
        $this->audit->log('REGISTER_CLOSED', AuditLevel::AUDIT, $ctx->storeId(), $actor->id, $ctx->device->id, 'register_session', $session->uuid, [
            'closure_uuid' => $closure->uuid, 'actual_cash' => $closure->actual_cash, 'server_expected_cash' => $serverExpected,
            'server_variance' => $closure->server_variance, 'approved_by' => $auth->approver?->uuid,
        ], occurredAt: $closedAt, ip: $ctx->ip);

        return OperationResult::stored($closure->uuid, (int) $closure->id, $conflicts);
    }
}
