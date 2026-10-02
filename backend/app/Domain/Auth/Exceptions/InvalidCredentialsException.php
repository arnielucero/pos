<?php

declare(strict_types=1);

namespace App\Domain\Auth\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class InvalidCredentialsException extends DomainException
{
    public function errorCode(): string
    {
        return 'INVALID_CREDENTIALS';
    }

    public function httpStatus(): int
    {
        return 401;
    }

    protected function defaultMessage(): string
    {
        return 'Invalid credentials.';
    }
}
