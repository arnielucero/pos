<?php

declare(strict_types=1);

namespace App\Domain\Sales;

/** A reason a stored operation needs manager review (status FLAGGED). */
final readonly class Conflict
{
    public function __construct(
        public ConflictType $type,
        public string $entityType,
        public string $entityUuid,
        public mixed $localValue,
        public mixed $serverValue,
        public string $message,
    ) {}

    /** @return array{type: string, entity_type: string, entity_uuid: string, local_value: mixed, server_value: mixed, message: string} */
    public function toArray(): array
    {
        return [
            'type' => $this->type->value,
            'entity_type' => $this->entityType,
            'entity_uuid' => $this->entityUuid,
            'local_value' => $this->localValue,
            'server_value' => $this->serverValue,
            'message' => $this->message,
        ];
    }
}
