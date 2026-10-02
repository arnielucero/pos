<?php

declare(strict_types=1);

namespace App\Domain\Sales;

use App\Domain\Approval\ApprovalVerifier;
use App\Domain\Approval\AuthorizationOutcome;
use App\Domain\Auth\Permission;
use App\Domain\Catalog\PriceHistory;
use App\Domain\Pricing\Discount;
use App\Domain\Pricing\LineInput;
use App\Domain\Pricing\PricingCalculator;
use App\Domain\Pricing\PricingResult;
use App\Domain\Sales\Exceptions\InvalidTotalsException;
use App\Models\Product;
use App\Models\User;
use Carbon\CarbonImmutable;

/**
 * Validation steps 4-7 of CREATE_SALE (docs/API.md). Step 4 (arithmetic) is fatal and throws;
 * steps 5-7 produce typed conflicts (the sale is still stored, as FLAGGED).
 */
final class SaleValidator
{
    public function __construct(
        private readonly PricingCalculator $calculator,
        private readonly PriceHistory $prices,
        private readonly ApprovalVerifier $approvals,
    ) {}

    /**
     * Step 4: recompute every line and the totals; verify payments.
     *
     * @param  array<string, mixed>  $sale  schema-valid payload
     *
     * @throws InvalidTotalsException
     */
    public function assertArithmetic(array $sale): PricingResult
    {
        $lines = array_map(
            fn (array $i) => new LineInput((int) $i['unit_price'], (int) $i['quantity'], Discount::fromArray($i['discount'] ?? null)),
            $sale['items'],
        );
        // Tax is checked separately (it depends on a store setting that may have changed while offline).
        $result = $this->calculator->calculate($lines, Discount::fromArray($sale['order_discount'] ?? null), 0);

        $mismatches = [];
        foreach ($sale['items'] as $idx => $item) {
            $line = $result->lines[$idx];
            foreach (['line_gross' => $line->lineGross, 'line_discount' => $line->lineDiscount, 'line_total' => $line->lineTotal] as $field => $expected) {
                if ((int) $item[$field] !== $expected) {
                    $mismatches[] = ['field' => "items.$idx.$field", 'client' => (int) $item[$field], 'server' => $expected];
                }
            }
        }
        foreach (['subtotal' => $result->subtotal, 'discount_total' => $result->discountTotal, 'total' => $result->total] as $field => $expected) {
            if ((int) $sale[$field] !== $expected) {
                $mismatches[] = ['field' => $field, 'client' => (int) $sale[$field], 'server' => $expected];
            }
        }
        if ((int) $sale['tax_total'] > $result->total) {
            $mismatches[] = ['field' => 'tax_total', 'client' => (int) $sale['tax_total'], 'server' => '<= total'];
        }

        $mismatches = [...$mismatches, ...$this->paymentMismatches($sale['payments'], $result->total)];

        if ($mismatches !== []) {
            throw new InvalidTotalsException('Sale totals do not match the server calculation.', ['mismatches' => $mismatches]);
        }

        return $result;
    }

