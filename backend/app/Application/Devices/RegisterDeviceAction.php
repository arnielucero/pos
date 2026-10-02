<?php

declare(strict_types=1);

namespace App\Application\Devices;

use App\Domain\Audit\AuditLevel;
use App\Domain\Audit\AuditLogger;
use App\Domain\Auth\Exceptions\DeviceStoreMismatchException;
use App\Models\Device;
use App\Models\Store;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/** Idempotent per device uuid. Assigns the next free per-store code (POS-01, POS-02, ...). */
final class RegisterDeviceAction
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** @return array{0: Device, 1: bool} [device, created] */
    public function execute(User $actor, string $uuid, string $name, string $type, ?string $ip): array
    {
        $uuid = strtolower($uuid);
        if (($existing = $this->existing($uuid, $actor)) !== null) {
            return [$existing, false];
        }

        try {
            $device = DB::transaction(function () use ($actor, $uuid, $name, $type) {
                Store::query()->whereKey($actor->store_id)->lockForUpdate()->first(); // serialise code assignment per store
                $codes = Device::query()->where('store_id', $actor->store_id)->pluck('code')->all();
                $n = count($codes) + 1;
                while (in_array($code = sprintf('POS-%02d', $n), $codes, true)) {
                    $n++;
                }

                return Device::create([
                    'uuid' => $uuid,
                    'store_id' => $actor->store_id,
                    'code' => $code,
                    'name' => $name,
                    'type' => $type,
                    'status' => Device::STATUS_ACTIVE,
                    'registered_by' => $actor->id,
                    'registered_at' => CarbonImmutable::now(),
                ]);
            });
        } catch (UniqueConstraintViolationException) {
            $device = $this->existing($uuid, $actor);
            if ($device === null) {
                throw new \RuntimeException('Device registration race could not be resolved.');
            }

            return [$device, false];
        }

        $this->audit->log('DEVICE_REGISTERED', AuditLevel::AUDIT, $actor->store_id, $actor->id, $device->id, 'device', $device->uuid,
            ['code' => $device->code, 'name' => $name, 'type' => $type], ip: $ip);

        return [$device, true];
    }

    private function existing(string $uuid, User $actor): ?Device
    {
        $device = Device::query()->where('uuid', $uuid)->first();
        if ($device !== null && (int) $device->store_id !== (int) $actor->store_id) {
            throw new DeviceStoreMismatchException('This device is registered to a different store.');
        }

        return $device;
    }
}
