<?php

declare(strict_types=1);

namespace App\Application\Sync;

use App\Domain\Sales\Conflict;
use App\Models\SyncConflict;
use Illuminate\Support\Str;

final class ConflictRecorder
{
    /** @param list<Conflict> $conflicts */
    public function record(SyncContext $ctx, string $referenceType, string $referenceUuid, array $conflicts): void
    {
        foreach ($conflicts as $c) {
            SyncConflict::create([
                'uuid' => (string) Str::uuid(),
                'store_id' => $ctx->storeId(),
                'device_id' => $ctx->device->id,
                'reference_type' => $referenceType,
                'reference_uuid' => $referenceUuid,
                'entity_type' => $c->entityType,
                'entity_uuid' => $c->entityUuid,
                'conflict_type' => $c->type->value,
                'message' => mb_substr($c->message, 0, 255),
                'local_payload' => ['value' => $c->localValue],
                'server_payload' => ['value' => $c->serverValue],
                'resolution_status' => 'OPEN',
            ]);
        }
    }
}
