<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductPrice extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['product_id', 'price', 'effective_from', 'effective_to', 'created_by'];

    protected function casts(): array
    {
        return ['price' => 'integer', 'effective_from' => 'datetime', 'effective_to' => 'datetime'];
    }
}
