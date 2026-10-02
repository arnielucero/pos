<?php

declare(strict_types=1);

namespace App\Domain\Pricing;

final readonly class PricingResult
{
    /** @param list<LineResult> $lines */
    public function __construct(
        public array $lines,
        public int $subtotal,
        public int $linesNet,
        public int $orderDiscount,
        public int $discountTotal,
        public int $total,
        public int $taxTotal,
    ) {}
}
