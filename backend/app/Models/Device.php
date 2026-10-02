<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Device extends Model
{
    public const STATUS_ACTIVE = 'ACTIVE';

    public const STATUS_DISABLED = 'DISABLED';

    protected $fillable = ['uuid', 'store_id', 'code', 'name', 'type', 'status', 'registered_by', 'registered_at', 'last_sync_at'];

    protected function casts(): array
    {
        return ['registered_at' => 'datetime', 'last_sync_at' => 'datetime'];
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }

    /** @return BelongsTo<Store, $this> */
    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }
}
