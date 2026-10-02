<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Auth\Exceptions\UnauthenticatedException;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Access tokens are bound to the X-Device-Id they were issued for; any other device id -> 401. */
final class EnsureTokenBoundToDevice
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $token = $user?->currentAccessToken();
        $header = strtolower((string) $request->header('X-Device-Id', ''));

        if (! $user instanceof User || ! $token instanceof PersonalAccessToken || ! $user->is_active
            || $token->device_uuid === null || $header === '' || ! hash_equals($token->device_uuid, $header)) {
            throw new UnauthenticatedException;
        }

        return $next($request);
    }
}
