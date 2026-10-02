<?php

declare(strict_types=1);

namespace App\Domain\Sales\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class SaleAlreadyVoidedException extends DomainException
{
    public function errorCode(): string
    {
        return 'SALE_ALREADY_VOIDED';
    }

    public function httpStatus(): int
    {
        return 409;
    }

    protected function defaultMessage(): string
    {
        return 'Sale is already voided.';
    }
}
