<?php

declare(strict_types=1);

namespace App\Domain\Audit;

enum AuditLevel: string
{
    case INFO = 'INFO';
    case WARNING = 'WARNING';
    case SECURITY = 'SECURITY';
    case AUDIT = 'AUDIT';
}
