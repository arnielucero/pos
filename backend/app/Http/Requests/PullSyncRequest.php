<?php

declare(strict_types=1);

namespace App\Http\Requests;

final class PullSyncRequest extends ApiRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'since' => ['nullable', 'date'],
            'page' => ['nullable', 'integer', 'min:1', 'max:100000'],
        ];
    }
}
