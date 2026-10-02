<?php

declare(strict_types=1);

namespace App\Application\Sales;

use App\Application\Shared\ApprovalRules;

/** Step 1 of CREATE_SALE validation (schema). Shared by POST /sales and POST /sync. */
final class CreateSalePayloadRules
{
    public const MAX_MONEY = 1_000_000_000_000; // ₱10B in centavos; keeps all products < PHP_INT_MAX

    /** @return array<string, mixed> */
    public static function rules(): array
    {
        $money = ['required', 'integer:strict', 'min:0', 'max:'.self::MAX_MONEY];

        return [
            'uuid' => ['required', 'uuid'],
            'receipt_number' => ['required', 'string', 'max:48', 'regex:/^[A-Za-z0-9_\-]+$/'],
            'cashier_uuid' => ['required', 'uuid'],
            'register_session_uuid' => ['nullable', 'uuid'],
            'created_at' => ['required', 'date'],
            'catalog_synced_at' => ['nullable', 'date'],

            'items' => ['required', 'array', 'min:1', 'max:500'],
            'items.*' => ['required', 'array'],
            'items.*.uuid' => ['required', 'uuid', 'distinct'],
            'items.*.product_uuid' => ['required', 'uuid'],
            'items.*.quantity' => ['required', 'integer:strict', 'min:1', 'max:100000'],
            'items.*.unit_price' => $money,
            'items.*.discount' => ['nullable', 'array'],
            'items.*.discount.type' => ['required_with:items.*.discount', 'in:PERCENT,AMOUNT'],
            'items.*.discount.value' => ['required_with:items.*.discount', 'integer:strict', 'min:0', 'max:'.self::MAX_MONEY],
            ...ApprovalRules::for('items.*.discount.approval'),
            'items.*.price_override' => ['nullable', 'array'],
            'items.*.price_override.original_price' => ['required_with:items.*.price_override', 'integer:strict', 'min:0'],
            ...ApprovalRules::for('items.*.price_override.approval'),
            'items.*.line_gross' => $money,
            'items.*.line_discount' => $money,
            'items.*.line_total' => $money,

            'order_discount' => ['nullable', 'array'],
            'order_discount.type' => ['required_with:order_discount', 'in:PERCENT,AMOUNT'],
            'order_discount.value' => ['required_with:order_discount', 'integer:strict', 'min:0', 'max:'.self::MAX_MONEY],
            ...ApprovalRules::for('order_discount.approval'),

            'subtotal' => $money,
            'discount_total' => $money,
            'tax_total' => $money,
            'total' => $money,

            'payments' => ['present', 'array', 'max:20'],
            'payments.*' => ['required', 'array'],
            'payments.*.uuid' => ['required', 'uuid', 'distinct'],
            'payments.*.method' => ['required', 'in:CASH,GCASH,CARD'],
            'payments.*.amount' => $money,
            'payments.*.tendered' => $money,
            'payments.*.change' => $money,
            'payments.*.reference' => ['nullable', 'required_unless:payments.*.method,CASH', 'string', 'max:128'],
        ];
    }

    /**
     * Semantic schema checks Laravel rules cannot express.
     *
     * @param  array<string, mixed>  $sale
     * @return array<string, list<string>>
     */
    public static function extraErrors(array $sale): array
    {
        $errors = [];
        foreach ($sale['items'] as $i => $item) {
            if (($item['discount']['type'] ?? null) === 'PERCENT' && (int) $item['discount']['value'] > 10000) {
                $errors["items.$i.discount.value"] = ['Percent discounts must be between 0 and 10000 basis points.'];
            }
        }
        if (($sale['order_discount']['type'] ?? null) === 'PERCENT' && (int) $sale['order_discount']['value'] > 10000) {
            $errors['order_discount.value'] = ['Percent discounts must be between 0 and 10000 basis points.'];
        }

        return $errors;
    }
}
