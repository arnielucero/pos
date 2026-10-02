<?php

declare(strict_types=1);

namespace App\Http\Requests;

/** Batch envelope only; each operation is validated individually so one bad op cannot fail the batch. */
final class SyncRequest extends ApiRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'operations' => ['present', 'array', 'list', 'max:'.(int) config('pos.sync.max_operations')],
        ];
    }
}
