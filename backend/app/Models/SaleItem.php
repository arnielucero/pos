<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SaleItem extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'uuid', 'sale_id', 'product_id', 'product_name', 'sku', 'quantity', 'unit_price', 'server_unit_price',
        'discount_type', 'discount_value', 'discount_approval', 'price_override', 'line_gross', 'line_discount', 'line_total',
    ];

    protected function casts(): array
    {
        return [
            'quantity' => 'integer', 'unit_price' => 'integer', 'server_unit_price' => 'integer',
            'discount_value' => 'integer', 'line_gross' => 'integer', 'line_discount' => 'integer', 'line_total' => 'integer',
            'discount_approval' => 'array', 'price_override' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new \LogicException('Sale items are append-only.'));
    }

    /** @return BelongsTo<Product, $this> */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }
}
