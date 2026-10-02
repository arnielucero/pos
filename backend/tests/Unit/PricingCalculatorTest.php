<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Domain\Pricing\Discount;
use App\Domain\Pricing\LineInput;
use App\Domain\Pricing\PricingCalculator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Asserts every shared vector in docs/pricing-vectors.json (also run by the app's vitest suite). */
final class PricingCalculatorTest extends TestCase
{
    /** @return iterable<string, array{0: array<string, mixed>}> */
    public static function vectors(): iterable
    {
        $path = dirname(__DIR__, 3).'/docs/pricing-vectors.json';
        self::assertFileExists($path);
        $data = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);

        foreach ($data['vectors'] as $vector) {
            yield $vector['name'] => [$vector];
        }
    }

    #[DataProvider('vectors')]
    public function test_vector(array $vector): void
    {
        $lines = array_map(fn (array $i) => new LineInput($i['unit_price'], $i['quantity'], Discount::fromArray($i['discount'])), $vector['items']);
        $result = (new PricingCalculator)->calculate($lines, Discount::fromArray($vector['order_discount']), $vector['tax_rate_bp']);
        $expected = $vector['expected'];

        $this->assertSame($expected['lines'], array_map(fn ($l) => [
            'line_gross' => $l->lineGross, 'line_discount' => $l->lineDiscount, 'line_total' => $l->lineTotal,
        ], $result->lines));
        $this->assertSame($expected['subtotal'], $result->subtotal);
        $this->assertSame($expected['order_discount'], $result->orderDiscount);
        $this->assertSame($expected['discount_total'], $result->discountTotal);
        $this->assertSame($expected['total'], $result->total);
        $this->assertSame($expected['tax_total'], $result->taxTotal);
    }

    public function test_vector_file_is_not_empty(): void
    {
        $this->assertGreaterThanOrEqual(10, iterator_count(self::vectors()));
    }

    public function test_round_half_up(): void
    {
        $this->assertSame(3, PricingCalculator::roundHalfUp(5, 2));
        $this->assertSame(2, PricingCalculator::roundHalfUp(7, 4));
        $this->assertSame(0, PricingCalculator::roundHalfUp(0, 7));
    }

    public function test_rejects_percent_over_100(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        Discount::fromArray(['type' => 'PERCENT', 'value' => 10001]);
    }
}
