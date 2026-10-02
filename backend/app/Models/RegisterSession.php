<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasOne;

class RegisterSession extends Model
{
    protected $fillable = ['uuid', 'store_id', 'device_id', 'opened_by', 'opened_at', 'opening_cash', 'status', 'synced_by'];

    protected function casts(): array
    {
        return ['opened_at' => 'datetime', 'opening_cash' => 'integer'];
    }

    /** @return HasOne<RegisterClosure, $this> */
    public function closure(): HasOne
    {
        return $this->hasOne(RegisterClosure::class);
    }
}
