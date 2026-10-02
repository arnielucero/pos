<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Domain\Auth\Role;
use App\Domain\Inventory\InventoryLedger;
use App\Domain\Inventory\MovementType;
use App\Models\Device;
use App\Models\InventoryBalance;
use App\Models\Product;
use App\Models\ProductPrice;
use App\Models\Store;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * DEV/DEMO DATA ONLY. All users get the password "password"; manager PIN 123456, supervisor PIN 654321.
 * Refuses to run in production.
 */
class DatabaseSeeder extends Seeder
{
    public const DEMO_DEVICE_UUID = '00000000-0000-4000-8000-000000000001';

    /** [sku, name, category, price centavos, barcode suffix] */
    private const PRODUCTS = [
        ['ML-001', 'Chicken Rice', 'Meals', 12000], ['ML-002', 'Pork Chop Meal', 'Meals', 15000],
        ['ML-003', 'Beef Tapa Meal', 'Meals', 16500], ['ML-004', 'Tocino Meal', 'Meals', 14000],
        ['ML-005', 'Longganisa Meal', 'Meals', 13500], ['ML-006', 'Chicken Adobo Rice', 'Meals', 13000],
        ['ML-007', 'Sisig Rice', 'Meals', 14500], ['ML-008', 'Lechon Kawali Meal', 'Meals', 17000],
        ['ML-009', 'Bangus Sinigang', 'Meals', 18000], ['ML-010', 'Kare-Kare', 'Meals', 22000],
        ['ML-011', 'Pancit Canton', 'Meals', 9500], ['ML-012', 'Lumpia Shanghai (6 pcs)', 'Meals', 8500],
        ['DR-001', 'Coffee', 'Drinks', 9000], ['DR-002', 'Milk Tea', 'Drinks', 11000],
        ['DR-003', 'Iced Tea', 'Drinks', 6000], ['DR-004', 'Calamansi Juice', 'Drinks', 6500],
        ['DR-005', 'Bottled Water', 'Drinks', 3000], ['DR-006', 'Softdrink in Can', 'Drinks', 5500],
        ['DR-007', "Sago't Gulaman", 'Drinks', 5000], ['DR-008', 'Buko Juice', 'Drinks', 7500],
        ['DR-009', 'Hot Chocolate', 'Drinks', 8500], ['DR-010', 'Mango Shake', 'Drinks', 12000],
        ['DS-001', 'Halo-Halo', 'Desserts', 13000], ['DS-002', 'Leche Flan', 'Desserts', 7000],
        ['SN-001', 'Turon', 'Snacks', 3500], ['SN-002', 'Banana Cue', 'Snacks', 3000],
        ['SN-003', 'Ensaymada', 'Snacks', 4500], ['SN-004', 'Pandesal (5 pcs)', 'Snacks', 2500],
        ['SN-005', 'Siopao Asado', 'Snacks', 5500], ['SN-006', 'Puto (3 pcs)', 'Snacks', 4000],
    ];

    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('DatabaseSeeder creates demo users with known passwords and must not run in production.');
        }

        DB::transaction(function (): void {
            $store = Store::create(['uuid' => (string) Str::uuid(), 'code' => 'STORE-001', 'name' => 'HMR Demo Store']);
            $pinRounds = (int) config('pos.auth.pin_bcrypt_rounds');

            $users = [];
            foreach ([
                ['admin@pos.test', 'Ana Admin', Role::ADMIN, null],
                ['manager@pos.test', 'Maria Manager', Role::MANAGER, '123456'],
                ['supervisor@pos.test', 'Sam Supervisor', Role::SUPERVISOR, '654321'],
                ['cashier@pos.test', 'Carlo Cashier', Role::CASHIER, null],
                ['inventory@pos.test', 'Ines Inventory', Role::INVENTORY, null],
            ] as [$email, $name, $role, $pin]) {
                $users[$role->value] = User::create([
                    'uuid' => (string) Str::uuid(),
                    'store_id' => $store->id,
                    'name' => $name,
                    'email' => $email,
                    'password' => 'password',
                    'pin_hash' => $pin === null ? null : Hash::make($pin, ['rounds' => $pinRounds]),
                    'role' => $role,
                    'is_active' => true,
                ]);
            }

            Device::create([
                'uuid' => self::DEMO_DEVICE_UUID, 'store_id' => $store->id, 'code' => 'POS-01', 'name' => 'Demo counter',
                'type' => 'ANDROID_TABLET', 'status' => 'ACTIVE', 'registered_by' => $users['ADMIN']->id, 'registered_at' => now(),
            ]);

            $ledger = app(InventoryLedger::class);
            $since = CarbonImmutable::now()->subDays(30);
            foreach (self::PRODUCTS as $i => [$sku, $name, $category, $price]) {
                $product = Product::create([
                    'uuid' => (string) Str::uuid(), 'store_id' => $store->id, 'sku' => $sku,
                    'barcode' => sprintf('48000000%05d', $i + 1), 'name' => $name, 'category' => $category,
                    'is_active' => true, 'track_stock' => true,
                ]);
                ProductPrice::create(['product_id' => $product->id, 'price' => $price, 'effective_from' => $since]);
                InventoryBalance::query()->insertOrIgnore(['product_id' => $product->id, 'store_id' => $store->id, 'quantity_on_hand' => 0, 'updated_at' => now()]);
                $ledger->record($store->id, $product->id, MovementType::STOCK_IN, 50 + ($i * 7) % 150, 'seed', null,
                    $users['INVENTORY']->id, reason: 'Opening stock');
            }
        });
    }
}
