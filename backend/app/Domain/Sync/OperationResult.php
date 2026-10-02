<?php

declare(strict_types=1);

namespace App\Domain\Sync;

use App\Domain\Sales\Conflict;
use App\Domain\Shared\Exceptions\DomainException;

/** Per-operation result, shaped exactly like docs/API.md `POST /sync` results[]. */
final readonly class OperationResult
{
    /**
     * @param  list<array<string, mixed>>  $conflicts
     * @param  array{code: string, message: string, details?: array<string, mixed>}|null  $error
     */
    public function __construct(
        public OperationStatus $status,
        public int $httpStatus,
        public ?string $entityUuid = null,
        public ?int $serverId = null,
        public array $conflicts = [],
        public ?array $error = null,
        public bool $retryable = false,
        public ?string $originalStatus = null,
    ) {}

    /** @param list<Conflict> $conflicts */
    public static function stored(string $entityUuid, int $serverId, array $conflicts = []): self
    {
        return new self(
            status: $conflicts === [] ? OperationStatus::APPLIED : OperationStatus::FLAGGED,
            httpStatus: 201,
            entityUuid: $entityUuid,
            serverId: $serverId,
            conflicts: array_map(fn (Conflict $c) => $c->toArray(), $conflicts),
        );
    }

    public static function rejected(DomainException $e): self
    {
        $error = ['code' => $e->errorCode(), 'message' => $e->getMessage()];
        if ($e->details() !== []) {
            $error['details'] = $e->details();
        }

        return new self(OperationStatus::REJECTED, $e->httpStatus(), error: $error, retryable: $e->retryable());
    }

    public static function serverError(): self
    {
        return new self(OperationStatus::REJECTED, 500, error: ['code' => 'SERVER_ERROR', 'message' => 'Unexpected server error.'], retryable: true);
    }

    /** Replay of a stored result: "returns the original result" with status DUPLICATE. */
    public static function duplicateOf(array $stored): self
    {
        return new self(
            status: OperationStatus::DUPLICATE,
            httpStatus: 200,
            entityUuid: $stored['entity_uuid'] ?? null,
            serverId: $stored['server_id'] ?? null,
            conflicts: $stored['conflicts'] ?? [],
            originalStatus: $stored['status'] ?? null,
        );
    }

    public function isStored(): bool
    {
        return in_array($this->status, [OperationStatus::APPLIED, OperationStatus::FLAGGED, OperationStatus::DUPLICATE], true);
    }

    /** @return array<string, mixed> */
    public function toArray(?string $idempotencyKey = null): array
    {
        $out = [
            'idempotency_key' => $idempotencyKey,
            'status' => $this->status->value,
            'http_status' => $this->httpStatus,
            'entity_uuid' => $this->entityUuid,
            'server_id' => $this->serverId,
            'conflicts' => $this->conflicts,
            'error' => $this->error,
            'retryable' => $this->retryable,
        ];
        if ($this->originalStatus !== null) {
            $out['original_status'] = $this->originalStatus;
        }

        return $out;
    }
}
