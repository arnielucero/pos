<?php

declare(strict_types=1);

namespace App\Domain\Auth;

/** Permission names exactly as published in docs/API.md. */
final class Permission
{
    public const SALE_CREATE = 'sale.create';

    public const SALE_VOID = 'sale.void';

    public const SALE_REFUND = 'sale.refund';

    public const SALE_REPRINT = 'sale.reprint';

    public const DISCOUNT_APPLY = 'discount.apply';

    public const PRICE_OVERRIDE = 'price.override';

    public const INVENTORY_VIEW = 'inventory.view';

    public const INVENTORY_ADJUST = 'inventory.adjust';

    public const PRODUCT_EDIT = 'product.edit';

    public const REPORT_VIEW = 'report.view';

    public const REGISTER_OPEN = 'register.open';

    public const REGISTER_CLOSE = 'register.close';

    public const SETTINGS_EDIT = 'settings.edit';

    public const DEVICE_REGISTER = 'device.register';

    public const APPROVAL_GRANT = 'approval.grant';

    public const SYNC_DIAGNOSTICS = 'sync.diagnostics';

    /** @return list<string> */
    public static function all(): array
    {
        return array_values((new \ReflectionClass(self::class))->getConstants());
    }
}
