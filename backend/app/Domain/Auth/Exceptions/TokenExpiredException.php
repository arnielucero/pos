<?php

declare(strict_types=1);

namespace App\Domain\Auth\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class TokenExpiredException extends DomainException
{
    public function errorCode(): string
    {
        return 'TOKEN_EXPIRED';
    }

    public function httpStatus(): int
    {
        return 401;
    }

    protected function defaultMessage(): string
    {
        return 'Access token expired.';
    }
}
