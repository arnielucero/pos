<?php

declare(strict_types=1);

namespace App\Domain\Sales\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

/** Client arithmetic does not match the server recomputation. Treated as tampering. */
final class InvalidTotalsException extends DomainException
{
    public function errorCode(): string
    {
        return 'INVALID_TOTALS';
    }

    public function httpStatus(): int
    {
        return 422;
    }

    protected function defaultMessage(): string
    {
        return 'Sale totals do not match the server calculation.';
    }
}
