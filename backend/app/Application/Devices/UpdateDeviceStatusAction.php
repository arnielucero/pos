<?php

declare(strict_types=1);

namespace App\Application\Devices;

use App\Application\Auth\TokenIssuer;
use App\Domain\Audit\AuditLevel;
use App\Domain\Audit\AuditLogger;
use App\Domain\Shared\Exceptions\NotFoundException;
use App\Models\Device;
use App\Models\User;

final class UpdateDeviceStatusAction
{
    public function __construct(private readonly TokenIssuer $issuer, private readonly AuditLogger $audit) {}

    public function execute(User $actor, string $uuid, string $status, ?string $ip): Device
    {
        $device = Device::query()->where('store_id', $actor->store_id)->where('uuid', strtolower($uuid))->first()
            ?? throw new NotFoundException('Device not found.');

        $previous = $device->status;
        $device->status = $status;
        $device->save();

        if ($status === Device::STATUS_DISABLED) {
            $this->issuer->revokeDevice($device->uuid); // a disabled (e.g. stolen) device loses all sessions
        }

        $this->audit->log('DEVICE_STATUS_CHANGED', AuditLevel::SECURITY, $actor->store_id, $actor->id, $device->id, 'device', $device->uuid,
            ['from' => $previous, 'to' => $status], ip: $ip);

        return $device;
    }
}
