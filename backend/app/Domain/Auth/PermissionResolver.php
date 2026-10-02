<?php

declare(strict_types=1);

namespace App\Domain\Auth;

use App\Models\User;

final class PermissionResolver
{
    public function has(User $user, string $permission): bool
    {
        return $user->is_active && in_array($permission, $this->permissionsFor($user), true);
    }

    /** @return list<string> */
    public function permissionsFor(User $user): array
    {
        return RolePermissions::for($user->role);
    }
}
