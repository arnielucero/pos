<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RegisterClosure extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'uuid', 'register_session_id', 'store_id', 'closed_by', 'approved_by', 'closed_at', 'actual_cash',
        'client_expected_cash', 'client_cash_sales', 'client_cash_refunds', 'client_cash_adjustments', 'client_variance',
        'server_expected_cash', 'server_cash_sales', 'server_variance', 'status', 'synced_by',
    ];

    protected function casts(): array
    {
        return ['closed_at' => 'datetime'];
    }
}
