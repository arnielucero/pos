<?php

declare(strict_types=1);

namespace App\Domain\Register\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class RegisterSessionNotFoundException extends DomainException
{
    public function errorCode(): string
    {
        return 'REGISTER_SESSION_NOT_FOUND';
    }

    public function httpStatus(): int
    {
        return 404;
    }

    protected function defaultMessage(): string
    {
        return 'Register session not found (yet).';
    }

    public function retryable(): bool
    {
        return true;
    }
}
