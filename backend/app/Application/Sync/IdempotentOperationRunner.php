<?php

declare(strict_types=1);

namespace App\Application\Sync;

use App\Domain\Audit\AuditLevel;
use App\Domain\Audit\AuditLogger;
use App\Domain\Shared\Exceptions\ConflictException;
use App\Domain\Shared\Exceptions\DomainException;
use App\Domain\Shared\Exceptions\ValidationFailedException;
use App\Domain\Sync\Exceptions\IdempotencyKeyReusedException;
use App\Domain\Sync\OperationResult;
use App\Domain\Sync\OperationType;
use App\Domain\Sync\PayloadHasher;
use App\Models\IdempotencyKey;
use App\Repositories\IdempotencyKeyRepository;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Applies one operation exactly once per (store, idempotency key):
 *  - known key + same payload hash  -> DUPLICATE (original result)
 *  - known key + other payload hash -> REJECTED IDEMPOTENCY_KEY_REUSED
 *  - otherwise the handler runs in ONE transaction together with the idempotency row insert.
 * Concurrent identical requests are resolved by the UNIQUE indexes: the loser catches the
 * integrity violation, re-reads the winner's idempotency row and returns DUPLICATE.
 */
final class IdempotentOperationRunner
{
    public function __construct(
        private readonly PayloadHasher $hasher,
        private readonly IdempotencyKeyRepository $keys,
        private readonly AuditLogger $audit,
    ) {}

    /** @param array<string, mixed> $payload */
    public function run(SyncContext $ctx, OperationType $type, string $key, array $payload, OperationHandler $handler): OperationResult
    {
        $hash = $this->hasher->hash($type, $payload);

        $existing = $this->keys->find($ctx->storeId(), $key);
        if ($existing !== null) {
            return $this->replay($existing, $hash);
        }

        try {
            if ($type->keyIsPayloadUuid() && ($payload['uuid'] ?? null) !== $key) {
                throw new ValidationFailedException('idempotency_key must equal payload.uuid.', ['idempotency_key' => ['Must equal payload.uuid.']]);
            }

            return DB::transaction(function () use ($ctx, $type, $key, $payload, $hash, $handler): OperationResult {
                $result = $handler->handle($ctx, $payload, $hash);
                $this->keys->save($ctx->storeId(), $key, $type, $hash, $result, $ctx->device->id, $ctx->user->id);

                return $result;
            }, 3);
        } catch (UniqueConstraintViolationException $e) {
            $winner = $this->keys->find($ctx->storeId(), $key);
            if ($winner !== null) {
                return $this->replay($winner, $hash);
            }
            report($e);

            return OperationResult::rejected(new ConflictException('A conflicting record was written concurrently; retry.'));
        } catch (DomainException $e) {
            $this->onRejected($ctx, $type, $key, $payload, $handler, $e);

            return OperationResult::rejected($e);
        } catch (Throwable $e) {
            report($e);

            return OperationResult::serverError();
        }
    }

    private function replay(IdempotencyKey $existing, string $hash): OperationResult
    {
        return hash_equals($existing->payload_hash, $hash)
            ? OperationResult::duplicateOf($existing->result)
            : OperationResult::rejected(new IdempotencyKeyReusedException);
    }

    /** @param array<string, mixed> $payload */
    private function onRejected(SyncContext $ctx, OperationType $type, string $key, array $payload, OperationHandler $handler, DomainException $e): void
    {
        try {
            $handler->afterRejected($ctx, $payload, $e);
            if (! $e->retryable()) {
                $this->audit->log('SYNC_OP_REJECTED', AuditLevel::WARNING, $ctx->storeId(), $ctx->user->id, $ctx->device->id,
                    'sync_operation', $key, ['type' => $type->value, 'code' => $e->errorCode()], ip: $ctx->ip);
            }
        } catch (Throwable $auditError) {
            report($auditError);
        }
    }
}
