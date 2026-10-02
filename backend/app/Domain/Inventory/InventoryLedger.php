<?php

declare(strict_types=1);

namespace App\Domain\Inventory;

use App\Models\InventoryBalance;
use App\Models\InventoryMovement;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;
use LogicException;

/**
 * Append-only stock ledger. Every change inserts an inventory_movements row and updates the
 * cached inventory_balances row (row-locked) in the caller's transaction.
 */
final class InventoryLedger
{
    public function record(
        int $storeId,
        int $productId,
        MovementType $type,
        int $quantity,
        ?string $referenceType = null,
        ?string $referenceUuid = null,
        ?int $userId = null,
        ?int $deviceId = null,
        ?string $uuid = null,
        ?string $reason = null,
        ?int $approvedBy = null,
        ?DateTimeInterface $occurredAt = null,
    ): LedgerEntry {
        if ($quantity === 0) {
            throw new InvalidArgumentException('Movement quantity must be non-zero.');
        }
        if (DB::transactionLevel() === 0) {
            throw new LogicException('InventoryLedger::record must run inside a transaction.');
        }

        $movement = InventoryMovement::create([
            'uuid' => $uuid ?? (string) Str::uuid(),
            'product_id' => $productId,
            'store_id' => $storeId,
            'type' => $type->value,
            'quantity' => $quantity,
            'reference_type' => $referenceType,
            'reference_uuid' => $referenceUuid,
            'reason' => $reason,
            'user_id' => $userId,
            'device_id' => $deviceId,
            'approved_by' => $approvedBy,
            'occurred_at' => $occurredAt,
        ]);

        $now = CarbonImmutable::now();
        InventoryBalance::query()->insertOrIgnore([
            'product_id' => $productId, 'store_id' => $storeId, 'quantity_on_hand' => 0, 'updated_at' => $now,
        ]);

        /** @var InventoryBalance $balance */
        $balance = InventoryBalance::query()
            ->where('product_id', $productId)
            ->where('store_id', $storeId)
            ->lockForUpdate()
            ->firstOrFail();

        $balance->quantity_on_hand += $quantity;
        $balance->updated_at = $now;
        $balance->save();

        return new LedgerEntry((int) $movement->id, $balance->quantity_on_hand);
    }
}
