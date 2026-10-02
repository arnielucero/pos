<?php

declare(strict_types=1);

namespace App\Domain\Sync;

enum OperationStatus: string
{
    case APPLIED = 'APPLIED';
    case DUPLICATE = 'DUPLICATE';
    case FLAGGED = 'FLAGGED';
    case REJECTED = 'REJECTED';
}
