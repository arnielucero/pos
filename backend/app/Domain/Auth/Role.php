<?php

declare(strict_types=1);

namespace App\Domain\Auth;

enum Role: string
{
    case ADMIN = 'ADMIN';
    case MANAGER = 'MANAGER';
    case SUPERVISOR = 'SUPERVISOR';
    case CASHIER = 'CASHIER';
    case INVENTORY = 'INVENTORY';
}
