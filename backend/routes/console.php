<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Schedule;

// Remove expired Sanctum access tokens (kept 24h after expiry so TOKEN_EXPIRED can still be reported).
Schedule::command('sanctum:prune-expired --hours=24')->daily();
