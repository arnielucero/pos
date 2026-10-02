<?php

declare(strict_types=1);

namespace Tests\Concerns;

use App\Application\Auth\TokenIssuer;
use App\Domain\Auth\Role;
use App\Domain\Inventory\InventoryLedger;
use App\Domain\Inventory\MovementType;
use App\Domain\Pricing\Discount;
use App\Domain\Pricing\LineInput;
use App\Domain\Pricing\PricingCalculator;
use App\Models\Device;
use App\Models\InventoryBalance;
use App\Models\Product;
use App\Models\ProductPrice;
use App\Models\Store;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

trait PosFixtures
{
    protected Store $store;

    protected Device $device;

    /** @var array<string, User> keyed by role value */
    protected array $users = [];

    protected function setUpPos(): void
    {
        $this->store = $this->makeStore('STORE-001');
        foreach (Role::cases() as $role) {
            $this->users[$role->value] = $this->makeUser($this->store, $role);
        }
        $this->device = $this->makeDevice($this->store, 'POS-01');
    }

    protected function makeStore(string $code): Store
    {
        return Store::create(['uuid' => (string) Str::uuid(), 'code' => $code, 'name' => "Store $code"]);
    }

    protected function makeUser(Store $store, Role $role, ?string $pin = null): User
    {
        $pin ??= in_array($role, [Role::MANAGER, Role::SUPERVISOR], true) ? '123456' : null;

        return User::create([
            'uuid' => (string) Str::uuid(),
            'store_id' => $store->id,
            'name' => ucfirst(strtolower($role->value)).' '.$store->code,
            'email' => strtolower($role->value).'.'.strtolower($store->code).'@pos.test',
            'password' => 'password',
            'pin_hash' => $pin === null ? null : Hash::make($pin, ['rounds' => 4]),
            'role' => $role,
            'is_active' => true,
        ]);
    }

    protected function makeDevice(Store $store, string $code, string $status = 'ACTIVE'): Device
    {
        return Device::create([
            'uuid' => (string) Str::uuid(), 'store_id' => $store->id, 'code' => $code, 'name' => "Tablet $code",
            'type' => 'ANDROID_TABLET', 'status' => $status, 'registered_at' => now(),
        ]);
    }

    protected function makeProduct(string $sku, int $price, int $stock = 100, array $attrs = [], ?Store $store = null): Product
    {
        $store ??= $this->store;
        $product = Product::create(array_merge([
            'uuid' => (string) Str::uuid(), 'store_id' => $store->id, 'sku' => $sku, 'barcode' => null,
            'name' => "Product $sku", 'category' => 'Meals', 'is_active' => true, 'track_stock' => true,
        ], $attrs));
        ProductPrice::create(['product_id' => $product->id, 'price' => $price, 'effective_from' => CarbonImmutable::now()->subDays(10)]);
        InventoryBalance::query()->insertOrIgnore(['product_id' => $product->id, 'store_id' => $store->id, 'quantity_on_hand' => 0, 'updated_at' => now()]);
        if ($stock > 0) {
            DB::transaction(fn () => app(InventoryLedger::class)->record($store->id, $product->id, MovementType::STOCK_IN, $stock));
        }

        return $product;
    }

    /** Change the product's price at $at (closing the previous row). */
    protected function changePrice(Product $product, int $price, CarbonImmutable $at): void
    {
        ProductPrice::query()->where('product_id', $product->id)->whereNull('effective_to')->update(['effective_to' => $at]);
        ProductPrice::create(['product_id' => $product->id, 'price' => $price, 'effective_from' => $at]);
    }

    /** @return array<string, string> headers for a device-bound token */
    protected function authHeaders(User $user, ?Device $device = null): array
    {
        $device ??= $this->device;
        $tokens = app(TokenIssuer::class)->issue($user, $device->uuid, $device);

        return ['Authorization' => 'Bearer '.$tokens->accessToken, 'X-Device-Id' => $device->uuid, 'Accept' => 'application/json'];
    }

    /** JSON request with guards reset (Sanctum caches the resolved user per app instance). */
    protected function api(string $method, string $uri, array $data = [], array $headers = []): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->json($method, '/api/v1'.$uri, $data, $headers + ['Accept' => 'application/json']);
    }

    /** @param list<array<string, mixed>> $operations */
    protected function sync(array $operations, ?array $headers = null): TestResponse
    {
        return $this->api('POST', '/sync', ['operations' => $operations], $headers ?? $this->authHeaders($this->users['CASHIER']));
    }

    /** @param array<string, mixed> $payload */
    protected function op(string $type, array $payload, ?string $key = null): array
    {
        return ['idempotency_key' => $key ?? $payload['uuid'] ?? (string) Str::uuid(), 'type' => $type, 'payload' => $payload];
    }

    /**
     * Build an arithmetically-correct sale payload.
     *
     * @param  list<array{0: Product, 1: int, 2?: int|null, 3?: array|null}>  $lines  [product, qty, unit_price?, discount?]
     * @param  array<string, mixed>  $overrides
     */
    protected function salePayload(array $lines, ?array $orderDiscount = null, array $overrides = [], ?User $cashier = null): array
    {
        $cashier ??= $this->users['CASHIER'];
        $items = [];
        $inputs = [];
        foreach ($lines as $line) {
            [$product, $qty] = $line;
            $unit = $line[2] ?? (int) ProductPrice::query()->where('product_id', $product->id)->whereNull('effective_to')->value('price');
            $discount = $line[3] ?? null;
            $inputs[] = new LineInput($unit, $qty, Discount::fromArray($discount));
            $items[] = ['uuid' => (string) Str::uuid(), 'product_uuid' => $product->uuid, 'quantity' => $qty, 'unit_price' => $unit,
                'discount' => $discount, 'price_override' => null];
        }
        $result = (new PricingCalculator)->calculate($inputs, Discount::fromArray($orderDiscount), 1200);
        foreach ($result->lines as $i => $r) {
            $items[$i] += ['line_gross' => $r->lineGross, 'line_discount' => $r->lineDiscount, 'line_total' => $r->lineTotal];
        }
        $uuid = (string) Str::uuid();

        return array_merge([
            'uuid' => $uuid,
            'receipt_number' => 'POS-01-20261002-'.str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
            'cashier_uuid' => $cashier->uuid,
            'register_session_uuid' => null,
            'created_at' => CarbonImmutable::now()->subMinutes(5)->format('Y-m-d\TH:i:s.v\Z'),
            'catalog_synced_at' => CarbonImmutable::now()->subHour()->format('Y-m-d\TH:i:s\Z'),
            'items' => $items,
            'order_discount' => $orderDiscount,
            'subtotal' => $result->subtotal,
            'discount_total' => $result->discountTotal,
            'tax_total' => $result->taxTotal,
            'total' => $result->total,
            'payments' => [[
                'uuid' => (string) Str::uuid(), 'method' => 'CASH', 'amount' => $result->total,
                'tendered' => $result->total + 5000, 'change' => 5000, 'reference' => null,
            ]],
        ], $overrides);
    }

    /** @return array<string, string> */
    protected function approvalBy(User $approver, string $mode = 'OFFLINE_PIN'): array
    {
        return ['approved_by_uuid' => $approver->uuid, 'approved_at' => CarbonImmutable::now()->format('Y-m-d\TH:i:s\Z'), 'mode' => $mode, 'reason' => 'Test approval'];
    }

    protected function balance(Product $product): int
    {
        return (int) InventoryBalance::query()->where('product_id', $product->id)->value('quantity_on_hand');
    }
}
