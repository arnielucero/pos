<?php

declare(strict_types=1);

namespace App\Application\Sales;

use App\Application\Shared\PayloadValidator;
use App\Application\Shared\StoreSettings;
use App\Application\Shared\StoreUsers;
use App\Application\Sync\ConflictRecorder;
use App\Application\Sync\OperationHandler;
use App\Application\Sync\SyncContext;
use App\Domain\Audit\AuditLevel;
use App\Domain\Audit\AuditLogger;
use App\Domain\Auth\Exceptions\DeviceDisabledException;
use App\Domain\Auth\Exceptions\DeviceStoreMismatchException;
use App\Domain\Auth\Permission;
use App\Domain\Inventory\InventoryLedger;
use App\Domain\Inventory\MovementType;
use App\Domain\Pricing\PricingResult;
use App\Domain\Sales\Conflict;
use App\Domain\Sales\ConflictType;
use App\Domain\Sales\Exceptions\InvalidTotalsException;
use App\Domain\Sales\Exceptions\UnknownProductException;
use App\Domain\Sales\SaleValidator;
use App\Domain\Shared\Exceptions\DomainException;
use App\Domain\Sync\OperationResult;
use App\Domain\Sync\OperationType;
use App\Models\Payment;
use App\Models\Product;
use App\Models\RegisterSession;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\User;
use App\Support\Iso;
use Carbon\CarbonImmutable;

/**
 * CREATE_SALE, following the validation order in docs/API.md exactly:
 * 1 schema, 2 device + cashier, 3 products exist, 4 arithmetic (REJECTED), 5 price window,
 * 6 discounts, 7 inactive products, 8 stock (all FLAGGED conflicts), 9 persist in one transaction
 * (the transaction is owned by IdempotentOperationRunner, which also writes the idempotency row).
 */
final class CompleteSaleAction implements OperationHandler
{
    public function __construct(
        private readonly PayloadValidator $validator,
        private readonly StoreUsers $users,
        private readonly StoreSettings $settings,
        private readonly SaleValidator $saleValidator,
        private readonly InventoryLedger $ledger,
        private readonly ConflictRecorder $conflictRecorder,
        private readonly AuditLogger $audit,
    ) {}

    public function type(): OperationType
    {
        return OperationType::CREATE_SALE;
    }

