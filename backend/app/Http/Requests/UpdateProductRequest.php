<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Http\RequestContext;
use App\Models\Product;
use Illuminate\Validation\Rule;

final class UpdateProductRequest extends ApiRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $storeId = RequestContext::user($this)->store_id;
        $productId = Product::withTrashed()->where('store_id', $storeId)->where('uuid', $this->route('uuid'))->value('id');

        return [
            'sku' => ['sometimes', 'string', 'max:64', Rule::unique('products', 'sku')->where('store_id', $storeId)->ignore($productId)],
            'barcode' => ['sometimes', 'nullable', 'string', 'max:64'],
            'name' => ['sometimes', 'string', 'max:255'],
            'category' => ['sometimes', 'nullable', 'string', 'max:100'],
            'price' => ['sometimes', 'integer:strict', 'min:0', 'max:1000000000000'],
            'is_active' => ['sometimes', 'boolean'],
            'track_stock' => ['sometimes', 'boolean'],
        ];
    }
}
