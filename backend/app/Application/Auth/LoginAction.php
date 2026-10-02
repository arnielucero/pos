<?php

declare(strict_types=1);

namespace App\Application\Auth;

use App\Domain\Audit\AuditLevel;
use App\Domain\Audit\AuditLogger;
use App\Domain\Auth\Exceptions\InvalidCredentialsException;
use App\Domain\Shared\Exceptions\DomainException;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

final class LoginAction
{
    private static ?string $dummyHash = null;

    public function __construct(
        private readonly TokenIssuer $issuer,
        private readonly DeviceGate $devices,
        private readonly AuditLogger $audit,
    ) {}

    public function execute(string $email, string $password, string $deviceUuid, ?string $ip): AuthSession
    {
        $user = User::query()->where('email', mb_strtolower(trim($email)))->first();

        // Always run one hash check so unknown emails take as long as wrong passwords (no enumeration).
        $valid = Hash::check($password, $user?->password ?? self::dummyHash());

        if ($user === null || ! $valid || ! $user->is_active) {
            $this->audit->log('LOGIN_FAILED', AuditLevel::SECURITY, $user?->store_id, $user?->id, null, 'user', $user?->uuid,
                ['email' => mb_substr($email, 0, 191), 'device_uuid' => $deviceUuid, 'reason' => 'INVALID_CREDENTIALS'], ip: $ip);

            throw new InvalidCredentialsException;
        }

        try {
            $device = $this->devices->forSignIn($deviceUuid, $user);
        } catch (DomainException $e) {
            $this->audit->log('LOGIN_FAILED', AuditLevel::SECURITY, $user->store_id, $user->id, null, 'user', $user->uuid,
                ['device_uuid' => $deviceUuid, 'reason' => $e->errorCode()], ip: $ip);

            throw $e;
        }

        $tokens = $this->issuer->issue($user, $deviceUuid, $device);
        $this->audit->log('LOGIN', AuditLevel::AUDIT, $user->store_id, $user->id, $device?->id, 'user', $user->uuid,
            ['device_uuid' => $deviceUuid, 'device_registered' => $device !== null], ip: $ip);

        return new AuthSession($user, $device, $tokens);
    }

    private static function dummyHash(): string
    {
        return self::$dummyHash ??= Hash::make('timing-equaliser-'.bin2hex(random_bytes(8)));
    }
}
