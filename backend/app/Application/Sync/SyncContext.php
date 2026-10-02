<?php

declare(strict_types=1);

namespace App\Application\Sync;

use App\Models\Device;
use App\Models\Store;
use App\Models\User;
use Carbon\CarbonImmutable;

/** Who is uploading, from which device, and when the server received it. */
final readonly class SyncContext
{
    public function __construct(
        public User $user,
        public Device $device,
        public Store $store,
        public CarbonImmutable $receivedAt,
        public ?string $ip = null,
    ) {}

    public function storeId(): int
    {
        return (int) $this->store->id;
    }
}
