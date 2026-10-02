<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Domain\Sync\OperationResult;
use App\Domain\Sync\OperationType;
use App\Models\IdempotencyKey;

class IdempotencyKeyRepository
{
    public function find(int $storeId, string $key): ?IdempotencyKey
    {
        return IdempotencyKey::query()->where('store_id', $storeId)->where('key', $key)->first();
    }

    /** Insert; the UNIQUE(store_id, key) index is the real guard against concurrent duplicates. */
    public function save(int $storeId, string $key, OperationType $type, string $hash, OperationResult $result, ?int $deviceId, ?int $userId): void
    {
        $stored = $result->toArray();
        unset($stored['idempotency_key']);

        IdempotencyKey::create([
            'store_id' => $storeId,
            'key' => $key,
            'operation_type' => $type->value,
            'payload_hash' => $hash,
            'entity_uuid' => $result->entityUuid,
            'result' => $stored,
            'device_id' => $deviceId,
            'user_id' => $userId,
        ]);
    }
}
