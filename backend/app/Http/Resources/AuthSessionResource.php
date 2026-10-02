<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Application\Auth\AuthSession;
use App\Application\Shared\StoreSettings;
use App\Support\Iso;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** Response of /auth/login and /auth/refresh. */
final class AuthSessionResource extends JsonResource
{
    public static $wrap = null;

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var AuthSession $s */
        $s = $this->resource;
        $settings = app(StoreSettings::class)->for($s->user->store);

        return [
            'access_token' => $s->tokens->accessToken,
            'access_expires_at' => Iso::format($s->tokens->accessExpiresAt),
            'refresh_token' => $s->tokens->refreshToken,
            'refresh_expires_at' => Iso::format($s->tokens->refreshExpiresAt),
            'user' => (new UserResource($s->user))->toArray($request),
            'device' => $s->device === null ? null : [
                'uuid' => $s->device->uuid, 'code' => $s->device->code, 'status' => $s->device->status,
            ],
            'offline_policy' => [
                'max_offline_hours' => $settings['offline_max_hours'],
                'max_failed_attempts' => (int) config('pos.offline_policy.max_failed_attempts'),
            ],
            'server_time' => Iso::now(),
        ];
    }
}
