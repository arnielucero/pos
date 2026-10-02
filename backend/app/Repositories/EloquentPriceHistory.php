<?php

declare(strict_types=1);

namespace App\Repositories;

use App\Domain\Catalog\PriceHistory;
use App\Models\ProductPrice;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;

final class EloquentPriceHistory implements PriceHistory
{
    public function wasEffectiveBetween(int $productId, int $price, DateTimeInterface $from, DateTimeInterface $to): bool
    {
        // Window [effective_from, effective_to) overlaps [from, to].
        return ProductPrice::query()
            ->where('product_id', $productId)
            ->where('price', $price)
            ->where('effective_from', '<=', $to)
            ->where(fn (Builder $q) => $q->whereNull('effective_to')->orWhere('effective_to', '>', $from))
            ->exists();
    }

    public function priceAt(int $productId, DateTimeInterface $at): ?int
    {
        $row = ProductPrice::query()
            ->where('product_id', $productId)
            ->where('effective_from', '<=', $at)
            ->where(fn (Builder $q) => $q->whereNull('effective_to')->orWhere('effective_to', '>', $at))
            ->orderByDesc('effective_from')
            ->first();

        return $row?->price;
    }
}
