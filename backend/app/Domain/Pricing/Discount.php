<?php

declare(strict_types=1);

namespace App\Domain\Pricing;

use InvalidArgumentException;

final readonly class Discount
{
    public function __construct(public DiscountType $type, public int $value)
    {
        if ($value < 0) {
            throw new InvalidArgumentException('Discount value must be >= 0.');
        }
        if ($type === DiscountType::PERCENT && $value > 10000) {
            throw new InvalidArgumentException('Percent discount must be <= 10000 bp.');
        }
    }

    /** @param array{type: string, value: int}|null $data */
    public static function fromArray(?array $data): ?self
    {
        if ($data === null) {
            return null;
        }

        return new self(DiscountType::from((string) $data['type']), (int) $data['value']);
    }

    /** Discount amount for a base, capped at the base (docs/API.md pricing steps 2 and 6). */
    public function amountFor(int $base): int
    {
        $amount = match ($this->type) {
            DiscountType::PERCENT => PricingCalculator::roundHalfUp($base * $this->value, 10000),
            DiscountType::AMOUNT => $this->value,
        };

        return min($amount, $base);
    }
}
