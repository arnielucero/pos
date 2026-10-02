<?php

declare(strict_types=1);

namespace App\Domain\Pricing;

enum DiscountType: string
{
    case PERCENT = 'PERCENT';
    case AMOUNT = 'AMOUNT';
}
