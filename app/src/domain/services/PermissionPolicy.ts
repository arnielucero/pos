import type { Approval } from '../entities/Approval';
import { hasPermission, type Permission, type PermissionHolder } from '../entities/Permission';
import { PermissionDeniedError } from '../errors/DomainError';

/**
 * Client mirror of the server permission matrix (UX only — the server is authoritative).
 * A user lacking a permission may proceed with an approval for that exact permission.
 */
export class PermissionPolicy {
  /** Returns the approval to attach (null when the user holds the permission directly). */
  require(user: PermissionHolder, permission: Permission, approval?: Approval | null): Approval | null {
    if (hasPermission(user, permission)) return null;
    if (approval?.permission === permission) return approval;
    throw new PermissionDeniedError(permission);
  }
}
