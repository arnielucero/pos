<?php

declare(strict_types=1);

namespace App\Domain\Pricing;

use InvalidArgumentException;

final readonly class LineInput
{
    public function __construct(public int $unitPrice, public int $quantity, public ?Discount $discount = null)
    {
        if ($unitPrice < 0 || $quantity < 1) {
            throw new InvalidArgumentException('unit_price must be >= 0 and quantity >= 1.');
        }
    }
}
