<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Domain\Auth\Role;
use App\Models\AuditLog;
use App\Models\IdempotencyKey;
use App\Models\InventoryMovement;
use App\Models\Product;
use App\Models\Sale;
use App\Models\SyncConflict;
use App\Repositories\IdempotencyKeyRepository;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Tests\TestCase;

final class CreateSaleTest extends TestCase
{
    private Product $chicken;

    private Product $coffee;

    protected function setUp(): void
    {
        parent::setUp();
        $this->chicken = $this->makeProduct('ML-001', 12000, 25);
        $this->coffee = $this->makeProduct('DR-001', 9000, 10);
    }

    private function createSale(array $payload, ?array $headers = null): array
    {
        return $this->sync([$this->op('CREATE_SALE', $payload)], $headers)->assertOk()->json('results.0');
    }

    public function test_happy_path_applies_sale_with_items_payments_movements_and_audit(): void
    {
        $payload = $this->salePayload([[$this->chicken, 2], [$this->coffee, 1]]);
        $result = $this->createSale($payload);

        $this->assertSame('APPLIED', $result['status']);
        $this->assertSame(201, $result['http_status']);
        $this->assertSame($payload['uuid'], $result['entity_uuid']);
        $this->assertSame([], $result['conflicts']);
        $this->assertNull($result['error']);
        $this->assertFalse($result['retryable']);

        $sale = Sale::query()->where('uuid', $payload['uuid'])->firstOrFail();
        $this->assertSame($result['server_id'], $sale->id);
        $this->assertSame('COMPLETED', $sale->status);
        $this->assertSame(33000, $sale->total);
        $this->assertSame($this->users['CASHIER']->id, $sale->cashier_id);
        $this->assertCount(2, $sale->items);
        $this->assertCount(1, $sale->payments);
        $this->assertSame(23, $this->balance($this->chicken));
        $this->assertSame(9, $this->balance($this->coffee));
        $this->assertSame(2, InventoryMovement::query()->where('type', 'SALE')->where('reference_uuid', $payload['uuid'])->count());
        $this->assertTrue(AuditLog::query()->where('action', 'SALE_CREATED')->where('entity_uuid', $payload['uuid'])->exists());
        $this->assertTrue(IdempotencyKey::query()->where('key', $payload['uuid'])->exists());

        $this->api('GET', '/sales/'.$payload['uuid'], [], $this->authHeaders($this->users['CASHIER']))
            ->assertOk()->assertJsonPath('data.total', 33000)->assertJsonPath('data.status', 'COMPLETED')->assertJsonCount(2, 'data.items');
    }

    public function test_replay_returns_duplicate_with_original_result(): void
    {
        $payload = $this->salePayload([[$this->chicken, 1]]);
        $first = $this->createSale($payload);
        // Same payload, keys in another order: canonical hash is identical.
        $reordered = array_reverse($payload, true);
        $second = $this->createSale($reordered);

        $this->assertSame('DUPLICATE', $second['status']);
        $this->assertSame(200, $second['http_status']);
        $this->assertSame($first['server_id'], $second['server_id']);
        $this->assertSame(1, Sale::query()->count());
        $this->assertSame(24, $this->balance($this->chicken));
    }

    public function test_post_sales_endpoint_201_then_200(): void
    {
        $payload = $this->salePayload([[$this->chicken, 1]]);
        $headers = ['Idempotency-Key' => $payload['uuid']] + $this->authHeaders($this->users['CASHIER']);

        $this->api('POST', '/sales', $payload, $headers)->assertCreated()
            ->assertJsonPath('result.status', 'APPLIED')->assertJsonPath('data.uuid', $payload['uuid'])->assertJsonPath('data.total', 12000);
        $this->api('POST', '/sales', $payload, $headers)->assertOk()->assertJsonPath('result.status', 'DUPLICATE');

        // Header must match the sale uuid.
        $this->api('POST', '/sales', $this->salePayload([[$this->chicken, 1]]), $headers)->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->assertSame(1, Sale::query()->count());
    }

    public function test_same_key_different_payload_is_rejected(): void
    {
        $payload = $this->salePayload([[$this->chicken, 1]]);
        $this->createSale($payload);
        $tampered = $this->salePayload([[$this->chicken, 2]], overrides: ['uuid' => $payload['uuid'], 'receipt_number' => $payload['receipt_number']]);

        $result = $this->createSale($tampered);
        $this->assertSame('REJECTED', $result['status']);
        $this->assertSame('IDEMPOTENCY_KEY_REUSED', $result['error']['code']);
        $this->assertSame(409, $result['http_status']);
        $this->assertFalse($result['retryable']);

        $headers = ['Idempotency-Key' => $payload['uuid']] + $this->authHeaders($this->users['CASHIER']);
        $this->api('POST', '/sales', $tampered, $headers)->assertStatus(409)->assertJsonPath('error.code', 'IDEMPOTENCY_KEY_REUSED');
    }

