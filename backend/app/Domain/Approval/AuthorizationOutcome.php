<?php

declare(strict_types=1);

namespace App\Domain\Approval;

use App\Models\User;

final readonly class AuthorizationOutcome
{
    /** @param array<string, mixed>|null $approval */
    public function __construct(public User $actor, public ?User $approver, public ?array $approval) {}

    public function usedApproval(): bool
    {
        return $this->approver !== null;
    }

    public function mode(): ?string
    {
        return $this->approval['mode'] ?? null;
    }
}
