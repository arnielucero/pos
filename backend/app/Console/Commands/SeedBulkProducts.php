<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\Store;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Performance-test data: N products with a price and a stock balance. Dev only. */
final class SeedBulkProducts extends Command
{
    protected $signature = 'pos:seed-bulk-products {count=50000} {--store=STORE-001}';

    protected $description = 'Insert many synthetic products (with price + stock) for performance testing';

    public function handle(): int
    {
        if (app()->isProduction()) {
            $this->error('Refusing to run in production.');

            return self::FAILURE;
        }

        $store = Store::query()->where('code', $this->option('store'))->first();
        if ($store === null) {
            $this->error('Store not found. Run php artisan db:seed first.');

            return self::FAILURE;
        }

        $count = max(1, (int) $this->argument('count'));
        $now = CarbonImmutable::now();
        $runId = strtoupper(Str::random(4));
        $bar = $this->output->createProgressBar($count);

        for ($offset = 0; $offset < $count; $offset += 1000) {
            $n = min(1000, $count - $offset);
            DB::transaction(function () use ($n, $offset, $store, $now, $runId): void {
                $rows = [];
                for ($i = 0; $i < $n; $i++) {
                    $seq = $offset + $i + 1;
                    $rows[] = [
                        'uuid' => (string) Str::uuid(), 'store_id' => $store->id, 'sku' => sprintf('BULK-%s-%06d', $runId, $seq),
                        'barcode' => sprintf('49%011d', $seq), 'name' => "Bulk Item {$runId} {$seq}", 'category' => 'Bulk '.($seq % 20),
                        'is_active' => true, 'track_stock' => true, 'created_at' => $now, 'updated_at' => $now,
                    ];
                }
                DB::table('products')->insert($rows);
                $ids = DB::table('products')->whereIn('uuid', array_column($rows, 'uuid'))->pluck('id');

                DB::table('product_prices')->insert($ids->map(fn ($id) => [
                    'product_id' => $id, 'price' => 1000 + ($id % 500) * 100, 'effective_from' => $now->subDay(), 'created_at' => $now,
                ])->all());
                DB::table('inventory_balances')->insert($ids->map(fn ($id) => [
                    'product_id' => $id, 'store_id' => $store->id, 'quantity_on_hand' => 100, 'updated_at' => $now,
                ])->all());
                DB::table('inventory_movements')->insert($ids->map(fn ($id) => [
                    'uuid' => (string) Str::uuid(), 'product_id' => $id, 'store_id' => $store->id, 'type' => 'STOCK_IN',
                    'quantity' => 100, 'reference_type' => 'seed', 'reason' => 'Bulk seed', 'created_at' => $now,
                ])->all());
            });
            $bar->advance($n);
        }
        $bar->finish();
        $this->newLine();
        $this->info("Inserted {$count} products into {$store->code}.");

        return self::SUCCESS;
    }
}
