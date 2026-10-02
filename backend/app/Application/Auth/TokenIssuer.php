<?php

declare(strict_types=1);

namespace App\Application\Auth;

use App\Models\Device;
use App\Models\PersonalAccessToken;
use App\Models\RefreshToken;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * Issues a device-bound Sanctum access token (12h) plus an opaque refresh token (30d) that is
 * stored only as a SHA-256 hash. Tokens issued from one login share a family id so a reuse of a
 * rotated refresh token (or a logout) can revoke the whole family.
 */
final class TokenIssuer
{
    public function issue(User $user, string $deviceUuid, ?Device $device, ?string $familyId = null): IssuedTokens
    {
        $familyId ??= (string) Str::uuid();
        $now = CarbonImmutable::now();
        $accessExpiresAt = $now->addMinutes((int) config('pos.auth.access_token_ttl_minutes'));
        $refreshExpiresAt = $now->addDays((int) config('pos.auth.refresh_token_ttl_days'));

        $access = $user->createToken('pos-device', ['*'], $accessExpiresAt);
        $access->accessToken->forceFill(['device_uuid' => strtolower($deviceUuid), 'refresh_family_id' => $familyId])->save();

        $plainRefresh = Str::random(64);
        $refresh = RefreshToken::create([
            'token_hash' => self::hash($plainRefresh),
            'family_id' => $familyId,
            'user_id' => $user->id,
            'device_id' => $device?->id,
            'device_uuid' => strtolower($deviceUuid),
            'access_token_id' => $access->accessToken->getKey(),
            'expires_at' => $refreshExpiresAt,
        ]);

        return new IssuedTokens($access->plainTextToken, $accessExpiresAt, $plainRefresh, $refreshExpiresAt, (int) $refresh->id);
    }

    public function revokeFamily(string $familyId): void
    {
        RefreshToken::query()->where('family_id', $familyId)->whereNull('revoked_at')->update(['revoked_at' => CarbonImmutable::now()]);
        PersonalAccessToken::query()->where('refresh_family_id', $familyId)->delete();
    }

    public function revokeDevice(string $deviceUuid): void
    {
        RefreshToken::query()->where('device_uuid', strtolower($deviceUuid))->whereNull('revoked_at')->update(['revoked_at' => CarbonImmutable::now()]);
        PersonalAccessToken::query()->where('device_uuid', strtolower($deviceUuid))->delete();
    }

    public static function hash(string $plain): string
    {
        return hash('sha256', $plain);
    }
}
