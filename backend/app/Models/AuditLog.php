<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Append-only audit trail. */
class AuditLog extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['uuid', 'action', 'level', 'source', 'user_id', 'device_id', 'store_id', 'entity_type', 'entity_uuid', 'metadata', 'ip_address', 'occurred_at'];

    protected function casts(): array
    {
        return ['metadata' => 'array', 'occurred_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Audit logs are append-only.'));
        static::deleting(fn () => throw new \LogicException('Audit logs are append-only.'));
    }

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<Device, $this> */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}
