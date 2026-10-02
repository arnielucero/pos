<?php

declare(strict_types=1);

namespace App\Application\Auth;

use App\Models\Device;
use App\Models\User;

final readonly class AuthSession
{
    public function __construct(public User $user, public ?Device $device, public IssuedTokens $tokens) {}
}
