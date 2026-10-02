<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class InventoryBalance extends Model
{
    public const CREATED_AT = null;

    protected $fillable = ['product_id', 'store_id', 'quantity_on_hand'];

    protected function casts(): array
    {
        return ['quantity_on_hand' => 'integer'];
    }
}
