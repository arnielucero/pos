<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Application\Sales\CreateSalePayloadRules;

/** POST /sales: the body is a CREATE_SALE payload; Idempotency-Key header must equal its uuid. */
final class StoreSaleRequest extends ApiRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['idempotency_key' => $this->header('Idempotency-Key')]);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'uuid', 'same:uuid'],
            ...CreateSalePayloadRules::rules(),
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'idempotency_key.required' => 'The Idempotency-Key header is required.',
            'idempotency_key.same' => 'The Idempotency-Key header must equal the sale uuid.',
        ];
    }

    /** Raw payload exactly as sent (it is hashed for idempotency). */
    public function payload(): array
    {
        $decoded = json_decode($this->getContent(), true);

        return is_array($decoded) ? $decoded : [];
    }
}
