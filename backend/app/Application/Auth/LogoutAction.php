<?php

declare(strict_types=1);

namespace App\Application\Auth;

use App\Domain\Audit\AuditLevel;
use App\Domain\Audit\AuditLogger;
use App\Models\PersonalAccessToken;
use App\Models\User;

final class LogoutAction
{
    public function __construct(private readonly TokenIssuer $issuer, private readonly AuditLogger $audit) {}

    public function execute(User $user, PersonalAccessToken $token, ?int $deviceId, ?string $ip): void
    {
        if ($token->refresh_family_id !== null) {
            $this->issuer->revokeFamily($token->refresh_family_id);
        }
        $token->delete();

        $this->audit->log('LOGOUT', AuditLevel::AUDIT, $user->store_id, $user->id, $deviceId, 'user', $user->uuid,
            ['device_uuid' => $token->device_uuid], ip: $ip);
    }
}
