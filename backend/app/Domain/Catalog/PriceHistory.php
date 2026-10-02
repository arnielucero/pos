<?php

declare(strict_types=1);

namespace App\Domain\Catalog;

use DateTimeInterface;

interface PriceHistory
{
    /** True if $price was the effective price of the product at any instant within [$from, $to]. */
    public function wasEffectiveBetween(int $productId, int $price, DateTimeInterface $from, DateTimeInterface $to): bool;

    /** Price effective at $at, or null if the product had no price then. */
    public function priceAt(int $productId, DateTimeInterface $at): ?int;
}
