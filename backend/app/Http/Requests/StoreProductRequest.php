<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Http\RequestContext;
use Illuminate\Validation\Rule;

final class StoreProductRequest extends ApiRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $storeId = RequestContext::user($this)->store_id;

        return [
            'uuid' => ['nullable', 'uuid', Rule::unique('products', 'uuid')],
            'sku' => ['required', 'string', 'max:64', Rule::unique('products', 'sku')->where('store_id', $storeId)],
            'barcode' => ['nullable', 'string', 'max:64'],
            'name' => ['required', 'string', 'max:255'],
            'category' => ['nullable', 'string', 'max:100'],
            'price' => ['required', 'integer:strict', 'min:0', 'max:1000000000000'],
            'is_active' => ['sometimes', 'boolean'],
            'track_stock' => ['sometimes', 'boolean'],
            'initial_stock' => ['sometimes', 'integer:strict', 'min:0', 'max:1000000'],
        ];
    }
}
