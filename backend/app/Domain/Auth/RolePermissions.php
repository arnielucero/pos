<?php

declare(strict_types=1);

namespace App\Domain\Auth;

use App\Domain\Auth\Permission as P;

/**
 * Single source of truth for the role -> permission matrix (docs/API.md "Roles and permissions").
 */
final class RolePermissions
{
    /** @var array<string, list<string>> */
    private const MATRIX = [
        'ADMIN' => [
            P::SALE_CREATE, P::SALE_VOID, P::SALE_REFUND, P::SALE_REPRINT, P::DISCOUNT_APPLY, P::PRICE_OVERRIDE,
            P::INVENTORY_VIEW, P::INVENTORY_ADJUST, P::PRODUCT_EDIT, P::REPORT_VIEW, P::REGISTER_OPEN,
            P::REGISTER_CLOSE, P::SETTINGS_EDIT, P::DEVICE_REGISTER, P::APPROVAL_GRANT, P::SYNC_DIAGNOSTICS,
        ],
        'MANAGER' => [
            P::SALE_CREATE, P::SALE_VOID, P::SALE_REFUND, P::SALE_REPRINT, P::DISCOUNT_APPLY, P::PRICE_OVERRIDE,
            P::INVENTORY_VIEW, P::INVENTORY_ADJUST, P::PRODUCT_EDIT, P::REPORT_VIEW, P::REGISTER_OPEN,
            P::REGISTER_CLOSE, P::SETTINGS_EDIT, P::DEVICE_REGISTER, P::APPROVAL_GRANT, P::SYNC_DIAGNOSTICS,
        ],
        'SUPERVISOR' => [
            P::SALE_CREATE, P::SALE_VOID, P::SALE_REPRINT, P::DISCOUNT_APPLY, P::INVENTORY_VIEW, P::REPORT_VIEW,
            P::REGISTER_OPEN, P::REGISTER_CLOSE, P::APPROVAL_GRANT,
        ],
        'CASHIER' => [
            P::SALE_CREATE, P::SALE_REPRINT, P::INVENTORY_VIEW, P::REGISTER_OPEN,
        ],
        'INVENTORY' => [
            P::INVENTORY_VIEW, P::INVENTORY_ADJUST, P::REPORT_VIEW,
        ],
    ];

    /** @return list<string> */
    public static function for(Role $role): array
    {
        return self::MATRIX[$role->value];
    }

    /** @return list<Role> */
    public static function rolesWith(string $permission): array
    {
        return array_values(array_filter(Role::cases(), fn (Role $r) => in_array($permission, self::MATRIX[$r->value], true)));
    }
}
