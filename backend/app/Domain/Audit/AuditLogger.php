<?php

declare(strict_types=1);

namespace App\Domain\Audit;

use App\Models\AuditLog;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Str;

/** Server-side audit trail writer. Never put secrets (passwords, PINs, tokens) in metadata. */
final class AuditLogger
{
    /** @param array<string, mixed> $metadata */
    public function log(
        string $action,
        AuditLevel $level,
        ?int $storeId = null,
        ?int $userId = null,
        ?int $deviceId = null,
        ?string $entityType = null,
        ?string $entityUuid = null,
        array $metadata = [],
        ?DateTimeInterface $occurredAt = null,
        ?string $ip = null,
    ): AuditLog {
        return AuditLog::create([
            'uuid' => (string) Str::uuid(),
            'action' => $action,
            'level' => $level->value,
            'source' => 'SERVER',
            'store_id' => $storeId,
            'user_id' => $userId,
            'device_id' => $deviceId,
            'entity_type' => $entityType,
            'entity_uuid' => $entityUuid,
            'metadata' => $metadata === [] ? null : $metadata,
            'ip_address' => $ip,
            'occurred_at' => $occurredAt ?? CarbonImmutable::now(),
        ]);
    }
}
