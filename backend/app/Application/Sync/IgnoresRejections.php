<?php

declare(strict_types=1);

namespace App\Application\Sync;

use App\Domain\Shared\Exceptions\DomainException;

trait IgnoresRejections
{
    public function afterRejected(SyncContext $ctx, array $payload, DomainException $e): void {}
}
