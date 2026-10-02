<?php

declare(strict_types=1);

namespace App\Application\Auth;

use Carbon\CarbonImmutable;

final readonly class IssuedTokens
{
    public function __construct(
        public string $accessToken,
        public CarbonImmutable $accessExpiresAt,
        public string $refreshToken,
        public CarbonImmutable $refreshExpiresAt,
        public int $refreshTokenId,
    ) {}
}
