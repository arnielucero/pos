<?php

declare(strict_types=1);

namespace App\Http;

use App\Application\Sync\SyncContext;
use App\Models\Device;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use LogicException;

/** Typed access to what the POS middleware resolved for the current request. */
final class RequestContext
{
    public const DEVICE = 'pos.device';

    public static function user(Request $request): User
    {
        $user = $request->user();
        if (! $user instanceof User) {
            throw new LogicException('No authenticated user.');
        }

        return $user;
    }

    public static function device(Request $request): Device
    {
        $device = $request->attributes->get(self::DEVICE);
        if (! $device instanceof Device) {
            throw new LogicException('EnsureDeviceIsActive middleware did not run.');
        }

        return $device;
    }

    public static function optionalDevice(Request $request): ?Device
    {
        $device = $request->attributes->get(self::DEVICE);

        return $device instanceof Device ? $device : null;
    }

    public static function sync(Request $request): SyncContext
    {
        $user = self::user($request);
        $user->loadMissing('store');

        return new SyncContext($user, self::device($request), $user->store, CarbonImmutable::now(), $request->ip());
    }
}
