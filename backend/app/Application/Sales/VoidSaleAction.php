<?php

declare(strict_types=1);

namespace App\Application\Sales;

use App\Application\Shared\ApprovalRules;
use App\Application\Shared\PayloadValidator;
use App\Application\Shared\StoreUsers;
use App\Application\Sync\IgnoresRejections;
use App\Application\Sync\OperationHandler;
use App\Application\Sync\SyncContext;
use App\Domain\Approval\ApprovalVerifier;
use App\Domain\Audit\AuditLevel;
use App\Domain\Audit\AuditLogger;
use App\Domain\Auth\Exceptions\ForbiddenException;
use App\Domain\Auth\Permission;
use App\Domain\Inventory\InventoryLedger;
use App\Domain\Inventory\MovementType;
use App\Domain\Sales\Exceptions\SaleAlreadyVoidedException;
use App\Domain\Sales\Exceptions\SaleNotFoundException;
use App\Domain\Sync\OperationResult;
use App\Domain\Sync\OperationType;
use App\Models\Product;
use App\Models\Sale;
use App\Models\SaleVoid;
use Carbon\CarbonImmutable;

/** VOID_SALE: a separate sale_voids row + reversing VOID movements; the sale's money columns never change. */
final class VoidSaleAction implements OperationHandler
{
    use IgnoresRejections;

    public function __construct(
        private readonly PayloadValidator $validator,
        private readonly StoreUsers $users,
        private readonly ApprovalVerifier $approvals,
        private readonly InventoryLedger $ledger,
        private readonly AuditLogger $audit,
    ) {}

    public function type(): OperationType
    {
        return OperationType::VOID_SALE;
    }

    public function handle(SyncContext $ctx, array $payload, string $payloadHash): OperationResult
    {
        $data = $this->validator->validate($payload, [
            'uuid' => ['required', 'uuid'],
            'sale_uuid' => ['required', 'uuid'],
            'reason' => ['required', 'string', 'max:255'],
            'voided_at' => ['required', 'date'],
            'voided_by_uuid' => ['required', 'uuid'],
            ...ApprovalRules::for('approval'),
        ]);

        $voidedBy = $this->users->requireActive($data['voided_by_uuid'], $ctx->storeId(), 'voided_by_uuid');
        $auth = $this->approvals->authorize($voidedBy, Permission::SALE_VOID, $data['approval'] ?? null)
            ?? throw new ForbiddenException('Voiding requires sale.void or a valid approval.');

        /** @var Sale|null $sale */
        $sale = Sale::query()->where('store_id', $ctx->storeId())->where('uuid', $data['sale_uuid'])->lockForUpdate()->first();
        if ($sale === null) {
            throw new SaleNotFoundException;
        }
        if ($sale->status === Sale::STATUS_VOIDED || SaleVoid::query()->where('sale_id', $sale->id)->exists()) {
            throw new SaleAlreadyVoidedException;
        }

        $voidedAt = CarbonImmutable::parse($data['voided_at'])->utc();
        $void = SaleVoid::create([
            'uuid' => $data['uuid'],
            'sale_id' => $sale->id,
            'store_id' => $ctx->storeId(),
            'voided_by' => $voidedBy->id,
            'approved_by' => $auth->approver?->id,
            'approval' => $data['approval'] ?? null,
            'reason' => $data['reason'],
            'voided_at' => $voidedAt,
            'device_id' => $ctx->device->id,
            'synced_by' => $ctx->user->id,
        ]);

        $sale->status = Sale::STATUS_VOIDED; // status only; financial columns are immutable
        $sale->save();

        $products = Product::withTrashed()->whereIn('id', $sale->items()->pluck('product_id'))->get()->keyBy('id');
        foreach ($sale->items as $item) {
            if ($products[$item->product_id]->track_stock ?? false) {
                $this->ledger->record($ctx->storeId(), $item->product_id, MovementType::VOID, $item->quantity, 'sale_void',
                    $void->uuid, $voidedBy->id, $ctx->device->id, reason: $data['reason'], approvedBy: $auth->approver?->id, occurredAt: $voidedAt);
            }
        }

        $this->audit->log('SALE_VOIDED', AuditLevel::AUDIT, $ctx->storeId(), $voidedBy->id, $ctx->device->id, 'sale', $sale->uuid, [
            'void_uuid' => $void->uuid, 'reason' => $data['reason'], 'total' => $sale->total,
            'approved_by' => $auth->approver?->uuid, 'approval_mode' => $auth->mode(),
        ], occurredAt: $voidedAt, ip: $ctx->ip);

        return OperationResult::stored($void->uuid, (int) $void->id);
    }
}
