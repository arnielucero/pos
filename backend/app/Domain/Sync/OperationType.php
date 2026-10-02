<?php

declare(strict_types=1);

namespace App\Domain\Sync;

enum OperationType: string
{
    case CREATE_SALE = 'CREATE_SALE';
    case VOID_SALE = 'VOID_SALE';
    case ADJUST_INVENTORY = 'ADJUST_INVENTORY';
    case OPEN_REGISTER = 'OPEN_REGISTER';
    case CLOSE_REGISTER = 'CLOSE_REGISTER';
    case AUDIT_EVENTS = 'AUDIT_EVENTS';

    /** Whether the op's idempotency key must equal payload.uuid. */
    public function keyIsPayloadUuid(): bool
    {
        return $this !== self::AUDIT_EVENTS;
    }
}
