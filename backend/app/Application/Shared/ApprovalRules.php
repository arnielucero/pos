<?php

declare(strict_types=1);

namespace App\Application\Shared;

/** Validation rules for the contract's approval object, nested under $prefix. */
final class ApprovalRules
{
    /** @return array<string, mixed> */
    public static function for(string $prefix): array
    {
        return [
            $prefix => ['nullable', 'array'],
            "$prefix.approved_by_uuid" => ["required_with:$prefix", 'uuid'],
            "$prefix.approved_at" => ["required_with:$prefix", 'date'],
            "$prefix.mode" => ["required_with:$prefix", 'in:ONLINE,OFFLINE_PIN'],
            "$prefix.reason" => ['nullable', 'string', 'max:255'],
        ];
    }
}
