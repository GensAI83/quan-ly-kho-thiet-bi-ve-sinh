-- Migration 0003: chống lệch tồn (version / requestKey) + bảng vận hành
-- (nhân viên, nhật ký, công nợ, kiểm kê, sao lưu, giá, chờ hoàn kho, idempotency).
-- Lưu ý: SQLite không cho ALTER TABLE ADD COLUMN kèm UNIQUE, nên request_key
-- được thêm dạng cột thường rồi tạo UNIQUE INDEX riêng (NULL vẫn được phép trùng).
ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE products ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE products ADD COLUMN reserved_qty INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE movements ADD COLUMN request_key TEXT;
--> statement-breakpoint
ALTER TABLE movements ADD COLUMN actor TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX idx_movements_request_key ON movements(request_key);
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN deposit_amount INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid';
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN delivery_person TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN delivery_fee INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN expected_delivery TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN reserved_until INTEGER;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN request_key TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_orders_request_key ON orders(request_key);
--> statement-breakpoint
ALTER TABLE order_items ADD COLUMN returned_qty INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE order_items ADD COLUMN cost_price INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  old_cost INTEGER NOT NULL DEFAULT 0,
  new_cost INTEGER NOT NULL DEFAULT 0,
  old_sell INTEGER NOT NULL DEFAULT 0,
  new_sell INTEGER NOT NULL DEFAULT 0,
  actor TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales',
  pin_hash TEXT NOT NULL DEFAULT '',
  pin_salt TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  must_change_pin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE staff_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  staff_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  entity TEXT NOT NULL DEFAULT '',
  entity_id INTEGER NOT NULL DEFAULT 0,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE pending_restocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL DEFAULT '',
  product_id INTEGER NOT NULL,
  product_sku TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_price INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
--> statement-breakpoint
CREATE TABLE debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_name TEXT NOT NULL DEFAULT '',
  partner_type TEXT NOT NULL DEFAULT 'customer',
  kind TEXT NOT NULL DEFAULT 'receivable',
  total_amount INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL DEFAULT '',
  ref_code TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE debt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE stocktakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
--> statement-breakpoint
CREATE TABLE stocktake_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stocktake_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_sku TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  counted_qty INTEGER NOT NULL DEFAULT 0,
  system_qty INTEGER NOT NULL DEFAULT 0,
  diff_qty INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  action TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
