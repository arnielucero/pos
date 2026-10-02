<?php

declare(strict_types=1);

namespace App\Domain\Auth\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class DeviceNotRegisteredException extends DomainException
{
    public function errorCode(): string
    {
        return 'DEVICE_NOT_REGISTERED';
    }

    public function httpStatus(): int
    {
        return 403;
    }

    protected function defaultMessage(): string
    {
        return 'This device is not registered.';
    }
}
