<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Models\Payment;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SyncConflict;
use App\Support\Iso;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Sale */
final class SaleResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var Sale $s */
        $s = $this->resource;
        $s->loadMissing(['items.product', 'payments', 'void.voidedBy', 'conflicts', 'cashier', 'device']);

        return [
            'uuid' => $s->uuid,
            'server_id' => $s->id,
            'receipt_number' => $s->receipt_number,
            'client_receipt_number' => $s->client_receipt_number,
            'status' => $s->status,
            'cashier' => ['uuid' => $s->cashier->uuid, 'name' => $s->cashier->name],
            'device' => ['uuid' => $s->device->uuid, 'code' => $s->device->code],
            'register_session_uuid' => $s->register_session_uuid,
            'subtotal' => $s->subtotal,
            'discount_total' => $s->discount_total,
            'order_discount' => $s->order_discount_type === null ? null : [
                'type' => $s->order_discount_type, 'value' => $s->order_discount_value, 'amount' => $s->order_discount_amount,
            ],
            'tax_total' => $s->tax_total,
            'tax_rate_bp' => $s->tax_rate_bp,
            'total' => $s->total,
            'created_at' => Iso::format($s->client_created_at),
            'catalog_synced_at' => Iso::format($s->catalog_synced_at),
            'received_at' => Iso::format($s->received_at),
            'items' => $s->items->map(fn (SaleItem $i) => [
                'uuid' => $i->uuid,
                'product_uuid' => $i->product?->uuid,
                'sku' => $i->sku,
                'name' => $i->product_name,
                'quantity' => $i->quantity,
                'unit_price' => $i->unit_price,
                'server_unit_price' => $i->server_unit_price,
                'discount' => $i->discount_type === null ? null : ['type' => $i->discount_type, 'value' => $i->discount_value],
                'line_gross' => $i->line_gross,
                'line_discount' => $i->line_discount,
                'line_total' => $i->line_total,
            ])->values()->all(),
            'payments' => $s->payments->map(fn (Payment $p) => [
                'uuid' => $p->uuid, 'method' => $p->method, 'amount' => $p->amount, 'tendered' => $p->tendered,
                'change' => $p->change_amount, 'reference' => $p->reference,
            ])->values()->all(),
            'void' => $s->void === null ? null : [
                'uuid' => $s->void->uuid, 'reason' => $s->void->reason, 'voided_at' => Iso::format($s->void->voided_at),
                'voided_by_uuid' => $s->void->voidedBy?->uuid,
            ],
            'conflicts' => $s->conflicts->map(fn (SyncConflict $c) => [
                'type' => $c->conflict_type, 'entity_type' => $c->entity_type, 'entity_uuid' => $c->entity_uuid,
                'local_value' => $c->local_payload['value'] ?? null, 'server_value' => $c->server_payload['value'] ?? null,
                'message' => $c->message, 'resolution_status' => $c->resolution_status,
            ])->values()->all(),
        ];
    }
}
