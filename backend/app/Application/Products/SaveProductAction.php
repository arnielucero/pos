<?php

declare(strict_types=1);

namespace App\Application\Products;

use App\Domain\Audit\AuditLevel;
use App\Domain\Audit\AuditLogger;
use App\Domain\Inventory\InventoryLedger;
use App\Domain\Inventory\MovementType;
use App\Models\InventoryBalance;
use App\Models\Product;
use App\Models\ProductPrice;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Create / update products. A price change closes the current product_prices row and opens a new one. */
final class SaveProductAction
{
    public function __construct(private readonly InventoryLedger $ledger, private readonly AuditLogger $audit) {}

    /** @param array<string, mixed> $data */
    public function create(User $actor, array $data, ?int $deviceId, ?string $ip): Product
    {
        $product = DB::transaction(function () use ($actor, $data, $deviceId) {
            $now = CarbonImmutable::now();
            $product = Product::create([
                'uuid' => $data['uuid'] ?? (string) Str::uuid(),
                'store_id' => $actor->store_id,
                'sku' => $data['sku'],
                'barcode' => $data['barcode'] ?? null,
                'name' => $data['name'],
                'category' => $data['category'] ?? null,
                'is_active' => $data['is_active'] ?? true,
                'track_stock' => $data['track_stock'] ?? true,
            ]);
            ProductPrice::create(['product_id' => $product->id, 'price' => (int) $data['price'], 'effective_from' => $now, 'created_by' => $actor->id]);
            InventoryBalance::query()->insertOrIgnore(['product_id' => $product->id, 'store_id' => $actor->store_id, 'quantity_on_hand' => 0, 'updated_at' => $now]);

            if (($initial = (int) ($data['initial_stock'] ?? 0)) > 0) {
                $this->ledger->record((int) $actor->store_id, $product->id, MovementType::STOCK_IN, $initial, 'product', $product->uuid,
                    $actor->id, $deviceId, reason: 'Initial stock');
            }

            return $product;
        });

        $this->audit->log('PRODUCT_CREATED', AuditLevel::AUDIT, $actor->store_id, $actor->id, $deviceId, 'product', $product->uuid,
            ['sku' => $product->sku, 'price' => (int) $data['price']], ip: $ip);

        return $product->load('currentPrice', 'balance');
    }

    /** @param array<string, mixed> $data */
    public function update(User $actor, Product $product, array $data, ?int $deviceId, ?string $ip): Product
    {
        $changes = DB::transaction(function () use ($actor, $product, $data) {
            $product->fill(array_intersect_key($data, array_flip(['sku', 'barcode', 'name', 'category', 'is_active', 'track_stock'])));
            $changes = $product->getDirty();

            if (array_key_exists('price', $data)) {
                $current = ProductPrice::query()->where('product_id', $product->id)->whereNull('effective_to')->lockForUpdate()->first();
                if ($current === null || $current->price !== (int) $data['price']) {
                    $now = CarbonImmutable::now();
                    $current?->forceFill(['effective_to' => $now])->save();
                    ProductPrice::create(['product_id' => $product->id, 'price' => (int) $data['price'], 'effective_from' => $now, 'created_by' => $actor->id]);
                    $changes['price'] = ['from' => $current?->price, 'to' => (int) $data['price']];
                }
            }

            $product->updated_at = CarbonImmutable::now(); // always bump so /sync/pull picks it up
            $product->save();

            return $changes;
        });

        $this->audit->log('PRODUCT_UPDATED', AuditLevel::AUDIT, $actor->store_id, $actor->id, $deviceId, 'product', $product->uuid,
            ['changes' => $changes], ip: $ip);

        return $product->refresh()->load('currentPrice', 'balance');
    }

    public function delete(User $actor, Product $product, ?int $deviceId, ?string $ip): void
    {
        $product->delete();
        $this->audit->log('PRODUCT_DELETED', AuditLevel::AUDIT, $actor->store_id, $actor->id, $deviceId, 'product', $product->uuid,
            ['sku' => $product->sku], ip: $ip);
    }
}