    public function handle(SyncContext $ctx, array $payload, string $payloadHash): OperationResult
    {
        // 1. Schema.
        $sale = $this->validator->validate($payload, CreateSalePayloadRules::rules());
        if (($extra = CreateSalePayloadRules::extraErrors($sale)) !== []) {
            $this->validator->fail($extra);
        }

        // 2. Device and cashier.
        if ((int) $ctx->device->store_id !== $ctx->storeId()) {
            throw new DeviceStoreMismatchException;
        }
        if (! $ctx->device->isActive()) {
            throw new DeviceDisabledException;
        }
        $cashier = $this->users->requirePermission($sale['cashier_uuid'], $ctx->storeId(), 'cashier_uuid', Permission::SALE_CREATE);

        // 3. Products exist in this store's catalog (including inactive / soft-deleted).
        $products = $this->loadProducts($sale, $ctx->storeId());

        // 4. Arithmetic. Throws InvalidTotalsException (REJECTED, audited as SECURITY in afterRejected()).
        $pricing = $this->saleValidator->assertArithmetic($sale);

        // 5-7. Business rules -> conflicts.
        $settings = $this->settings->for($ctx->store);
        $createdAt = CarbonImmutable::parse($sale['created_at'])->utc();
        $createdAt = $createdAt->greaterThan($ctx->receivedAt) ? $ctx->receivedAt : $createdAt; // clamp to receive time
        $catalogSyncedAt = Iso::parse($sale['catalog_synced_at'] ?? null);

        $review = $this->saleValidator->review($sale, $pricing, $products, $cashier, $settings['tax_rate_bp'],
            $settings['max_discount_bp'], $createdAt, $catalogSyncedAt);
        $conflicts = $review->conflicts;

        [$receiptNumber, $receiptConflict] = $this->resolveReceiptNumber($ctx->storeId(), $sale);
        if ($receiptConflict !== null) {
            $conflicts[] = $receiptConflict;
        }

        // 8. Stock: always applied (goods left the store), negative balance -> conflict.
        foreach ($sale['items'] as $item) {
            $product = $products[$item['product_uuid']];
            if (! $product->track_stock) {
                continue;
            }
            $entry = $this->ledger->record($ctx->storeId(), $product->id, MovementType::SALE, -(int) $item['quantity'],
                'sale', $sale['uuid'], $cashier->id, $ctx->device->id, occurredAt: $createdAt);
            if ($entry->balanceAfter < 0) {
                $conflicts[] = new Conflict(ConflictType::NEGATIVE_STOCK, 'sale_item', $item['uuid'], (int) $item['quantity'],
                    $entry->balanceAfter, "Stock of {$product->sku} is negative ({$entry->balanceAfter}) after this sale.");
            }
        }

        // 9. Persist.
        $saleModel = $this->persist($ctx, $sale, $pricing, $products, $cashier, $receiptNumber, $settings['tax_rate_bp'],
            $createdAt, $catalogSyncedAt, $payloadHash, $review->serverPrices, $conflicts === [] ? Sale::STATUS_COMPLETED : Sale::STATUS_FLAGGED);

        $this->conflictRecorder->record($ctx, 'sale', $sale['uuid'], $conflicts);
        $this->auditApprovals($ctx, $sale['uuid'], $review->approvalsUsed);

        if ($conflicts !== []) {
            $this->audit->log('SYNC_FLAGGED', AuditLevel::WARNING, $ctx->storeId(), $ctx->user->id, $ctx->device->id, 'sale', $sale['uuid'],
                ['conflicts' => array_map(fn (Conflict $c) => $c->type->value, $conflicts)], ip: $ctx->ip);
        }
        $this->audit->log('SALE_CREATED', AuditLevel::AUDIT, $ctx->storeId(), $cashier->id, $ctx->device->id, 'sale', $sale['uuid'], [
            'receipt_number' => $receiptNumber, 'total' => $pricing->total, 'status' => $saleModel->status, 'synced_by' => $ctx->user->uuid,
        ], occurredAt: $createdAt, ip: $ctx->ip);

        return OperationResult::stored($sale['uuid'], (int) $saleModel->id, $conflicts);
    }

    public function afterRejected(SyncContext $ctx, array $payload, DomainException $e): void
    {
        if ($e instanceof InvalidTotalsException) {
            $this->audit->log('SALE_REJECTED_INVALID_TOTALS', AuditLevel::SECURITY, $ctx->storeId(), $ctx->user->id, $ctx->device->id,
                'sale', is_string($payload['uuid'] ?? null) ? $payload['uuid'] : null,
                ['mismatches' => $e->details()['mismatches'] ?? [], 'receipt_number' => $payload['receipt_number'] ?? null], ip: $ctx->ip);
        }
    }

    /**
     * @param  array<string, mixed>  $sale
     * @return array<string, Product>
     */
    private function loadProducts(array $sale, int $storeId): array
    {
        $uuids = array_values(array_unique(array_column($sale['items'], 'product_uuid')));
        $products = Product::withTrashed()->where('store_id', $storeId)->whereIn('uuid', $uuids)->get()->keyBy('uuid')->all();
        $missing = array_values(array_diff($uuids, array_keys($products)));
        if ($missing !== []) {
            throw new UnknownProductException('One or more products are not in this store catalog.', ['product_uuids' => $missing]);
        }

        return $products;
    }

    /**
     * A different sale already holds this receipt number (e.g. a reinstalled device restarted its counter).
     * Money changed hands, so never drop it: store under a suffixed number and flag it.
     *
     * @param  array<string, mixed>  $sale
     * @return array{0: string, 1: Conflict|null}
     */
    private function resolveReceiptNumber(int $storeId, array $sale): array
    {
        $receipt = (string) $sale['receipt_number'];
        $taken = Sale::query()->where('store_id', $storeId)->where('receipt_number', $receipt)->where('uuid', '!=', $sale['uuid'])->exists();
        if (! $taken) {
            return [$receipt, null];
        }
        $replacement = $receipt.'-D'.substr(str_replace('-', '', (string) $sale['uuid']), 0, 8);

        return [$replacement, new Conflict(ConflictType::DUPLICATE_RECEIPT_NUMBER, 'sale', $sale['uuid'], $receipt, $replacement,
            'Receipt number already used by another sale; stored under a suffixed number.')];
    }