    public function test_tampered_totals_are_rejected_and_security_audited(): void
    {
        $payload = $this->salePayload([[$this->chicken, 2]]);
        $payload['total'] = 100;
        $payload['payments'][0]['amount'] = 100;
        $payload['payments'][0]['change'] = $payload['payments'][0]['tendered'] - 100;

        $result = $this->createSale($payload);
        $this->assertSame('REJECTED', $result['status']);
        $this->assertSame('INVALID_TOTALS', $result['error']['code']);
        $this->assertSame(422, $result['http_status']);
        $this->assertFalse($result['retryable']);
        $this->assertSame(0, Sale::query()->count());
        $this->assertSame(25, $this->balance($this->chicken));
        $this->assertSame(0, IdempotencyKey::query()->count());
        $this->assertTrue(AuditLog::query()->where('action', 'SALE_REJECTED_INVALID_TOTALS')->where('level', 'SECURITY')->exists());
    }

    public function test_bad_cash_change_and_payment_sum_are_invalid_totals(): void
    {
        $payload = $this->salePayload([[$this->chicken, 1]]);
        $payload['payments'][0]['change'] += 1;
        $this->assertSame('INVALID_TOTALS', $this->createSale($payload)['error']['code']);

        $payload = $this->salePayload([[$this->chicken, 1]]);
        $payload['payments'][] = ['uuid' => (string) Str::uuid(), 'method' => 'GCASH', 'amount' => 100, 'tendered' => 100, 'change' => 0, 'reference' => 'GC-1'];
        $this->assertSame('INVALID_TOTALS', $this->createSale($payload)['error']['code']);
    }

    public function test_split_payment_with_gcash_requires_reference(): void
    {
        $payload = $this->salePayload([[$this->chicken, 1]]);
        $payload['payments'] = [
            ['uuid' => (string) Str::uuid(), 'method' => 'GCASH', 'amount' => 7000, 'tendered' => 7000, 'change' => 0, 'reference' => null],
            ['uuid' => (string) Str::uuid(), 'method' => 'CASH', 'amount' => 5000, 'tendered' => 5000, 'change' => 0, 'reference' => null],
        ];
        $result = $this->createSale($payload);
        $this->assertSame('VALIDATION_FAILED', $result['error']['code']);
        $this->assertArrayHasKey('payments.0.reference', $result['error']['details']);

        $payload['payments'][0]['reference'] = 'GC-123456';
        $this->assertSame('APPLIED', $this->createSale($payload)['status']);
    }

    public function test_price_changed_on_server_inside_window_is_applied(): void
    {
        // Old price 12000 was still effective when the catalog was synced, then changed before the sale.
        $this->changePrice($this->chicken, 13000, CarbonImmutable::now()->subMinutes(30));
        $payload = $this->salePayload([[$this->chicken, 1, 12000]]);

        $this->assertSame('APPLIED', $this->createSale($payload)['status']);
    }

    public function test_price_outside_window_is_flagged_price_mismatch(): void
    {
        // Price changed to 13000 two hours ago, catalog synced one hour ago: client should have had 13000.
        $this->changePrice($this->chicken, 13000, CarbonImmutable::now()->subHours(2));
        $payload = $this->salePayload([[$this->chicken, 1, 12000]]);

        $result = $this->createSale($payload);
        $this->assertSame('FLAGGED', $result['status']);
        $this->assertSame(201, $result['http_status']);
        $this->assertSame('PRICE_MISMATCH', $result['conflicts'][0]['type']);
        $this->assertSame('sale_item', $result['conflicts'][0]['entity_type']);
        $this->assertSame($payload['items'][0]['uuid'], $result['conflicts'][0]['entity_uuid']);
        $this->assertSame(12000, $result['conflicts'][0]['local_value']);
        $this->assertSame(13000, $result['conflicts'][0]['server_value']);

        $this->assertSame('FLAGGED', Sale::query()->value('status'));
        $this->assertSame(1, SyncConflict::query()->where('conflict_type', 'PRICE_MISMATCH')->where('resolution_status', 'OPEN')->count());
        $this->assertTrue(AuditLog::query()->where('action', 'SYNC_FLAGGED')->exists());
        $this->assertSame(24, $this->balance($this->chicken), 'flagged sales still move stock');
    }

