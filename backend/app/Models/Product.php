<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Product extends Model
{
    use SoftDeletes;

    protected $fillable = ['uuid', 'store_id', 'sku', 'barcode', 'name', 'category', 'is_active', 'track_stock'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'track_stock' => 'boolean'];
    }

    /** @return HasMany<ProductPrice, $this> */
    public function prices(): HasMany
    {
        return $this->hasMany(ProductPrice::class);
    }

    /** @return HasOne<ProductPrice, $this> */
    public function currentPrice(): HasOne
    {
        return $this->hasOne(ProductPrice::class)->whereNull('effective_to')->latestOfMany('effective_from');
    }

    /** @return HasOne<InventoryBalance, $this> */
    public function balance(): HasOne
    {
        return $this->hasOne(InventoryBalance::class);
    }
}
