<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Sale extends Model
{
    public const STATUS_COMPLETED = 'COMPLETED';

    public const STATUS_FLAGGED = 'FLAGGED';

    public const STATUS_VOIDED = 'VOIDED';

    /** Money columns: written once on insert, never updated. */
    public const IMMUTABLE = [
        'subtotal', 'discount_total', 'order_discount_type', 'order_discount_value', 'order_discount_amount',
        'tax_total', 'tax_rate_bp', 'total', 'cash_change', 'receipt_number', 'uuid', 'store_id',
    ];

    protected $fillable = [
        'uuid', 'store_id', 'device_id', 'cashier_id', 'synced_by', 'register_session_id', 'register_session_uuid',
        'receipt_number', 'client_receipt_number', 'status', 'subtotal', 'discount_total', 'order_discount_type',
        'order_discount_value', 'order_discount_amount', 'order_discount_approval', 'tax_total', 'tax_rate_bp',
        'total', 'cash_change', 'client_created_at', 'catalog_synced_at', 'received_at', 'payload_hash',
    ];

    protected function casts(): array
    {
        return [
            'client_created_at' => 'datetime',
            'catalog_synced_at' => 'datetime',
            'received_at' => 'datetime',
            'order_discount_approval' => 'array',
            'subtotal' => 'integer', 'discount_total' => 'integer', 'order_discount_amount' => 'integer',
            'order_discount_value' => 'integer', 'tax_total' => 'integer', 'total' => 'integer',
            'tax_rate_bp' => 'integer', 'cash_change' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (Sale $sale): void {
            if ($sale->isDirty(self::IMMUTABLE)) {
                throw new \LogicException('Sale financial columns are immutable.');
            }
        });
        static::deleting(fn () => throw new \LogicException('Sales cannot be deleted.'));
    }

    /** @return HasMany<SaleItem, $this> */
    public function items(): HasMany
    {
        return $this->hasMany(SaleItem::class);
    }

    /** @return HasMany<Payment, $this> */
    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    /** @return HasOne<SaleVoid, $this> */
    public function void(): HasOne
    {
        return $this->hasOne(SaleVoid::class);
    }

    /** @return HasMany<SyncConflict, $this> */
    public function conflicts(): HasMany
    {
        return $this->hasMany(SyncConflict::class, 'reference_uuid', 'uuid')->where('reference_type', 'sale');
    }

    /** @return BelongsTo<User, $this> */
    public function cashier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cashier_id');
    }

    /** @return BelongsTo<Device, $this> */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}
