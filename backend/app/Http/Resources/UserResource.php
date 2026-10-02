<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Auth\PermissionResolver;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin User — never exposes password, pin_hash or tokens. */
final class UserResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var User $user */
        $user = $this->resource;
        $user->loadMissing('store');

        return [
            'uuid' => $user->uuid,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role->value,
            'permissions' => app(PermissionResolver::class)->permissionsFor($user),
            'store' => ['uuid' => $user->store->uuid, 'code' => $user->store->code, 'name' => $user->store->name],
        ];
    }
}
