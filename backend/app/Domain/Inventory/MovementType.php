<?php

declare(strict_types=1);

namespace App\Domain\Inventory;

enum MovementType: string
{
    case STOCK_IN = 'STOCK_IN';
    case STOCK_OUT = 'STOCK_OUT';
    case SALE = 'SALE';
    case RETURN = 'RETURN';
    case ADJUSTMENT = 'ADJUSTMENT';
    case TRANSFER = 'TRANSFER';
    case VOID = 'VOID';
}
