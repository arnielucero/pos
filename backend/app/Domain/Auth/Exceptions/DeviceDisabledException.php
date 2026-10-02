<?php

declare(strict_types=1);

namespace App\Domain\Auth\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class DeviceDisabledException extends DomainException
{
    public function errorCode(): string
    {
        return 'DEVICE_DISABLED';
    }

    public function httpStatus(): int
    {
        return 403;
    }

    protected function defaultMessage(): string
    {
        return 'This device has been disabled.';
    }
}
