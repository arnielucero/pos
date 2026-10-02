<?php

declare(strict_types=1);

namespace App\Domain\Auth\Exceptions;

use App\Domain\Shared\Exceptions\DomainException;

final class ForbiddenException extends DomainException
{
    public function errorCode(): string
    {
        return 'FORBIDDEN';
    }

    public function httpStatus(): int
    {
        return 403;
    }

    protected function defaultMessage(): string
    {
        return 'You are not allowed to perform this action.';
    }
}
