<?php

declare(strict_types=1);

return [
    // Only the versioned API is exposed cross-origin. Bearer tokens, no cookies.
    'paths' => ['api/*'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('CORS_ALLOWED_ORIGINS', 'http://localhost:5173,https://localhost,capacitor://localhost'))
    ))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['Authorization', 'Content-Type', 'Accept', 'X-Device-Id', 'Idempotency-Key', 'X-Requested-With'],

    'exposed_headers' => ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],

    'max_age' => 600,

    'supports_credentials' => false,
];
