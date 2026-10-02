<?php

declare(strict_types=1);

namespace App\Domain\Shared\Exceptions;

final class ConflictException extends DomainException
{
    public function errorCode(): string
    {
        return 'CONFLICT';
    }

    public function httpStatus(): int
    {
        return 409;
    }

    protected function defaultMessage(): string
    {
        return 'The request conflicts with existing data.';
    }

    public function retryable(): bool
    {
        return true;
    }
}
