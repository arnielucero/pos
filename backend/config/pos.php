<?php

declare(strict_types=1);

return [
    'auth' => [
        'access_token_ttl_minutes' => (int) env('POS_ACCESS_TOKEN_TTL_MINUTES', 720),
        'refresh_token_ttl_days' => (int) env('POS_REFRESH_TOKEN_TTL_DAYS', 30),
        // bcrypt cost for approver PINs (shipped to devices in /sync/pull, so it must be slow).
        'pin_bcrypt_rounds' => (int) env('POS_PIN_BCRYPT_ROUNDS', 12),
    ],

    'offline_policy' => [
        'max_offline_hours' => 72,
        'max_failed_attempts' => 5,
    ],

    'rate_limits' => [
        'login_per_minute' => (int) env('POS_LOGIN_RATE_LIMIT', 5),
        'api_per_minute' => 120,
        'sync_per_minute' => 60,
    ],

    'sync' => [
        'max_operations' => 50,
        'pull_page_size' => 500,
        'max_audit_events' => 500,
    ],

    // Defaults; per-store overrides live in stores.settings (JSON).
    'settings' => [
        'tax_rate_bp' => 1200,
        'currency' => 'PHP',
        'receipt_header' => null, // null => "HMR POS\n{store code}"
        'receipt_footer' => 'Thank you!',
        'max_discount_bp' => 5000,
        'offline_max_hours' => 72,
    ],
];
