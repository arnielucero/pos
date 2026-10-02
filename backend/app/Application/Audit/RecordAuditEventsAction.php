<?php

declare(strict_types=1);

namespace App\Application\Audit;

use App\Application\Shared\PayloadValidator;
use App\Application\Sync\IgnoresRejections;
use App\Application\Sync\OperationHandler;
use App\Application\Sync\SyncContext;
use App\Domain\Sync\OperationResult;
use App\Domain\Sync\OperationStatus;
use App\Domain\Sync\OperationType;
use App\Models\AuditLog;
use App\Models\User;
use Carbon\CarbonImmutable;

/** AUDIT_EVENTS: device-side audit trail upload, deduplicated by event uuid (INSERT IGNORE on the unique index). */
final class RecordAuditEventsAction implements OperationHandler
{
    use IgnoresRejections;

    public function __construct(private readonly PayloadValidator $validator) {}

    public function type(): OperationType
    {
        return OperationType::AUDIT_EVENTS;
    }

    public function handle(SyncContext $ctx, array $payload, string $payloadHash): OperationResult
    {
        $max = (int) config('pos.sync.max_audit_events');
        $data = $this->validator->validate($payload, [
            'events' => ['required', 'array', 'min:1', "max:$max"],
            'events.*' => ['required', 'array'],
            'events.*.uuid' => ['required', 'uuid'],
            'events.*.action' => ['required', 'string', 'max:64', 'regex:/^[A-Z0-9_]+$/'],
            'events.*.level' => ['nullable', 'in:INFO,WARNING,SECURITY,AUDIT'],
            'events.*.user_uuid' => ['nullable', 'uuid'],
            'events.*.entity_type' => ['nullable', 'string', 'max:32'],
            'events.*.entity_uuid' => ['nullable', 'uuid'],
            'events.*.metadata' => ['nullable', 'array'],
            'events.*.occurred_at' => ['required', 'date'],
        ]);

        $userIds = User::query()->where('store_id', $ctx->storeId())
            ->whereIn('uuid', array_filter(array_column($data['events'], 'user_uuid')))
            ->pluck('id', 'uuid');

        $now = CarbonImmutable::now();
        $rows = [];
        foreach ($data['events'] as $e) {
            $userUuid = $e['user_uuid'] ?? null;
            $metadata = (array) ($e['metadata'] ?? []);
            if ($userUuid !== null && ! isset($userIds[$userUuid])) {
                $metadata['unknown_user_uuid'] = $userUuid;
            }
            $rows[] = [
                'uuid' => $e['uuid'],
                'action' => $e['action'],
                'level' => $e['level'] ?? 'INFO',
                'source' => 'DEVICE',
                'user_id' => $userUuid !== null ? ($userIds[$userUuid] ?? null) : null,
                'device_id' => $ctx->device->id,
                'store_id' => $ctx->storeId(),
                'entity_type' => $e['entity_type'] ?? null,
                'entity_uuid' => $e['entity_uuid'] ?? null,
                'metadata' => $metadata === [] ? null : json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'ip_address' => $ctx->ip,
                'occurred_at' => CarbonImmutable::parse($e['occurred_at'])->utc(),
                'created_at' => $now,
            ];
        }
        foreach (array_chunk($rows, 100) as $chunk) {
            AuditLog::query()->insertOrIgnore($chunk);
        }

        return new OperationResult(OperationStatus::APPLIED, 201, entityUuid: null);
    }
}
