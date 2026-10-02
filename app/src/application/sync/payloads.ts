import { toApprovalPayload, type Approval } from '../../domain/entities/Approval';
import type { AuditEvent } from '../../domain/entities/Audit';
import type { InventoryMovement } from '../../domain/entities/Inventory';
import type { RegisterSession } from '../../domain/entities/Register';
import type { Sale } from '../../domain/entities/Sale';

/**
 * Builders for the snake_case sync payloads defined in docs/API.md. For every op except
 * AUDIT_EVENTS the queue idempotency key MUST equal payload.uuid (backend rejects otherwise).
 * The payload is built ONCE
 * when the operation is enqueued and stored verbatim in sync_queue.payload, so every retry
 * sends byte-identical content with the same idempotency key.
 */
export function createSalePayload(sale: Sale): Record<string, unknown> {
  return {
    uuid: sale.uuid,
    receipt_number: sale.receiptNumber,
    cashier_uuid: sale.cashierUuid,
    register_session_uuid: sale.registerSessionUuid,
    created_at: sale.createdAt,
    catalog_synced_at: sale.catalogSyncedAt,
    items: sale.items.map((i) => ({
      uuid: i.uuid,
      product_uuid: i.productUuid,
      quantity: i.quantity,
      unit_price: i.unitPrice,
      // NOTE (contract deviation, see docs/_app_notes.md): API.md has no approval slot for line
      // discounts; we send it inside the discount object so the server can validate step 6.
      discount: i.discount
        ? { type: i.discount.type, value: i.discount.value, approval: toApprovalPayload(i.discount.approval) }
        : null,
      price_override: null,
      line_gross: i.lineGross,
      line_discount: i.lineDiscount,
      line_total: i.lineTotal,
    })),
    order_discount: sale.orderDiscount
      ? {
          type: sale.orderDiscount.type,
          value: sale.orderDiscount.value,
          approval: toApprovalPayload(sale.orderDiscount.approval),
        }
      : null,
    subtotal: sale.subtotal,
    discount_total: sale.discountTotal,
    tax_total: sale.taxTotal,
    total: sale.total,
    payments: sale.payments.map((p) => ({
      uuid: p.uuid,
      method: p.method,
      amount: p.amount,
      tendered: p.tendered,
      change: p.change,
      reference: p.reference,
    })),
  };
}

export function voidSalePayload(input: {
  uuid: string;
  saleUuid: string;
  reason: string;
  voidedAt: string;
  voidedByUuid: string;
  approval: Approval | null;
}): Record<string, unknown> {
  return {
    uuid: input.uuid,
    sale_uuid: input.saleUuid,
    reason: input.reason,
    voided_at: input.voidedAt,
    voided_by_uuid: input.voidedByUuid,
    approval: toApprovalPayload(input.approval),
  };
}

export function adjustInventoryPayload(
  movement: InventoryMovement,
  adjustedByUuid: string,
  approval: Approval | null,
): Record<string, unknown> {
  return {
    uuid: movement.uuid,
    product_uuid: movement.productUuid,
    type: movement.type,
    quantity: movement.quantity,
    reason: movement.reason,
    adjusted_by_uuid: adjustedByUuid,
    created_at: movement.createdAt,
    approval: toApprovalPayload(approval),
  };
}

export function openRegisterPayload(session: RegisterSession, approval: Approval | null = null): Record<string, unknown> {
  return {
    uuid: session.uuid,
    opened_by_uuid: session.openedByUuid,
    opened_at: session.openedAt,
    opening_cash: session.openingCash,
    approval: toApprovalPayload(approval),
  };
}

export function closeRegisterPayload(input: {
  uuid: string;
  sessionUuid: string;
  closedByUuid: string;
  closedAt: string;
  actualCash: number;
  expectedCash: number;
  cashSales: number;
  cashRefunds: number;
  cashAdjustments: number;
  variance: number;
  approval: Approval | null;
}): Record<string, unknown> {
  return {
    uuid: input.uuid,
    session_uuid: input.sessionUuid,
    closed_by_uuid: input.closedByUuid,
    closed_at: input.closedAt,
    actual_cash: input.actualCash,
    expected_cash: input.expectedCash,
    cash_sales: input.cashSales,
    cash_refunds: input.cashRefunds,
    cash_adjustments: input.cashAdjustments,
    variance: input.variance,
    approval: toApprovalPayload(input.approval),
  };
}

export function auditEventsPayload(events: readonly AuditEvent[]): Record<string, unknown> {
  return {
    events: events.map((e) => ({
      uuid: e.uuid,
      action: e.action,
      user_uuid: e.userUuid,
      entity_type: e.entityType,
      entity_uuid: e.entityUuid,
      metadata: e.metadata,
      occurred_at: e.occurredAt,
    })),
  };
}