    public function test_price_override_with_valid_approval_is_applied(): void
    {
        $payload = $this->salePayload([[$this->chicken, 1, 10000]]);
        $payload['items'][0]['price_override'] = ['original_price' => 12000, 'approval' => $this->approvalBy($this->users['MANAGER'])];
        $this->assertSame('APPLIED', $this->createSale($payload)['status']);
        $this->assertTrue(AuditLog::query()->where('action', 'APPROVAL_USED')->where('user_id', $this->users['MANAGER']->id)->exists());

        // Supervisor has approval.grant but not price.override -> not a valid approval.
        $payload = $this->salePayload([[$this->chicken, 1, 10000]]);
        $payload['items'][0]['price_override'] = ['original_price' => 12000, 'approval' => $this->approvalBy($this->users['SUPERVISOR'])];
        $this->assertSame('PRICE_MISMATCH', $this->createSale($payload)['conflicts'][0]['type']);
    }

    public function test_unauthorized_discount_is_flagged(): void
    {
        $payload = $this->salePayload([[$this->chicken, 2, null, ['type' => 'PERCENT', 'value' => 1000]]], ['type' => 'AMOUNT', 'value' => 1000, 'approval' => null]);
        $result = $this->createSale($payload);

        $this->assertSame('FLAGGED', $result['status']);
        $types = array_column($result['conflicts'], 'type');
        $this->assertSame(['DISCOUNT_UNAUTHORIZED', 'DISCOUNT_UNAUTHORIZED'], $types);
        $this->assertSame(20600, Sale::query()->value('total'), 'money columns keep what the customer paid');
    }

    public function test_discount_with_approval_or_permission_is_applied(): void
    {
        $approval = $this->approvalBy($this->users['SUPERVISOR']);
        $payload = $this->salePayload([[$this->chicken, 2, null, ['type' => 'PERCENT', 'value' => 1000, 'approval' => $approval]]],
            ['type' => 'AMOUNT', 'value' => 1000, 'approval' => $approval]);
        $this->assertSame('APPLIED', $this->createSale($payload)['status']);

        // Supervisor as cashier holds discount.apply directly.
        $sup = $this->users['SUPERVISOR'];
        $payload = $this->salePayload([[$this->chicken, 1, null, ['type' => 'PERCENT', 'value' => 500]]], cashier: $sup);
        $this->assertSame('APPLIED', $this->createSale($payload)['status']);
    }

    public function test_discount_over_store_max_is_flagged_even_with_approval(): void
    {
        $approval = $this->approvalBy($this->users['MANAGER']);
        $payload = $this->salePayload([[$this->chicken, 1, null, ['type' => 'PERCENT', 'value' => 6000, 'approval' => $approval]]]);
        $result = $this->createSale($payload);
        $this->assertSame('DISCOUNT_UNAUTHORIZED', $result['conflicts'][0]['type']);
        $this->assertSame(6000, $result['conflicts'][0]['server_value']);
    }

    public function test_inactive_product_is_flagged(): void
    {
        $this->coffee->update(['is_active' => false]);
        $result = $this->createSale($this->salePayload([[$this->coffee, 1]]));
        $this->assertSame('FLAGGED', $result['status']);
        $this->assertSame('PRODUCT_INACTIVE', $result['conflicts'][0]['type']);
    }

    public function test_soft_deleted_product_is_known_but_flagged(): void
    {
        // Deleted after the (offline) sale happened -> fine.
        $this->coffee->delete();
        $this->assertSame('APPLIED', $this->createSale($this->salePayload([[$this->coffee, 1]]))['status']);

        // Deleted before the sale -> known product, but flagged.
        $this->coffee->forceFill(['deleted_at' => now()->subHour()])->save();
        $result = $this->createSale($this->salePayload([[$this->coffee, 1]]));
        $this->assertSame('FLAGGED', $result['status']);
        $this->assertSame('PRODUCT_INACTIVE', $result['conflicts'][0]['type']);
    }

    public function test_negative_stock_is_applied_and_flagged(): void
    {
        $result = $this->createSale($this->salePayload([[$this->coffee, 12]]));
        $this->assertSame('FLAGGED', $result['status']);
        $this->assertSame('NEGATIVE_STOCK', $result['conflicts'][0]['type']);
        $this->assertSame(-2, $result['conflicts'][0]['server_value']);
        $this->assertSame(-2, $this->balance($this->coffee));
    }

