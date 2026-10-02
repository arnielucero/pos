<?php

declare(strict_types=1);

namespace App\Domain\Pricing;

final readonly class LineResult
{
    public function __construct(public int $lineGross, public int $lineDiscount, public int $lineTotal) {}
}
