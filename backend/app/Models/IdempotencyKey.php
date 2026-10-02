<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class IdempotencyKey extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['store_id', 'key', 'operation_type', 'payload_hash', 'entity_uuid', 'result', 'device_id', 'user_id'];

    protected function casts(): array
    {
        return ['result' => 'array'];
    }
}
