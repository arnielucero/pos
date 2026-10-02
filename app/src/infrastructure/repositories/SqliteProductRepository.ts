import { normalizeSearchText, type Product, type ProductWithStock } from '../../domain/entities/Product';
import type {
  ProductReader,
  ProductSearchPage,
  ProductSearchQuery,
  ProductWriter,
} from '../../domain/repositories/ProductRepository';
import type { SqlExecutor, SqlRow } from '../database/SqlDatabase';
import { bool, escapeLike, int, intOrNull, placeholders, str, strOrNull } from './rowMapping';

const SELECT = `SELECT p.uuid, p.sku, p.barcode, p.name, p.category, p.price, p.is_active, p.track_stock,
  p.updated_at, p.deleted, i.quantity_on_hand
  FROM products p LEFT JOIN inventory i ON i.product_uuid = p.uuid`;

function map(row: SqlRow): ProductWithStock {
  return {
    uuid: str(row, 'uuid'),
    sku: str(row, 'sku'),
    barcode: strOrNull(row, 'barcode'),
    name: str(row, 'name'),
    category: strOrNull(row, 'category'),
    price: int(row, 'price'),
    isActive: bool(row, 'is_active'),
    trackStock: bool(row, 'track_stock'),
    updatedAt: str(row, 'updated_at'),
    deleted: bool(row, 'deleted'),
    quantityOnHand: intOrNull(row, 'quantity_on_hand'),
  };
}

export class SqliteProductRepository implements ProductReader, ProductWriter {
  constructor(private readonly db: SqlExecutor) {}

  async findByUuids(uuids: readonly string[]): Promise<readonly ProductWithStock[]> {
    if (uuids.length === 0) return [];
    const out: ProductWithStock[] = [];
    for (let i = 0; i < uuids.length; i += 500) {
      const chunk = uuids.slice(i, i + 500);
      const rows = await this.db.query(`${SELECT} WHERE p.uuid IN (${placeholders(chunk.length)})`, chunk);
      out.push(...rows.map(map));
    }
    return out;
  }

  async findByCode(code: string): Promise<ProductWithStock | null> {
    const rows = await this.db.query(
      `${SELECT} WHERE (p.barcode = ? OR p.sku_normalized = ?) AND p.is_active = 1 AND p.deleted = 0 LIMIT 1`,
      [code, normalizeSearchText(code)],
    );
    return rows[0] ? map(rows[0]) : null;
  }

  /**
   * Indexed search: exact barcode / SKU prefix (index range), then name prefix, then name
   * contains. LIKE (not FTS5) because sql.js ships without FTS5 — see docs/_app_notes.md.
   */
  async search(q: ProductSearchQuery): Promise<ProductSearchPage> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (!q.includeInactive) where.push('p.is_active = 1 AND p.deleted = 0');
    if (q.category) {
      where.push('p.category = ?');
      params.push(q.category);
    }
    const term = normalizeSearchText(q.term);
    let order = 'p.name_normalized';
    const orderParams: string[] = [];
    if (term) {
      const esc = escapeLike(term);
      where.push(`(p.barcode = ? OR p.sku_normalized LIKE ? ESCAPE '\\' OR p.name_normalized LIKE ? ESCAPE '\\')`);
      params.push(q.term.trim(), `${esc}%`, `%${esc}%`);
      order = `CASE WHEN p.barcode = ? OR p.sku_normalized = ? THEN 0
                    WHEN p.name_normalized LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, p.name_normalized`;
      orderParams.push(q.term.trim(), term, `${esc}%`);
    }
    const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ? OFFSET ?`;
    const rows = await this.db.query(sql, [...params, ...orderParams, q.limit + 1, q.offset]);
    const items = rows.slice(0, q.limit).map(map);
    return { items, hasMore: rows.length > q.limit };
  }

  async listCategories(): Promise<readonly string[]> {
    const rows = await this.db.query(
      `SELECT DISTINCT category FROM products WHERE is_active = 1 AND deleted = 0 AND category IS NOT NULL ORDER BY category`,
    );
    return rows.map((r) => str(r, 'category'));
  }

  async countActive(): Promise<number> {
    const rows = await this.db.query('SELECT COUNT(*) AS n FROM products WHERE is_active = 1 AND deleted = 0');
    return rows[0] ? int(rows[0], 'n') : 0;
  }

  async upsertMany(products: readonly Product[]): Promise<void> {
    for (const p of products) {
      await this.db.execute(
        `INSERT INTO products (uuid, sku, sku_normalized, barcode, name, name_normalized, category, price, is_active,
           track_stock, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (uuid) DO UPDATE SET sku = excluded.sku, sku_normalized = excluded.sku_normalized,
           barcode = excluded.barcode, name = excluded.name, name_normalized = excluded.name_normalized,
           category = excluded.category, price = excluded.price, is_active = excluded.is_active,
           track_stock = excluded.track_stock, updated_at = excluded.updated_at, deleted = excluded.deleted`,
        [
          p.uuid,
          p.sku,
          normalizeSearchText(p.sku),
          p.barcode,
          p.name,
          normalizeSearchText(p.name),
          p.category,
          p.price,
          // deleted on server → kept locally (history) but never sellable
          p.isActive && !p.deleted ? 1 : 0,
          p.trackStock ? 1 : 0,
          p.updatedAt,
          p.deleted ? 1 : 0,
        ],
      );
    }
  }
}
