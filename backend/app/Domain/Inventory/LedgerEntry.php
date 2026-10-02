<?php

declare(strict_types=1);

namespace App\Domain\Inventory;

final readonly class LedgerEntry
{
    public function __construct(public int $movementId, public int $balanceAfter) {}
}
