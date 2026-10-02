<?php

declare(strict_types=1);

namespace App\Domain\Register\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class RegisterAlreadyClosedException extends DomainException
{
    public function errorCode(): string
    {
        return 'REGISTER_ALREADY_CLOSED';
    }

    public function httpStatus(): int
    {
        return 409;
    }

    protected function defaultMessage(): string
    {
        return 'Register session is already closed.';
    }
}
