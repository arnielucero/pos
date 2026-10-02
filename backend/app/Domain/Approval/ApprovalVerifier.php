<?php

declare(strict_types=1);

namespace App\Domain\Approval;

use App\Domain\Auth\Permission;
use App\Domain\Auth\PermissionResolver;
use App\Models\User;

/**
 * Re-validates a client-supplied approval object: the approver must be an active user of the
 * same store holding `approval.grant` AND the permission being approved.
 */
final class ApprovalVerifier
{
    public function __construct(private readonly PermissionResolver $permissions) {}

    /**
     * @param  array{approved_by_uuid?: string, mode?: string}|null  $approval
     * @return User|null the approver when valid
     */
    public function verify(?array $approval, int $storeId, string $permission): ?User
    {
        $approverUuid = $approval['approved_by_uuid'] ?? null;
        if (! is_string($approverUuid) || $approverUuid === '') {
            return null;
        }

        $approver = User::query()
            ->where('uuid', $approverUuid)
            ->where('store_id', $storeId)
            ->where('is_active', true)
            ->first();

        if ($approver === null) {
            return null;
        }

        return $this->permissions->has($approver, Permission::APPROVAL_GRANT)
            && $this->permissions->has($approver, $permission)
            ? $approver
            : null;
    }

    /** Actor may act directly, or an approval for that permission is valid. Returns approver (if used) or the actor. */
    public function authorize(User $actor, string $permission, ?array $approval): ?AuthorizationOutcome
    {
        if ($this->permissions->has($actor, $permission)) {
            return new AuthorizationOutcome($actor, null, $approval);
        }

        $approver = $this->verify($approval, (int) $actor->store_id, $permission);

        return $approver === null ? null : new AuthorizationOutcome($actor, $approver, $approval);
    }
}
