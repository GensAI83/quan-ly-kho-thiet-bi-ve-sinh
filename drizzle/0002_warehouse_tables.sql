DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Khác',
  brand TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'cái',
  cost_price INTEGER NOT NULL DEFAULT 0,
  sell_price INTEGER NOT NULL DEFAULT 0,
  current_stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 5,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  product_sku TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  before_stock INTEGER NOT NULL DEFAULT 0,
  after_stock INTEGER NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  ref_code TEXT NOT NULL DEFAULT '',
  partner TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  total_amount INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  stock_deducted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_sku TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO categories (name, created_at) VALUES ('Bồn cầu', 1730000000000);
--> statement-breakpoint
INSERT INTO categories (name, created_at) VALUES ('Lavabo & Chậu rửa', 1730000000000);
--> statement-breakpoint
INSERT INTO categories (name, created_at) VALUES ('Vòi lavabo', 1730000000000);
--> statement-breakpoint
INSERT INTO categories (name, created_at) VALUES ('Sen tắm & Vòi sen', 1730000000000);
--> statement-breakpoint
INSERT INTO categories (name, created_at) VALUES ('Bồn tắm', 1730000000000);
--> statement-breakpoint
INSERT INTO categories (name, created_at) VALUES ('Xả & Phụ kiện bồn cầu', 1730000000000);
--> statement-breakpoint
INSERT INTO categories (name, created_at) VALUES ('Gương & Tủ lavabo', 1730000000000);
--> statement-breakpoint
INSERT INTO categories (name, created_at) VALUES ('Phụ kiện phòng tắm', 1730000000000);
--> statement-breakpoint
INSERT INTO categories (name, created_at) VALUES ('Bình nóng lạnh', 1730000000000);
--> statement-breakpoint
INSERT INTO categories (name, created_at) VALUES ('Khác', 1730000000000);
