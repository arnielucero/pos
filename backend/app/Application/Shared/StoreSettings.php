<?php

declare(strict_types=1);

namespace App\Application\Shared;

use App\Models\Store;

/** Config defaults (config/pos.php) overlaid with per-store overrides (stores.settings). */
final class StoreSettings
{
    /** @return array{tax_rate_bp: int, currency: string, receipt_header: string, receipt_footer: string, max_discount_bp: int, offline_max_hours: int} */
    public function for(Store $store): array
    {
        $settings = array_merge((array) config('pos.settings'), array_filter((array) ($store->settings ?? []), fn ($v) => $v !== null));
        $settings['receipt_header'] ??= "HMR POS\n{$store->code}";

        return [
            'tax_rate_bp' => (int) $settings['tax_rate_bp'],
            'currency' => (string) $settings['currency'],
            'receipt_header' => (string) $settings['receipt_header'],
            'receipt_footer' => (string) $settings['receipt_footer'],
            'max_discount_bp' => (int) $settings['max_discount_bp'],
            'offline_max_hours' => (int) $settings['offline_max_hours'],
        ];
    }
}
