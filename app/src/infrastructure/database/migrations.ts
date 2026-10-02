export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

/**
 * Versioned, append-only schema migrations. NEVER edit a released migration; add a new one.
 * Indexes are designed for 50k+ products and 100k+ sales (see docs/_app_notes.md).
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    statements: [
      `CREATE TABLE stores (
        uuid TEXT PRIMARY KEY NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE users (
        uuid TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        permissions TEXT NOT NULL DEFAULT '[]',
        store_uuid TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE products (
        uuid TEXT PRIMARY KEY NOT NULL,
        sku TEXT NOT NULL,
        sku_normalized TEXT NOT NULL,
        barcode TEXT,
        name TEXT NOT NULL,
        name_normalized TEXT NOT NULL,
        category TEXT,
        price INTEGER NOT NULL CHECK (price >= 0),
        is_active INTEGER NOT NULL DEFAULT 1,
        track_stock INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX idx_products_barcode ON products (barcode)`,
      `CREATE INDEX idx_products_sku ON products (sku_normalized)`,
      `CREATE INDEX idx_products_active_name ON products (is_active, deleted, name_normalized)`,
      `CREATE INDEX idx_products_category_name ON products (category, name_normalized)`,
      `CREATE TABLE inventory (
        product_uuid TEXT PRIMARY KEY NOT NULL,
        server_quantity INTEGER NOT NULL DEFAULT 0,
        quantity_on_hand INTEGER NOT NULL DEFAULT 0,
        server_updated_at TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE inventory_movements (
        uuid TEXT PRIMARY KEY NOT NULL,
        product_uuid TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('SALE','VOID','STOCK_IN','STOCK_OUT','ADJUSTMENT')),
        quantity INTEGER NOT NULL,
        reference TEXT,
        reason TEXT,
        created_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING','SYNCED'))
      )`,
      `CREATE INDEX idx_movements_product_sync ON inventory_movements (product_uuid, sync_status)`,
      `CREATE INDEX idx_movements_reference ON inventory_movements (reference)`,
      `CREATE INDEX idx_movements_product_created ON inventory_movements (product_uuid, created_at)`,
      `CREATE TABLE sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        server_id INTEGER,
        receipt_number TEXT NOT NULL UNIQUE,
        cashier_uuid TEXT NOT NULL,
        cashier_name TEXT NOT NULL,
        store_uuid TEXT NOT NULL,
        device_uuid TEXT NOT NULL,
        register_session_uuid TEXT NOT NULL,
        subtotal INTEGER NOT NULL,
        order_discount_type TEXT,
        order_discount_value INTEGER,
        order_discount_amount INTEGER NOT NULL DEFAULT 0,
        order_discount_approval TEXT,
        discount_total INTEGER NOT NULL,
        tax_total INTEGER NOT NULL,
        total INTEGER NOT NULL CHECK (total >= 0),
        status TEXT NOT NULL CHECK (status IN ('COMPLETED','VOIDED')),
        payment_status TEXT NOT NULL DEFAULT 'PAID',
        sync_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING','SYNCED','FLAGGED','FAILED')),
        print_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (print_status IN ('PENDING','PRINTED','FAILED')),
        catalog_synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        voided_at TEXT,
        void_reason TEXT
      )`,
      `CREATE INDEX idx_sales_created ON sales (created_at)`,
      `CREATE INDEX idx_sales_status_created ON sales (status, created_at)`,
      `CREATE INDEX idx_sales_sync_status ON sales (sync_status)`,
      `CREATE INDEX idx_sales_session ON sales (register_session_uuid)`,
      `CREATE TABLE sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        sale_uuid TEXT NOT NULL REFERENCES sales (uuid) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        product_uuid TEXT NOT NULL,
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price INTEGER NOT NULL,
        discount_type TEXT,
        discount_value INTEGER,
        discount_approval TEXT,
        line_gross INTEGER NOT NULL,
        line_discount INTEGER NOT NULL,
        line_total INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_sale_items_sale ON sale_items (sale_uuid, position)`,
      `CREATE INDEX idx_sale_items_product ON sale_items (product_uuid)`,
      `CREATE TABLE payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        sale_uuid TEXT NOT NULL REFERENCES sales (uuid) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        method TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount >= 0),
        tendered INTEGER NOT NULL,
        change_amount INTEGER NOT NULL CHECK (change_amount >= 0),
        reference TEXT
      )`,
      `CREATE INDEX idx_payments_sale ON payments (sale_uuid, position)`,
      `CREATE TABLE customers (
        uuid TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE approvers (
        user_uuid TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        permissions TEXT NOT NULL DEFAULT '[]',
        pin_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE register_sessions (
        uuid TEXT PRIMARY KEY NOT NULL,
        device_uuid TEXT NOT NULL,
        store_uuid TEXT NOT NULL,
        opened_by_uuid TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        opening_cash INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED')),
        closed_at TEXT,
        closed_by_uuid TEXT,
        actual_cash INTEGER,
        expected_cash INTEGER,
        cash_sales INTEGER,
        cash_refunds INTEGER,
        cash_adjustments INTEGER,
        variance INTEGER
      )`,
      `CREATE INDEX idx_register_sessions_device_status ON register_sessions (device_uuid, status)`,
      `CREATE TABLE receipt_counters (
        day TEXT PRIMARY KEY NOT NULL,
        last_seq INTEGER NOT NULL
      )`,
      `CREATE TABLE sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('CREATE_SALE','VOID_SALE','ADJUST_INVENTORY','OPEN_REGISTER','CLOSE_REGISTER','AUDIT_EVENTS')),
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_FLIGHT','DONE','FAILED')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        next_retry_at TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_sync_queue_status_next ON sync_queue (status, next_retry_at)`,
      `CREATE INDEX idx_sync_queue_entity ON sync_queue (entity_type, entity_id)`,
      `CREATE TABLE sync_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        conflict_type TEXT NOT NULL,
        local_version TEXT,
        server_version TEXT,
        local_payload TEXT,
        server_payload TEXT,
        message TEXT,
        resolution_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (resolution_status IN ('OPEN','RESOLVED')),
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_sync_conflicts_entity ON sync_conflicts (entity_type, entity_id)`,
      `CREATE INDEX idx_sync_conflicts_status ON sync_conflicts (resolution_status, created_at)`,
      `CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        action TEXT NOT NULL,
        user_uuid TEXT,
        entity_type TEXT,
        entity_uuid TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL,
        batch_uuid TEXT,
        uploaded INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX idx_audit_logs_batch ON audit_logs (batch_uuid, uploaded)`,
      `CREATE INDEX idx_audit_logs_occurred ON audit_logs (occurred_at)`,
    ],
  },
];