    /**
     * @param  array<string, mixed>  $sale
     * @param  array<string, Product>  $products
     * @param  array<string, int|null>  $serverPrices
     */
    private function persist(
        SyncContext $ctx, array $sale, PricingResult $pricing, array $products, User $cashier, string $receiptNumber,
        int $taxRateBp, CarbonImmutable $createdAt, ?CarbonImmutable $catalogSyncedAt, string $payloadHash, array $serverPrices, string $status,
    ): Sale {
        $sessionUuid = $sale['register_session_uuid'] ?? null;
        $sessionId = $sessionUuid === null ? null
            : RegisterSession::query()->where('store_id', $ctx->storeId())->where('uuid', $sessionUuid)->value('id');

        $saleModel = Sale::create([
            'uuid' => $sale['uuid'],
            'store_id' => $ctx->storeId(),
            'device_id' => $ctx->device->id,
            'cashier_id' => $cashier->id,
            'synced_by' => $ctx->user->id,
            'register_session_id' => $sessionId,
            'register_session_uuid' => $sessionUuid,
            'receipt_number' => $receiptNumber,
            'client_receipt_number' => $sale['receipt_number'],
            'status' => $status,
            'subtotal' => $pricing->subtotal,
            'discount_total' => $pricing->discountTotal,
            'order_discount_type' => $sale['order_discount']['type'] ?? null,
            'order_discount_value' => $sale['order_discount']['value'] ?? null,
            'order_discount_amount' => $pricing->orderDiscount,
            'order_discount_approval' => $sale['order_discount']['approval'] ?? null,
            'tax_total' => (int) $sale['tax_total'],
            'tax_rate_bp' => $taxRateBp,
            'total' => $pricing->total,
            'cash_change' => array_sum(array_map(fn ($p) => (int) $p['change'], $sale['payments'])),
            'client_created_at' => $createdAt,
            'catalog_synced_at' => $catalogSyncedAt,
            'received_at' => $ctx->receivedAt,
            'payload_hash' => $payloadHash,
        ]);

        foreach ($sale['items'] as $idx => $item) {
            $product = $products[$item['product_uuid']];
            $line = $pricing->lines[$idx];
            SaleItem::create([
                'uuid' => $item['uuid'],
                'sale_id' => $saleModel->id,
                'product_id' => $product->id,
                'product_name' => $product->name,
                'sku' => $product->sku,
                'quantity' => (int) $item['quantity'],
                'unit_price' => (int) $item['unit_price'],
                'server_unit_price' => $serverPrices[$item['uuid']] ?? null,
                'discount_type' => $item['discount']['type'] ?? null,
                'discount_value' => $item['discount']['value'] ?? null,
                'discount_approval' => $item['discount']['approval'] ?? null,
                'price_override' => $item['price_override'] ?? null,
                'line_gross' => $line->lineGross,
                'line_discount' => $line->lineDiscount,
                'line_total' => $line->lineTotal,
            ]);
        }

        foreach ($sale['payments'] as $p) {
            Payment::create([
                'uuid' => $p['uuid'],
                'sale_id' => $saleModel->id,
                'method' => $p['method'],
                'amount' => (int) $p['amount'],
                'tendered' => (int) $p['tendered'],
                'change_amount' => (int) $p['change'],
                'reference' => $p['reference'] ?? null,
            ]);
        }

        return $saleModel;
    }

    /** @param list<array{permission: string, approver_id: int, approver_uuid: string, mode: string|null, entity_uuid: string}> $approvals */
    private function auditApprovals(SyncContext $ctx, string $saleUuid, array $approvals): void
    {
        foreach ($approvals as $a) {
            $this->audit->log('APPROVAL_USED', AuditLevel::AUDIT, $ctx->storeId(), $a['approver_id'], $ctx->device->id, 'sale', $saleUuid, [
                'permission' => $a['permission'], 'mode' => $a['mode'], 'entity_uuid' => $a['entity_uuid'],
            ], ip: $ctx->ip);
        }
    }
}