    public function test_unknown_product_is_rejected(): void
    {
        $foreignStore = $this->makeStore('STORE-002');
        $foreign = $this->makeProduct('X-1', 5000, 5, store: $foreignStore);
        $result = $this->createSale($this->salePayload([[$foreign, 1]]));

        $this->assertSame('REJECTED', $result['status']);
        $this->assertSame('UNKNOWN_PRODUCT', $result['error']['code']);
        $this->assertSame([$foreign->uuid], $result['error']['details']['product_uuids']);
        $this->assertFalse($result['retryable']);
        $this->assertSame(0, Sale::query()->count());
    }

    public function test_cashier_from_another_store_is_rejected(): void
    {
        $other = $this->makeStore('STORE-002');
        $foreignCashier = $this->makeUser($other, Role::CASHIER);
        $result = $this->createSale($this->salePayload([[$this->chicken, 1]], cashier: $foreignCashier));

        $this->assertSame('REJECTED', $result['status']);
        $this->assertSame('FORBIDDEN', $result['error']['code']);
        $this->assertSame(0, Sale::query()->count());

        // Inventory clerk has no sale.create either.
        $result = $this->createSale($this->salePayload([[$this->chicken, 1]], cashier: $this->users['INVENTORY']));
        $this->assertSame('FORBIDDEN', $result['error']['code']);
    }

    public function test_synced_by_may_differ_from_cashier(): void
    {
        $payload = $this->salePayload([[$this->chicken, 1]]);
        $this->createSale($payload, $this->authHeaders($this->users['MANAGER']));
        $sale = Sale::query()->firstOrFail();
        $this->assertSame($this->users['CASHIER']->id, $sale->cashier_id);
        $this->assertSame($this->users['MANAGER']->id, $sale->synced_by);
    }

    public function test_schema_errors_are_rejected_not_retryable(): void
    {
        $payload = $this->salePayload([[$this->chicken, 1]]);
        $payload['items'][0]['quantity'] = 1.5;
        $payload['total'] = '12000';
        $result = $this->createSale($payload);

        $this->assertSame('REJECTED', $result['status']);
        $this->assertSame('VALIDATION_FAILED', $result['error']['code']);
        $this->assertArrayHasKey('items.0.quantity', $result['error']['details']);
        $this->assertArrayHasKey('total', $result['error']['details']);
        $this->assertFalse($result['retryable']);
    }

    public function test_concurrent_duplicate_is_resolved_by_unique_index(): void
    {
        $payload = $this->salePayload([[$this->chicken, 1]]);
        $this->createSale($payload); // the "winner" committed first

        // Simulate the loser: its pre-check ran before the winner committed, so it saw no key.
        $real = app(IdempotencyKeyRepository::class);
        $calls = 0;
        $this->app->instance(IdempotencyKeyRepository::class, new class($real, $calls) extends IdempotencyKeyRepository
        {
            public function __construct(private IdempotencyKeyRepository $inner, private int &$calls) {}

            public function find(int $storeId, string $key): ?IdempotencyKey
            {
                return $this->calls++ === 0 ? null : $this->inner->find($storeId, $key);
            }
        });

        $result = $this->createSale($payload);
        $this->assertSame('DUPLICATE', $result['status']);
        $this->assertSame(2, $calls);
        $this->assertSame(1, Sale::query()->count());
        $this->assertSame(24, $this->balance($this->chicken), 'loser transaction was rolled back');
    }

    public function test_receipt_number_collision_is_stored_under_suffix_and_flagged(): void
    {
        $first = $this->salePayload([[$this->chicken, 1]]);
        $this->createSale($first);
        $second = $this->salePayload([[$this->chicken, 1]], overrides: ['receipt_number' => $first['receipt_number']]);

        $result = $this->createSale($second);
        $this->assertSame('FLAGGED', $result['status']);
        $this->assertSame('DUPLICATE_RECEIPT_NUMBER', $result['conflicts'][0]['type']);
        $this->assertSame(2, Sale::query()->count());
        $this->assertStringStartsWith($first['receipt_number'].'-D', Sale::query()->where('uuid', $second['uuid'])->value('receipt_number'));
    }

    public function test_future_created_at_is_clamped_to_receive_time(): void
    {
        $payload = $this->salePayload([[$this->chicken, 1]], overrides: ['created_at' => CarbonImmutable::now()->addDays(3)->format('Y-m-d\TH:i:s\Z')]);
        $this->assertSame('APPLIED', $this->createSale($payload)['status']);
        $this->assertTrue(Sale::query()->value('client_created_at') <= now());
    }
}
