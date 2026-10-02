import type { Approval } from '../../domain/entities/Approval';
import type {
  ApprovedDiscount,
  DiscountType,
  Payment,
  PrintStatus,
  Sale,
  SaleItem,
  SaleStatus,
  SaleSummary,
  SaleSyncStatus,
} from '../../domain/entities/Sale';
import type { ReceiptCounter, SaleListQuery, SaleReader, SaleWriter } from '../../domain/repositories/SaleRepository';
import type { SqlExecutor, SqlRow, SqlValue } from '../database/SqlDatabase';
import { escapeLike, int, intOrNull, isRecord, str, strOrNull } from './rowMapping';

function approvalFrom(raw: string | null): Approval | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (isRecord(v) && typeof v['approvedByUuid'] === 'string') return v as unknown as Approval;
  } catch {
    /* corrupted json → treat as absent */
  }
  return null;
}

function discountFrom(type: string | null, value: number | null, approval: string | null): ApprovedDiscount | null {
  if (!type || value === null) return null;
  return { type: type as DiscountType, value, approval: approvalFrom(approval) };
}

function mapSummary(row: SqlRow): SaleSummary {
  return {
    uuid: str(row, 'uuid'),
    receiptNumber: str(row, 'receipt_number'),
    serverId: intOrNull(row, 'server_id'),
    cashierUuid: str(row, 'cashier_uuid'),
    cashierName: str(row, 'cashier_name'),
    storeUuid: str(row, 'store_uuid'),
    deviceUuid: str(row, 'device_uuid'),
    registerSessionUuid: str(row, 'register_session_uuid'),
    subtotal: int(row, 'subtotal'),
    orderDiscount: discountFrom(
      strOrNull(row, 'order_discount_type'),
      intOrNull(row, 'order_discount_value'),
      strOrNull(row, 'order_discount_approval'),
    ),
    orderDiscountAmount: int(row, 'order_discount_amount'),
    discountTotal: int(row, 'discount_total'),
    taxTotal: int(row, 'tax_total'),
    total: int(row, 'total'),
    status: str(row, 'status') as SaleStatus,
    paymentStatus: 'PAID',
    syncStatus: str(row, 'sync_status') as SaleSyncStatus,
    printStatus: str(row, 'print_status') as PrintStatus,
    catalogSyncedAt: strOrNull(row, 'catalog_synced_at'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
    voidedAt: strOrNull(row, 'voided_at'),
    voidReason: strOrNull(row, 'void_reason'),
  };
}

function mapItem(row: SqlRow): SaleItem {
  return {
    uuid: str(row, 'uuid'),
    productUuid: str(row, 'product_uuid'),
    sku: str(row, 'sku'),
    name: str(row, 'name'),
    quantity: int(row, 'quantity'),
    unitPrice: int(row, 'unit_price'),
    discount: discountFrom(strOrNull(row, 'discount_type'), intOrNull(row, 'discount_value'), strOrNull(row, 'discount_approval')),
    lineGross: int(row, 'line_gross'),
    lineDiscount: int(row, 'line_discount'),
    lineTotal: int(row, 'line_total'),
  };
}

function mapPayment(row: SqlRow): Payment {
  return {
    uuid: str(row, 'uuid'),
    method: str(row, 'method'),
    amount: int(row, 'amount'),
    tendered: int(row, 'tendered'),
    change: int(row, 'change_amount'),
    reference: strOrNull(row, 'reference'),
  };
}

function buildWhere(q: Omit<SaleListQuery, 'limit' | 'offset'>): { sql: string; params: SqlValue[] } {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (q.status !== 'ALL') {
    where.push('status = ?');
    params.push(q.status);
  }
  if (q.syncStatus !== 'ALL') {
    where.push('sync_status = ?');
    params.push(q.syncStatus);
  }
  const term = q.search.trim();
  if (term) {
    where.push(`(receipt_number LIKE ? ESCAPE '\\' OR cashier_name LIKE ? ESCAPE '\\')`);
    params.push(`%${escapeLike(term)}%`, `%${escapeLike(term)}%`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export class SqliteSaleRepository implements SaleReader, SaleWriter {
  constructor(private readonly db: SqlExecutor) {}

  async findByUuid(uuid: string): Promise<Sale | null> {
    const rows = await this.db.query('SELECT * FROM sales WHERE uuid = ?', [uuid]);
    const row = rows[0];
    if (!row) return null;
    return this.hydrate(mapSummary(row));
  }

  private async hydrate(summary: SaleSummary): Promise<Sale> {
    const items = await this.db.query('SELECT * FROM sale_items WHERE sale_uuid = ? ORDER BY position', [summary.uuid]);
    const payments = await this.db.query('SELECT * FROM payments WHERE sale_uuid = ? ORDER BY position', [summary.uuid]);
    return { ...summary, items: items.map(mapItem), payments: payments.map(mapPayment) };
  }

  async list(q: SaleListQuery): Promise<readonly SaleSummary[]> {
    const w = buildWhere(q);
    const rows = await this.db.query(`SELECT * FROM sales ${w.sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [
      ...w.params,
      q.limit,
      q.offset,
    ]);
    return rows.map(mapSummary);
  }

  async count(q: Omit<SaleListQuery, 'limit' | 'offset'>): Promise<number> {
    const w = buildWhere(q);
    const rows = await this.db.query(`SELECT COUNT(*) AS n FROM sales ${w.sql}`, w.params);
    return rows[0] ? int(rows[0], 'n') : 0;
  }

  async listBySession(sessionUuid: string): Promise<readonly Sale[]> {
    const rows = await this.db.query('SELECT * FROM sales WHERE register_session_uuid = ? ORDER BY id', [sessionUuid]);
    const payments = await this.db.query(
      'SELECT p.* FROM payments p JOIN sales s ON s.uuid = p.sale_uuid WHERE s.register_session_uuid = ? ORDER BY p.position',
      [sessionUuid],
    );
    const bySale = new Map<string, Payment[]>();
    for (const p of payments) {
      const list = bySale.get(str(p, 'sale_uuid')) ?? [];
      list.push(mapPayment(p));
      bySale.set(str(p, 'sale_uuid'), list);
    }
    return rows.map((r) => {
      const s = mapSummary(r);
      return { ...s, items: [], payments: bySale.get(s.uuid) ?? [] };
    });
  }

  async insert(sale: Sale): Promise<void> {
    await this.db.execute(
      `INSERT INTO sales (uuid, server_id, receipt_number, cashier_uuid, cashier_name, store_uuid, device_uuid,
        register_session_uuid, subtotal, order_discount_type, order_discount_value, order_discount_amount,
        order_discount_approval, discount_total, tax_total, total, status, payment_status, sync_status, print_status,
        catalog_synced_at, created_at, updated_at, voided_at, void_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sale.uuid,
        sale.serverId,
        sale.receiptNumber,
        sale.cashierUuid,
        sale.cashierName,
        sale.storeUuid,
        sale.deviceUuid,
        sale.registerSessionUuid,
        sale.subtotal,
        sale.orderDiscount?.type ?? null,
        sale.orderDiscount?.value ?? null,
        sale.orderDiscountAmount,
        sale.orderDiscount?.approval ? JSON.stringify(sale.orderDiscount.approval) : null,
        sale.discountTotal,
        sale.taxTotal,
        sale.total,
        sale.status,
        sale.paymentStatus,
        sale.syncStatus,
        sale.printStatus,
        sale.catalogSyncedAt,
        sale.createdAt,
        sale.updatedAt,
        sale.voidedAt,
        sale.voidReason,
      ],
    );
    let pos = 0;
    for (const i of sale.items) {
      await this.db.execute(
        `INSERT INTO sale_items (uuid, sale_uuid, position, product_uuid, sku, name, quantity, unit_price, discount_type,
          discount_value, discount_approval, line_gross, line_discount, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          i.uuid,
          sale.uuid,
          pos++,
          i.productUuid,
          i.sku,
          i.name,
          i.quantity,
          i.unitPrice,
          i.discount?.type ?? null,
          i.discount?.value ?? null,
          i.discount?.approval ? JSON.stringify(i.discount.approval) : null,
          i.lineGross,
          i.lineDiscount,
          i.lineTotal,
        ],
      );
    }
    pos = 0;
    for (const p of sale.payments) {
      await this.db.execute(
        `INSERT INTO payments (uuid, sale_uuid, position, method, amount, tendered, change_amount, reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.uuid, sale.uuid, pos++, p.method, p.amount, p.tendered, p.change, p.reference],
      );
    }
  }

  async markVoided(uuid: string, reason: string, voidedAt: string): Promise<void> {
    await this.db.execute(
      `UPDATE sales SET status = 'VOIDED', voided_at = ?, void_reason = ?, updated_at = ? WHERE uuid = ? AND status = 'COMPLETED'`,
      [voidedAt, reason, voidedAt, uuid],
    );
  }

  async updateSyncStatus(uuid: string, status: SaleSyncStatus, serverId?: number | null): Promise<void> {
    await this.db.execute(
      `UPDATE sales SET sync_status = ?, server_id = COALESCE(?, server_id), updated_at = ? WHERE uuid = ?`,
      [status, serverId ?? null, new Date().toISOString(), uuid],
    );
  }

  async updatePrintStatus(uuid: string, status: PrintStatus): Promise<void> {
    await this.db.execute(`UPDATE sales SET print_status = ?, updated_at = ? WHERE uuid = ?`, [
      status,
      new Date().toISOString(),
      uuid,
    ]);
  }
}

export class SqliteReceiptCounter implements ReceiptCounter {
  constructor(private readonly db: SqlExecutor) {}

  async next(day: string): Promise<number> {
    await this.db.execute(
      `INSERT INTO receipt_counters (day, last_seq) VALUES (?, 1)
       ON CONFLICT (day) DO UPDATE SET last_seq = last_seq + 1`,
      [day],
    );
    const rows = await this.db.query('SELECT last_seq FROM receipt_counters WHERE day = ?', [day]);
    const row = rows[0];
    if (!row) throw new Error('Receipt counter missing');
    return int(row, 'last_seq');
  }
}
