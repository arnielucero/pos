<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

/** Append-only ledger row. */
class InventoryMovement extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['uuid', 'product_id', 'store_id', 'type', 'quantity', 'reference_type', 'reference_uuid', 'reason', 'user_id', 'device_id', 'approved_by', 'occurred_at'];

    protected function casts(): array
    {
        return ['quantity' => 'integer', 'occurred_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Inventory movements are append-only.'));
        static::deleting(fn () => throw new LogicException('Inventory movements are append-only.'));
    }
}
