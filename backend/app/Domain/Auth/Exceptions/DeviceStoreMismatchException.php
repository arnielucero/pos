<?php

declare(strict_types=1);

namespace App\Domain\Auth\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class DeviceStoreMismatchException extends DomainException
{
    public function errorCode(): string
    {
        return 'DEVICE_STORE_MISMATCH';
    }

    public function httpStatus(): int
    {
        return 403;
    }

    protected function defaultMessage(): string
    {
        return 'This device belongs to a different store.';
    }
}
