<?php

declare(strict_types=1);

namespace App\Application\Auth;

use App\Domain\Auth\Exceptions\DeviceDisabledException;
use App\Domain\Auth\Exceptions\DeviceNotRegisteredException;
use App\Domain\Auth\Exceptions\DeviceStoreMismatchException;
use App\Domain\Auth\Permission;
use App\Domain\Auth\PermissionResolver;
use App\Models\Device;
use App\Models\User;

/** Device rules shared by login, refresh and the device middleware. */
final class DeviceGate
{
    public function __construct(private readonly PermissionResolver $permissions) {}

    /** Registered, same store, ACTIVE - or throws the contract's 403 code. */
    public function requireUsable(?Device $device, User $user): Device
    {
        if ($device === null) {
            throw new DeviceNotRegisteredException;
        }
        if ((int) $device->store_id !== (int) $user->store_id) {
            throw new DeviceStoreMismatchException;
        }
        if (! $device->isActive()) {
            throw new DeviceDisabledException;
        }

        return $device;
    }

    /** For login/refresh: an unregistered device is allowed only for users who can register it. */
    public function forSignIn(string $deviceUuid, User $user): ?Device
    {
        $device = Device::query()->where('uuid', strtolower($deviceUuid))->first();
        if ($device === null && $this->permissions->has($user, Permission::DEVICE_REGISTER)) {
            return null;
        }

        return $this->requireUsable($device, $user);
    }
}
