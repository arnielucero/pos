<?php

declare(strict_types=1);

namespace App\Domain\Sync\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class IdempotencyKeyReusedException extends DomainException
{
    public function errorCode(): string
    {
        return 'IDEMPOTENCY_KEY_REUSED';
    }

    public function httpStatus(): int
    {
        return 409;
    }

    protected function defaultMessage(): string
    {
        return 'Idempotency key was already used with a different payload.';
    }
}
