<?php

declare(strict_types=1);

namespace App\Application\Sync;

use App\Application\Shared\StoreSettings;
use App\Domain\Auth\Permission;
use App\Domain\Auth\PermissionResolver;
use App\Domain\Auth\RolePermissions;
use App\Models\Device;
use App\Models\InventoryBalance;
use App\Models\Product;
use App\Models\Store;
use App\Models\User;
use App\Support\Iso;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

/**
 * GET /sync/pull: incremental catalog download for the device's store. Products and inventory are
 * paged (same page index, page size from config); approvers and settings are always sent in full.
 */
final class PullSyncAction
{
    public function __construct(
        private readonly StoreSettings $settings,
        private readonly PermissionResolver $permissions,
    ) {}

    /** @return array<string, mixed> */
    public function pull(Store $store, Device $device, ?CarbonImmutable $since, int $page): array
    {
        $serverTime = CarbonImmutable::now();
        $size = (int) config('pos.sync.pull_page_size');
        $offset = ($page - 1) * $size;

        $products = Product::withTrashed()
            ->with('currentPrice')
            ->where('store_id', $store->id)
            ->when($since, fn (Builder $q) => $q->where(fn (Builder $w) => $w
                ->where('updated_at', '>=', $since)
                ->orWhere('deleted_at', '>=', $since)))
            ->orderBy('id')
            ->offset($offset)->limit($size + 1)
            ->get();

        $balances = InventoryBalance::query()
            ->join('products', 'products.id', '=', 'inventory_balances.product_id')
            ->where('inventory_balances.store_id', $store->id)
            ->when($since, fn ($q) => $q->where('inventory_balances.updated_at', '>=', $since))
            ->orderBy('inventory_balances.id')
            ->offset($offset)->limit($size + 1)
            ->get(['products.uuid as product_uuid', 'inventory_balances.quantity_on_hand', 'inventory_balances.updated_at', 'inventory_balances.id']);

        $hasMore = $products->count() > $size || $balances->count() > $size;

        $device->forceFill(['last_sync_at' => $serverTime])->save();

        return [
            'server_time' => Iso::format($serverTime),
            'has_more' => $hasMore,
            'products' => $products->take($size)->map(fn (Product $p) => [
                'uuid' => $p->uuid,
                'sku' => $p->sku,
                'barcode' => $p->barcode,
                'name' => $p->name,
                'category' => $p->category,
                'price' => (int) ($p->currentPrice?->price ?? 0),
                'is_active' => $p->is_active,
                'track_stock' => $p->track_stock,
                'updated_at' => Iso::format($p->updated_at),
                'deleted' => $p->deleted_at !== null,
            ])->values()->all(),
            'inventory' => $balances->take($size)->map(fn ($b) => [
                'product_uuid' => $b->product_uuid,
                'quantity_on_hand' => (int) $b->quantity_on_hand,
                'updated_at' => Iso::format(CarbonImmutable::parse($b->updated_at)),
            ])->values()->all(),
            'approvers' => $this->approvers($store),
            'settings' => $this->settings->for($store),
        ];
    }

    /** @return list<array<string, mixed>> Users who can approve offline (approval.grant + PIN set). Inactive ones are included so devices revoke them. */
    private function approvers(Store $store): array
    {
        $roles = array_map(fn ($r) => $r->value, RolePermissions::rolesWith(Permission::APPROVAL_GRANT));

        return User::query()
            ->where('store_id', $store->id)
            ->whereIn('role', $roles)
            ->whereNotNull('pin_hash')
            ->orderBy('id')
            ->get()
            ->map(fn (User $u) => [
                'user_uuid' => $u->uuid,
                'name' => $u->name,
                'permissions' => $this->permissions->permissionsFor($u),
                'pin_hash' => $u->pin_hash,
                'is_active' => $u->is_active,
            ])->values()->all();
    }
}
