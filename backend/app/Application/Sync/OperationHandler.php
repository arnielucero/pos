<?php

declare(strict_types=1);

namespace App\Application\Sync;

use App\Domain\Shared\Exceptions\DomainException;
use App\Domain\Sync\OperationResult;
use App\Domain\Sync\OperationType;

/** One sync operation type. handle() runs inside the runner's transaction and throws DomainException to reject. */
interface OperationHandler
{
    public function type(): OperationType;

    /** @param array<string, mixed> $payload */
    public function handle(SyncContext $ctx, array $payload, string $payloadHash): OperationResult;

    /**
     * Called after a rejection, outside the (rolled back) transaction, e.g. to write a SECURITY audit.
     *
     * @param  array<string, mixed>  $payload
     */
    public function afterRejected(SyncContext $ctx, array $payload, DomainException $e): void;
}
