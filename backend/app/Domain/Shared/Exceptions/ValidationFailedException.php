<?php

declare(strict_types=1);

namespace App\Domain\Shared\Exceptions;

final class ValidationFailedException extends DomainException
{
    public function errorCode(): string
    {
        return 'VALIDATION_FAILED';
    }

    public function httpStatus(): int
    {
        return 422;
    }

    protected function defaultMessage(): string
    {
        return 'The given data was invalid.';
    }
}
