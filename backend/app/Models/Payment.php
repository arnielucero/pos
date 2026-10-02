<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Payment extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['uuid', 'sale_id', 'method', 'amount', 'tendered', 'change_amount', 'reference'];

    protected function casts(): array
    {
        return ['amount' => 'integer', 'tendered' => 'integer', 'change_amount' => 'integer'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Payments are append-only.'));
    }
}
