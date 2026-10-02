<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\AuditLog;
use App\Support\Iso;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin AuditLog */
final class AuditLogResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var AuditLog $a */
        $a = $this->resource;

        return [
            'uuid' => $a->uuid,
            'action' => $a->action,
            'level' => $a->level,
            'source' => $a->source,
            'user' => $a->user === null ? null : ['uuid' => $a->user->uuid, 'name' => $a->user->name],
            'device_code' => $a->device?->code,
            'entity_type' => $a->entity_type,
            'entity_uuid' => $a->entity_uuid,
            'metadata' => $a->metadata,
            'occurred_at' => Iso::format($a->occurred_at),
            'created_at' => Iso::format($a->created_at),
        ];
    }
}
