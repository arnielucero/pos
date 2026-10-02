<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SaleVoid extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['uuid', 'sale_id', 'store_id', 'voided_by', 'approved_by', 'approval', 'reason', 'voided_at', 'device_id', 'synced_by'];

    protected function casts(): array
    {
        return ['approval' => 'array', 'voided_at' => 'datetime'];
    }

    /** @return BelongsTo<User, $this> */
    public function voidedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'voided_by');
    }
}
