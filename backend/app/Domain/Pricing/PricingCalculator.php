<?php

declare(strict_types=1);

namespace App\Domain\Pricing;

/**
 * The pricing algorithm from docs/API.md. Must stay byte-for-byte equivalent to
 * app/src/domain/services/PricingCalculator.ts; both are tested against docs/pricing-vectors.json.
 * Pure integer arithmetic on centavos and basis points - no floats anywhere.
 */
final class PricingCalculator
{
    /** @param list<LineInput> $lines */
    public function calculate(array $lines, ?Discount $orderDiscount, int $taxRateBp): PricingResult
    {
        $results = [];
        $subtotal = 0;
        $linesNet = 0;
        $lineDiscounts = 0;

        foreach ($lines as $line) {
            $gross = $line->unitPrice * $line->quantity;
            $discount = $line->discount?->amountFor($gross) ?? 0;
            $total = $gross - $discount;

            $results[] = new LineResult($gross, $discount, $total);
            $subtotal += $gross;
            $linesNet += $total;
            $lineDiscounts += $discount;
        }

        $order = $orderDiscount?->amountFor($linesNet) ?? 0;
        $total = $linesNet - $order;

        return new PricingResult(
            lines: $results,
            subtotal: $subtotal,
            linesNet: $linesNet,
            orderDiscount: $order,
            discountTotal: $lineDiscounts + $order,
            total: $total,
            taxTotal: $this->vatIncluded($total, $taxRateBp),
        );
    }

    /** VAT portion of a VAT-inclusive amount. */
    public function vatIncluded(int $total, int $taxRateBp): int
    {
        if ($taxRateBp <= 0 || $total <= 0) {
            return 0;
        }

        return self::roundHalfUp($total * $taxRateBp, 10000 + $taxRateBp);
    }

    /** round(numerator / denominator), .5 away from zero, for non-negative integers. */
    public static function roundHalfUp(int $numerator, int $denominator): int
    {
        return intdiv(2 * $numerator + $denominator, 2 * $denominator);
    }
}
