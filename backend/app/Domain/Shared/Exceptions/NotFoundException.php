<?php

declare(strict_types=1);

namespace App\Domain\Shared\Exceptions;

final class NotFoundException extends DomainException
{
    public function errorCode(): string
    {
        return 'NOT_FOUND';
    }

    public function httpStatus(): int
    {
        return 404;
    }

    protected function defaultMessage(): string
    {
        return 'Resource not found.';
    }
}
