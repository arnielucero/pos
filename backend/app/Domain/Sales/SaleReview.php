<?php

declare(strict_types=1);

namespace App\Domain\Sales;

/** Outcome of the business-rule checks (steps 5-7) for a sale that passed schema and arithmetic checks. */
final readonly class SaleReview
{
    /**
     * @param  list<Conflict>  $conflicts
     * @param  list<array{permission: string, approver_id: int, approver_uuid: string, mode: string|null, entity_uuid: string}>  $approvalsUsed
     * @param  array<string, int|null>  $serverPrices  item uuid => server price at created_at
     */
    public function __construct(public array $conflicts, public array $approvalsUsed, public array $serverPrices) {}
}
