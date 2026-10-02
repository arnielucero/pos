<?php

declare(strict_types=1);

namespace App\Http\Requests;

final class ListSalesRequest extends ApiRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'status' => ['nullable', 'in:COMPLETED,FLAGGED,VOIDED'],
            'page' => ['nullable', 'integer', 'min:1'],
        ];
    }
}
