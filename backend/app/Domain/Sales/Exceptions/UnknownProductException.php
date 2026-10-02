<?php

declare(strict_types=1);

namespace App\Domain\Sales\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class UnknownProductException extends DomainException
{
    public function errorCode(): string
    {
        return 'UNKNOWN_PRODUCT';
    }

    public function httpStatus(): int
    {
        return 422;
    }

    protected function defaultMessage(): string
    {
        return 'One or more products are not in this store catalog.';
    }
}
