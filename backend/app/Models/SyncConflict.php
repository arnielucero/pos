<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SyncConflict extends Model
{
    protected $fillable = [
        'uuid', 'store_id', 'device_id', 'reference_type', 'reference_uuid', 'entity_type', 'entity_uuid',
        'conflict_type', 'message', 'local_payload', 'server_payload', 'resolution_status', 'resolved_by', 'resolved_at',
    ];

    protected function casts(): array
    {
        return ['local_payload' => 'array', 'server_payload' => 'array', 'resolved_at' => 'datetime'];
    }
}