    /**
     * Steps 5-7 plus the informational tax check.
     *
     * @param  array<string, mixed>  $sale
     * @param  array<string, Product>  $products  keyed by uuid (includes trashed)
     */
    public function review(
        array $sale,
        PricingResult $pricing,
        array $products,
        User $cashier,
        int $taxRateBp,
        int $maxDiscountBp,
        CarbonImmutable $createdAt,
        ?CarbonImmutable $catalogSyncedAt,
    ): SaleReview {
        $conflicts = [];
        $approvalsUsed = [];
        $serverPrices = [];
        $windowStart = $catalogSyncedAt !== null && $catalogSyncedAt->lessThan($createdAt) ? $catalogSyncedAt : $createdAt;

        foreach ($sale['items'] as $idx => $item) {
            $product = $products[$item['product_uuid']];
            $unitPrice = (int) $item['unit_price'];
            $serverPrice = $this->prices->priceAt($product->id, $createdAt);
            $serverPrices[$item['uuid']] = $serverPrice;

            // Step 5: price effective at some instant in [catalog_synced_at, created_at].
            if (! $this->prices->wasEffectiveBetween($product->id, $unitPrice, $windowStart, $createdAt)) {
                $override = $item['price_override'] ?? null;
                $auth = $override !== null
                    ? $this->approvals->authorize($cashier, Permission::PRICE_OVERRIDE, $override['approval'] ?? null)
                    : null;
                if ($auth === null) {
                    $conflicts[] = new Conflict(ConflictType::PRICE_MISMATCH, 'sale_item', $item['uuid'], $unitPrice, $serverPrice,
                        "Price {$unitPrice} for {$product->sku} was not effective between catalog sync and sale time.");
                } elseif ($auth->usedApproval()) {
                    $approvalsUsed[] = $this->approvalRecord($auth, Permission::PRICE_OVERRIDE, $item['uuid']);
                }
            }

            // Step 6: line discount.
            $line = $pricing->lines[$idx];
            if ($line->lineDiscount > 0) {
                $conflict = $this->checkDiscount($cashier, $item['discount']['approval'] ?? null, $line->lineDiscount,
                    $line->lineGross, $maxDiscountBp, 'sale_item', $item['uuid'], $approvalsUsed);
                if ($conflict !== null) {
                    $conflicts[] = $conflict;
                }
            }

            // Step 7: product inactive/deleted at sale time.
            $deletedBefore = $product->deleted_at !== null && $product->deleted_at->lessThanOrEqualTo($createdAt);
            if (! $product->is_active || $deletedBefore) {
                $conflicts[] = new Conflict(ConflictType::PRODUCT_INACTIVE, 'sale_item', $item['uuid'], true, false,
                    "Product {$product->sku} is inactive or deleted.");
            }
        }

        // Step 6: order discount.
        if ($pricing->orderDiscount > 0) {
            $conflict = $this->checkDiscount($cashier, $sale['order_discount']['approval'] ?? null, $pricing->orderDiscount,
                $pricing->linesNet, $maxDiscountBp, 'sale', $sale['uuid'], $approvalsUsed);
            if ($conflict !== null) {
                $conflicts[] = $conflict;
            }
        }

        $serverTax = $this->calculator->vatIncluded($pricing->total, $taxRateBp);
        if ((int) $sale['tax_total'] !== $serverTax) {
            $conflicts[] = new Conflict(ConflictType::TAX_MISMATCH, 'sale', $sale['uuid'], (int) $sale['tax_total'], $serverTax,
                'Tax total differs from the current store tax rate.');
        }

        return new SaleReview($conflicts, $approvalsUsed, $serverPrices);
    }

    /** @param list<array<string, mixed>> $approvalsUsed */
    private function checkDiscount(User $cashier, ?array $approval, int $amount, int $base, int $maxBp, string $entityType, string $entityUuid, array &$approvalsUsed): ?Conflict
    {
        $auth = $this->approvals->authorize($cashier, Permission::DISCOUNT_APPLY, $approval);
        $maxAllowed = intdiv($base * $maxBp, 10000);

        if ($auth === null) {
            return new Conflict(ConflictType::DISCOUNT_UNAUTHORIZED, $entityType, $entityUuid, $amount, 0,
                'Discount applied without discount.apply permission or a valid approval.');
        }
        if ($amount * 10000 > $base * $maxBp) {
            return new Conflict(ConflictType::DISCOUNT_UNAUTHORIZED, $entityType, $entityUuid, $amount, $maxAllowed,
                "Discount exceeds the store maximum of {$maxBp} bp.");
        }
        if ($auth->usedApproval()) {
            $approvalsUsed[] = $this->approvalRecord($auth, Permission::DISCOUNT_APPLY, $entityUuid);
        }

        return null;
    }

    /** @return array{permission: string, approver_id: int, approver_uuid: string, mode: string|null, entity_uuid: string} */
    private function approvalRecord(AuthorizationOutcome $auth, string $permission, string $entityUuid): array
    {
        return [
            'permission' => $permission,
            'approver_id' => (int) $auth->approver?->id,
            'approver_uuid' => (string) $auth->approver?->uuid,
            'mode' => $auth->mode(),
            'entity_uuid' => $entityUuid,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $payments
     * @return list<array<string, mixed>>
     */
    private function paymentMismatches(array $payments, int $total): array
    {
        $mismatches = [];
        $sum = 0;
        $cashCount = 0;

        foreach ($payments as $idx => $p) {
            $amount = (int) $p['amount'];
            $tendered = (int) $p['tendered'];
            $change = (int) $p['change'];
            $sum += $amount;

            if ($p['method'] === 'CASH') {
                $cashCount++;
                if ($tendered < $amount || $change !== $tendered - $amount) {
                    $mismatches[] = ['field' => "payments.$idx.change", 'client' => $change, 'server' => $tendered - $amount];
                }
            } elseif ($tendered !== $amount || $change !== 0) {
                $mismatches[] = ['field' => "payments.$idx.tendered", 'client' => $tendered, 'server' => $amount];
            }
        }

        if ($cashCount > 1) {
            $mismatches[] = ['field' => 'payments', 'client' => $cashCount, 'server' => 'at most one CASH payment'];
        }
        if ($sum !== $total) {
            $mismatches[] = ['field' => 'payments.amount', 'client' => $sum, 'server' => $total];
        }

        return $mismatches;
    }
}
