<?php

declare(strict_types=1);

namespace App\Support;

use Carbon\CarbonImmutable;
use DateTimeInterface;

/** ISO-8601 UTC "Z" timestamps as required by the API contract. */
final class Iso
{
    public static function format(?DateTimeInterface $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return CarbonImmutable::instance($value)->utc()->format('Y-m-d\TH:i:s\Z');
    }

    public static function parse(?string $value): ?CarbonImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }

        return CarbonImmutable::parse($value)->utc();
    }

    public static function now(): string
    {
        return (string) self::format(CarbonImmutable::now());
    }
}
