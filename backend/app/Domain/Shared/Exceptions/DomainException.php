<?php

declare(strict_types=1);

namespace App\Domain\Shared\Exceptions;

use RuntimeException;

/**
 * Base for every typed domain error. Rendered into the API error envelope in exactly
 * one place (App\Http\ApiExceptionRenderer) and into sync op results by the sync runner.
 */
abstract class DomainException extends RuntimeException
{
    /** @param array<string, mixed> $details */
    public function __construct(string $message = '', private readonly array $details = [])
    {
        parent::__construct($message !== '' ? $message : $this->defaultMessage());
    }

    abstract public function errorCode(): string;

    abstract public function httpStatus(): int;

    abstract protected function defaultMessage(): string;

    /** @return array<string, mixed> */
    public function details(): array
    {
        return $this->details;
    }

    public function retryable(): bool
    {
        return false;
    }
}
