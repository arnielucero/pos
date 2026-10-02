<?php

declare(strict_types=1);

namespace App\Domain\Sales\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class SaleNotFoundException extends DomainException
{
    public function errorCode(): string
    {
        return 'SALE_NOT_FOUND';
    }

    public function httpStatus(): int
    {
        return 404;
    }

    protected function defaultMessage(): string
    {
        return 'Sale not found (yet).';
    }

    public function retryable(): bool
    {
        return true;
    }
}
