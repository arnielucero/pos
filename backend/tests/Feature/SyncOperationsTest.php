<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\InventoryMovement;
use App\Models\Product;
use App\Models\RegisterClosure;
use App\Models\RegisterSession;
use App\Models\Sale;
use App\Models\SaleVoid;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Tests\TestCase;

final class SyncOperationsTest extends TestCase
{
    private Product $chicken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->chicken = $this->makeProduct('ML-001', 12000, 20);
    }

    private function now(): string
    {
        return CarbonImmutable::now()->format('Y-m-d\TH:i:s\Z');
    }

    private function voidPayload(string $saleUuid, string $voidedBy, ?array $approval = null): array
    {
        return ['uuid' => (string) Str::uuid(), 'sale_uuid' => $saleUuid, 'reason' => 'Customer changed mind',
            'voided_at' => $this->now(), 'voided_by_uuid' => $voidedBy, 'approval' => $approval];
    }

    private function adjustPayload(string $type, int $qty, string $by, ?array $approval = null, ?Product $product = null): array
    {
        return ['uuid' => (string) Str::uuid(), 'product_uuid' => ($product ?? $this->chicken)->uuid, 'type' => $type, 'quantity' => $qty,
            'reason' => 'Damaged', 'adjusted_by_uuid' => $by, 'created_at' => $this->now(), 'approval' => $approval];
    }

    public function test_void_requires_permission_or_approval(): void
    {
        $sale = $this->salePayload([[$this->chicken, 2]]);
        $cashier = $this->users['CASHIER'];

        $results = $this->sync([
            $this->op('CREATE_SALE', $sale),
            $this->op('VOID_SALE', $this->voidPayload($sale['uuid'], $cashier->uuid)),
        ])->assertOk()->json('results');

        $this->assertSame('APPLIED', $results[0]['status']);
        $this->assertSame('REJECTED', $results[1]['status']);
        $this->assertSame('FORBIDDEN', $results[1]['error']['code']);
        $this->assertFalse($results[1]['retryable']);
        $this->assertSame('COMPLETED', Sale::query()->value('status'));

        $void = $this->voidPayload($sale['uuid'], $cashier->uuid, $this->approvalBy($this->users['SUPERVISOR']));
        $result = $this->sync([$this->op('VOID_SALE', $void)])->json('results.0');
        $this->assertSame('APPLIED', $result['status']);
        $this->assertSame($void['uuid'], $result['entity_uuid']);

        $saleRow = Sale::query()->firstOrFail();
        $this->assertSame('VOIDED', $saleRow->status);
        $this->assertSame(24000, $saleRow->total, 'financial columns untouched');
        $this->assertSame(1, SaleVoid::query()->count());
        $this->assertSame(20, $this->balance($this->chicken), 'stock restored by VOID movement');
        $this->assertSame(1, InventoryMovement::query()->where('type', 'VOID')->count());
        $this->assertTrue(AuditLog::query()->where('action', 'SALE_VOIDED')->exists());

        // Already voided.
        $again = $this->sync([$this->op('VOID_SALE', $this->voidPayload($sale['uuid'], $this->users['MANAGER']->uuid))])->json('results.0');
        $this->assertSame('SALE_ALREADY_VOIDED', $again['error']['code']);
        $this->assertFalse($again['retryable']);
    }

    public function test_void_of_unknown_sale_is_retryable(): void
    {
        $result = $this->sync([$this->op('VOID_SALE', $this->voidPayload((string) Str::uuid(), $this->users['MANAGER']->uuid))])->json('results.0');
        $this->assertSame('REJECTED', $result['status']);
        $this->assertSame('SALE_NOT_FOUND', $result['error']['code']);
        $this->assertTrue($result['retryable']);
    }

    public function test_inventory_adjustment_by_inventory_role(): void
    {
        $payload = $this->adjustPayload('ADJUSTMENT', -3, $this->users['INVENTORY']->uuid);
        $result = $this->sync([$this->op('ADJUST_INVENTORY', $payload)], $this->authHeaders($this->users['INVENTORY']))->json('results.0');

        $this->assertSame('APPLIED', $result['status']);
        $this->assertSame(17, $this->balance($this->chicken));
        $this->assertTrue(InventoryMovement::query()->where('uuid', $payload['uuid'])->where('quantity', -3)->exists());
        $this->assertTrue(AuditLog::query()->where('action', 'INVENTORY_ADJUSTED')->exists());

        $in = $this->sync([$this->op('ADJUST_INVENTORY', $this->adjustPayload('STOCK_IN', 10, $this->users['INVENTORY']->uuid))])->json('results.0');
        $this->assertSame('APPLIED', $in['status']);
        $this->assertSame(27, $this->balance($this->chicken));
    }

    public function test_cashier_cannot_adjust_inventory_without_approval(): void
    {
        $cashier = $this->users['CASHIER']->uuid;
        $denied = $this->sync([$this->op('ADJUST_INVENTORY', $this->adjustPayload('STOCK_OUT', -2, $cashier))])->json('results.0');
        $this->assertSame('FORBIDDEN', $denied['error']['code']);
        $this->assertSame(20, $this->balance($this->chicken));

        // Supervisor has approval.grant but not inventory.adjust -> still denied.
        $bad = $this->sync([$this->op('ADJUST_INVENTORY', $this->adjustPayload('STOCK_OUT', -2, $cashier, $this->approvalBy($this->users['SUPERVISOR'])))])->json('results.0');
        $this->assertSame('FORBIDDEN', $bad['error']['code']);

        $ok = $this->sync([$this->op('ADJUST_INVENTORY', $this->adjustPayload('STOCK_OUT', -2, $cashier, $this->approvalBy($this->users['MANAGER'])))])->json('results.0');
        $this->assertSame('APPLIED', $ok['status']);
        $this->assertSame(18, $this->balance($this->chicken));
    }

    public function test_adjustment_sign_rules(): void
    {
        $by = $this->users['INVENTORY']->uuid;
        $r = $this->sync([
            $this->op('ADJUST_INVENTORY', $this->adjustPayload('STOCK_IN', -5, $by)),
            $this->op('ADJUST_INVENTORY', $this->adjustPayload('STOCK_OUT', 5, $by)),
            $this->op('ADJUST_INVENTORY', $this->adjustPayload('ADJUSTMENT', 0, $by)),
        ])->json('results');
        $this->assertSame(['VALIDATION_FAILED', 'VALIDATION_FAILED', 'VALIDATION_FAILED'], array_column(array_column($r, 'error'), 'code'));
    }

    public function test_register_open_and_close_reconciled(): void
    {
        $session = (string) Str::uuid();
        $cashier = $this->users['CASHIER'];
        $sale = $this->salePayload([[$this->chicken, 1]], overrides: ['register_session_uuid' => $session]);
        $cashPaid = $sale['payments'][0]['amount'];

        $close = ['uuid' => (string) Str::uuid(), 'session_uuid' => $session, 'closed_by_uuid' => $this->users['SUPERVISOR']->uuid,
            'closed_at' => $this->now(), 'actual_cash' => 200000 + $cashPaid, 'expected_cash' => 200000 + $cashPaid, 'cash_sales' => $cashPaid,
            'cash_refunds' => 0, 'cash_adjustments' => 0, 'variance' => 0, 'approval' => null];

        $results = $this->sync([
            $this->op('OPEN_REGISTER', ['uuid' => $session, 'opened_by_uuid' => $cashier->uuid, 'opened_at' => $this->now(), 'opening_cash' => 200000]),
            $this->op('CREATE_SALE', $sale),
            $this->op('CLOSE_REGISTER', $close),
        ])->json('results');

        $this->assertSame(['APPLIED', 'APPLIED', 'APPLIED'], array_column($results, 'status'));
        $this->assertSame('CLOSED', RegisterSession::query()->value('status'));
        $this->assertSame('RECONCILED', RegisterClosure::query()->value('status'));
        $this->assertNotNull(Sale::query()->value('register_session_id'));
    }

    public function test_register_close_mismatch_is_flagged(): void
    {
        $session = (string) Str::uuid();
        $this->sync([$this->op('OPEN_REGISTER', ['uuid' => $session, 'opened_by_uuid' => $this->users['CASHIER']->uuid, 'opened_at' => $this->now(), 'opening_cash' => 200000])]);

        // Client believes there were 312500 of cash sales, server has none.
        $close = ['uuid' => (string) Str::uuid(), 'session_uuid' => $session, 'closed_by_uuid' => $this->users['MANAGER']->uuid,
            'closed_at' => $this->now(), 'actual_cash' => 512300, 'expected_cash' => 512500, 'cash_sales' => 312500,
            'cash_refunds' => 0, 'cash_adjustments' => 0, 'variance' => -200, 'approval' => null];
        $result = $this->sync([$this->op('CLOSE_REGISTER', $close)])->json('results.0');

        $this->assertSame('FLAGGED', $result['status']);
        $this->assertSame(['REGISTER_TOTALS_MISMATCH', 'REGISTER_TOTALS_MISMATCH'], array_column($result['conflicts'], 'type'));
        $closure = RegisterClosure::query()->firstOrFail();
        $this->assertSame(512500, (int) $closure->client_expected_cash);
        $this->assertSame(200000, (int) $closure->server_expected_cash);
        $this->assertSame(312300, (int) $closure->server_variance);

        // Cashier cannot close without approval; unknown session is retryable; already closed is permanent.
        $byCashier = ['uuid' => (string) Str::uuid(), 'closed_by_uuid' => $this->users['CASHIER']->uuid] + $close;
        $this->assertSame('FORBIDDEN', $this->sync([$this->op('CLOSE_REGISTER', $byCashier)])->json('results.0.error.code'));
        $again = ['uuid' => (string) Str::uuid()] + $close;
        $this->assertSame('REGISTER_ALREADY_CLOSED', $this->sync([$this->op('CLOSE_REGISTER', $again)])->json('results.0.error.code'));
        $unknown = $this->sync([$this->op('CLOSE_REGISTER', ['uuid' => (string) Str::uuid(), 'session_uuid' => (string) Str::uuid()] + $close)])->json('results.0');
        $this->assertSame('REGISTER_SESSION_NOT_FOUND', $unknown['error']['code']);
        $this->assertTrue($unknown['retryable']);
    }

    public function test_batch_with_mixed_results_applies_each_independently(): void
    {
        $good = $this->salePayload([[$this->chicken, 1]]);
        $tampered = $this->salePayload([[$this->chicken, 1]]);
        $tampered['items'][0]['line_total'] = 1;
        $adjust = $this->adjustPayload('STOCK_IN', 5, $this->users['MANAGER']->uuid);

        $response = $this->sync([
            $this->op('CREATE_SALE', $good),
            $this->op('CREATE_SALE', $tampered),
            ['idempotency_key' => 'not-a-uuid', 'type' => 'NOPE', 'payload' => []],
            $this->op('ADJUST_INVENTORY', $adjust),
            $this->op('CREATE_SALE', $good), // replay inside the same batch
        ])->assertOk()->assertJsonStructure(['results', 'server_time']);

        $results = $response->json('results');
        $this->assertSame(['APPLIED', 'REJECTED', 'REJECTED', 'APPLIED', 'DUPLICATE'], array_column($results, 'status'));
        $this->assertSame($good['uuid'], $results[0]['idempotency_key']);
        $this->assertSame('INVALID_TOTALS', $results[1]['error']['code']);
        $this->assertSame('VALIDATION_FAILED', $results[2]['error']['code']);
        $this->assertSame(1, Sale::query()->count());
        $this->assertSame(24, $this->balance($this->chicken)); // 20 - 1 + 5
        $this->assertNotNull($this->device->fresh()->last_sync_at);
    }

    public function test_batch_size_limit(): void
    {
        $ops = array_fill(0, 51, $this->op('AUDIT_EVENTS', ['events' => []]));
        $this->sync($ops)->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
    }

    public function test_audit_events_are_deduplicated_by_event_uuid(): void
    {
        $event = ['uuid' => (string) Str::uuid(), 'action' => 'PRINT_FAILED', 'user_uuid' => $this->users['CASHIER']->uuid,
            'entity_type' => 'sale', 'entity_uuid' => (string) Str::uuid(), 'metadata' => ['printer' => 'BT-58'], 'occurred_at' => $this->now()];

        $r1 = $this->sync([$this->op('AUDIT_EVENTS', ['events' => [$event]], (string) Str::uuid())])->json('results.0');
        $r2 = $this->sync([$this->op('AUDIT_EVENTS', ['events' => [$event, ['uuid' => (string) Str::uuid()] + $event]], (string) Str::uuid())])->json('results.0');

        $this->assertSame('APPLIED', $r1['status']);
        $this->assertSame('APPLIED', $r2['status']);
        $this->assertSame(2, AuditLog::query()->where('action', 'PRINT_FAILED')->where('source', 'DEVICE')->count());
        $this->assertSame($this->users['CASHIER']->id, AuditLog::query()->where('uuid', $event['uuid'])->value('user_id'));
    }

    public function test_idempotency_key_must_match_payload_uuid(): void
    {
        $sale = $this->salePayload([[$this->chicken, 1]]);
        $result = $this->sync([$this->op('CREATE_SALE', $sale, (string) Str::uuid())])->json('results.0');
        $this->assertSame('VALIDATION_FAILED', $result['error']['code']);
    }
}
