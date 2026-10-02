<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\Device;
use App\Support\Iso;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Device */
final class DeviceResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var Device $d */
        $d = $this->resource;
        $d->loadMissing('store');

        return [
            'uuid' => $d->uuid,
            'code' => $d->code,
            'name' => $d->name,
            'type' => $d->type,
            'status' => $d->status,
            'store_uuid' => $d->store->uuid,
            'registered_at' => Iso::format($d->registered_at),
            'last_sync_at' => Iso::format($d->last_sync_at),
        ];
    }
}
