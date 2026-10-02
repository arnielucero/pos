<?php

declare(strict_types=1);

namespace App\Application\Inventory;

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
use App\Domain\Sales\Exceptions\UnknownProductException;
use App\Domain\Sync\OperationResult;
use App\Domain\Sync\OperationType;
use App\Models\Product;
use Carbon\CarbonImmutable;

final class AdjustInventoryAction implements OperationHandler
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
        return OperationType::ADJUST_INVENTORY;
    }

    public function handle(SyncContext $ctx, array $payload, string $payloadHash): OperationResult
    {
        $data = $this->validator->validate($payload, [
            'uuid' => ['required', 'uuid'],
            'product_uuid' => ['required', 'uuid'],
            'type' => ['required', 'in:STOCK_IN,STOCK_OUT,ADJUSTMENT'],
            'quantity' => ['required', 'integer:strict', 'not_in:0', 'between:-1000000,1000000'],
            'reason' => ['required', 'string', 'max:255'],
            'adjusted_by_uuid' => ['required', 'uuid'],
            'created_at' => ['required', 'date'],
            ...ApprovalRules::for('approval'),
        ]);
        $type = MovementType::from($data['type']);
        $quantity = (int) $data['quantity'];
        if (($type === MovementType::STOCK_IN && $quantity <= 0) || ($type === MovementType::STOCK_OUT && $quantity >= 0)) {
            $this->validator->fail(['quantity' => ['STOCK_IN must be positive and STOCK_OUT negative.']]);
        }

        $actor = $this->users->requireActive($data['adjusted_by_uuid'], $ctx->storeId(), 'adjusted_by_uuid');
        $auth = $this->approvals->authorize($actor, Permission::INVENTORY_ADJUST, $data['approval'] ?? null)
            ?? throw new ForbiddenException('Adjusting inventory requires inventory.adjust or a valid approval.');

        $product = Product::withTrashed()->where('store_id', $ctx->storeId())->where('uuid', $data['product_uuid'])->first()
            ?? throw new UnknownProductException('Product is not in this store catalog.', ['product_uuids' => [$data['product_uuid']]]);

        $occurredAt = CarbonImmutable::parse($data['created_at'])->utc();
        $entry = $this->ledger->record($ctx->storeId(), $product->id, $type, $quantity, 'inventory_adjustment', $data['uuid'],
            $actor->id, $ctx->device->id, uuid: $data['uuid'], reason: $data['reason'], approvedBy: $auth->approver?->id, occurredAt: $occurredAt);

        $this->audit->log('INVENTORY_ADJUSTED', AuditLevel::AUDIT, $ctx->storeId(), $actor->id, $ctx->device->id, 'product', $product->uuid, [
            'movement_uuid' => $data['uuid'], 'type' => $type->value, 'quantity' => $quantity, 'reason' => $data['reason'],
            'balance_after' => $entry->balanceAfter, 'approved_by' => $auth->approver?->uuid, 'approval_mode' => $auth->mode(),
        ], occurredAt: $occurredAt, ip: $ctx->ip);

        return OperationResult::stored($data['uuid'], $entry->movementId);
    }
}
