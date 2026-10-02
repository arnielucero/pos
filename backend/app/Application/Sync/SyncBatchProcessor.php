<?php

declare(strict_types=1);

namespace App\Application\Sync;

use App\Application\Audit\RecordAuditEventsAction;
use App\Application\Inventory\AdjustInventoryAction;
use App\Application\Register\CloseRegisterAction;
use App\Application\Register\OpenRegisterAction;
use App\Application\Sales\CompleteSaleAction;
use App\Application\Sales\VoidSaleAction;
use App\Domain\Shared\Exceptions\ValidationFailedException;
use App\Domain\Sync\OperationResult;
use App\Domain\Sync\OperationType;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;

/**
 * POST /sync: applies operations in order, each in its own transaction (one failure never rolls
 * back the others), and returns one result per operation.
 */
final class SyncBatchProcessor
{
    /** @var array<string, OperationHandler> */
    private array $handlers = [];

    public function __construct(
        private readonly IdempotentOperationRunner $runner,
        CompleteSaleAction $createSale,
        VoidSaleAction $voidSale,
        AdjustInventoryAction $adjustInventory,
        OpenRegisterAction $openRegister,
        CloseRegisterAction $closeRegister,
        RecordAuditEventsAction $auditEvents,
    ) {
        foreach ([$createSale, $voidSale, $adjustInventory, $openRegister, $closeRegister, $auditEvents] as $handler) {
            $this->handlers[$handler->type()->value] = $handler;
        }
    }

    /**
     * @param  list<mixed>  $operations
     * @return list<array<string, mixed>>
     */
    public function process(SyncContext $ctx, array $operations): array
    {
        $results = [];
        foreach ($operations as $op) {
            $key = is_array($op) && is_string($op['idempotency_key'] ?? null) ? $op['idempotency_key'] : null;
            $envelopeErrors = $this->envelopeErrors($op);

            if ($envelopeErrors !== []) {
                $results[] = OperationResult::rejected(new ValidationFailedException('Malformed operation.', $envelopeErrors))->toArray($key);

                continue;
            }

            $type = OperationType::from($op['type']);
            $results[] = $this->runner->run($ctx, $type, $key, $op['payload'], $this->handlers[$type->value])->toArray($key);
        }

        $ctx->device->forceFill(['last_sync_at' => CarbonImmutable::now()])->save();

        return $results;
    }

    /** @return array<string, list<string>> */
    private function envelopeErrors(mixed $op): array
    {
        if (! is_array($op)) {
            return ['operation' => ['Each operation must be an object.']];
        }
        $validator = Validator::make($op, [
            'idempotency_key' => ['required', 'uuid'],
            'type' => ['required', 'string', 'in:'.implode(',', array_column(OperationType::cases(), 'value'))],
            'payload' => ['present', 'array'],
        ]);

        return $validator->fails() ? $validator->errors()->toArray() : [];
    }
}
