<?php

declare(strict_types=1);

namespace App\Domain\Sync;

/** sha256 of the canonical JSON (recursively key-sorted objects, lists keep order) of an operation. */
final class PayloadHasher
{
    /** @param array<mixed> $payload */
    public function hash(OperationType $type, array $payload): string
    {
        return hash('sha256', $type->value."\n".$this->canonicalJson($payload));
    }

    /** @param array<mixed> $value */
    public function canonicalJson(array $value): string
    {
        return (string) json_encode($this->canonicalize($value), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value, SORT_STRING);
        }

        return array_map(fn ($v) => $this->canonicalize($v), $value);
    }
}
