<?php

declare(strict_types=1);

namespace App\Application\Shared;

use App\Domain\Auth\Exceptions\ForbiddenException;
use App\Domain\Auth\PermissionResolver;
use App\Models\User;

final class StoreUsers
{
    public function __construct(private readonly PermissionResolver $permissions) {}

    public function activeInStore(string $uuid, int $storeId): ?User
    {
        return User::query()->where('uuid', $uuid)->where('store_id', $storeId)->where('is_active', true)->first();
    }

    /** The referenced actor must be an active user of the store (permission is checked separately). */
    public function requireActive(string $uuid, int $storeId, string $field): User
    {
        return $this->activeInStore($uuid, $storeId)
            ?? throw new ForbiddenException("The user in {$field} is not an active user of this store.");
    }

    public function requirePermission(string $uuid, int $storeId, string $field, string $permission): User
    {
        $user = $this->requireActive($uuid, $storeId, $field);
        if (! $this->permissions->has($user, $permission)) {
            throw new ForbiddenException("The user in {$field} lacks {$permission}.");
        }

        return $user;
    }
}
