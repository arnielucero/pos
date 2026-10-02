<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\Product;
use App\Support\Iso;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Product */
final class ProductResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var Product $p */
        $p = $this->resource;

        return [
            'uuid' => $p->uuid,
            'sku' => $p->sku,
            'barcode' => $p->barcode,
            'name' => $p->name,
            'category' => $p->category,
            'price' => (int) ($p->currentPrice?->price ?? 0),
            'is_active' => $p->is_active,
            'track_stock' => $p->track_stock,
            'quantity_on_hand' => (int) ($p->balance?->quantity_on_hand ?? 0),
            'updated_at' => Iso::format($p->updated_at),
            'deleted' => $p->deleted_at !== null,
        ];
    }
}
