<?php

declare(strict_types=1);

namespace App\Application\Auth;

use App\Domain\Audit\AuditLevel;
use App\Domain\Audit\AuditLogger;
use App\Domain\Auth\Exceptions\UnauthenticatedException;
use App\Domain\Shared\Exceptions\DomainException;
use App\Models\PersonalAccessToken;
use App\Models\RefreshToken;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Single-use refresh with rotation; presenting an already-rotated token revokes the whole family. */
final class RefreshAccessTokenAction
{
    public function __construct(
        private readonly TokenIssuer $issuer,
        private readonly DeviceGate $devices,
        private readonly AuditLogger $audit,
    ) {}

    public function execute(string $plainRefreshToken, string $deviceUuid, ?string $ip): AuthSession
    {
        /** @var AuthSession|DomainException $outcome */
        $outcome = DB::transaction(function () use ($plainRefreshToken, $deviceUuid, $ip) {
            /** @var RefreshToken|null $token */
            $token = RefreshToken::query()->where('token_hash', TokenIssuer::hash($plainRefreshToken))->lockForUpdate()->first();
            if ($token === null) {
                return new UnauthenticatedException('Invalid refresh token.');
            }

            if ($token->revoked_at !== null) {
                if ($token->replaced_by !== null) {
                    // Reuse of a rotated token: assume theft, kill every token of this login.
                    $this->issuer->revokeFamily($token->family_id);
                    $this->audit->log('REFRESH_TOKEN_REUSE', AuditLevel::SECURITY, $token->user?->store_id, $token->user_id, $token->device_id,
                        'user', $token->user?->uuid, ['family_id' => $token->family_id, 'device_uuid' => $deviceUuid], ip: $ip);
                }

                return new UnauthenticatedException('Invalid refresh token.');
            }

            if ($token->expires_at->isPast()) {
                return new UnauthenticatedException('Refresh token expired.');
            }

            $user = $token->user;
            if (! hash_equals($token->device_uuid, strtolower($deviceUuid)) || $user === null || ! $user->is_active) {
                $this->issuer->revokeFamily($token->family_id);
                $this->audit->log('REFRESH_TOKEN_REJECTED', AuditLevel::SECURITY, $user?->store_id, $token->user_id, $token->device_id,
                    'user', $user?->uuid, ['reason' => 'device mismatch or inactive user', 'device_uuid' => $deviceUuid], ip: $ip);

                return new UnauthenticatedException('Invalid refresh token.');
            }

            try {
                $device = $this->devices->forSignIn($deviceUuid, $user);
            } catch (DomainException $e) {
                return $e;
            }

            $tokens = $this->issuer->issue($user, $deviceUuid, $device, $token->family_id);
            $token->forceFill(['revoked_at' => CarbonImmutable::now(), 'replaced_by' => $tokens->refreshTokenId])->save();
            if ($token->access_token_id !== null) {
                PersonalAccessToken::query()->whereKey($token->access_token_id)->delete();
            }

            return new AuthSession($user, $device, $tokens);
        });

        // Throw after commit so revocations made above are persisted.
        if ($outcome instanceof DomainException) {
            throw $outcome;
        }

        return $outcome;
    }
}
