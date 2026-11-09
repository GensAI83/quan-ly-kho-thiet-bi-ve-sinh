import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull().default("Khác"),
  brand: text("brand").notNull().default(""),
  unit: text("unit").notNull().default("cái"),
  costPrice: integer("cost_price").notNull().default(0),
  sellPrice: integer("sell_price").notNull().default(0),
  currentStock: integer("current_stock").notNull().default(0),
  minStock: integer("min_stock").notNull().default(5),
  location: text("location").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const movements = sqliteTable("movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull(),
  productSku: text("product_sku").notNull().default(""),
  productName: text("product_name").notNull().default(""),
  type: text("type", { enum: ["in", "out", "adjust"] }).notNull(),
  quantity: integer("quantity").notNull(),
  beforeStock: integer("before_stock").notNull().default(0),
  afterStock: integer("after_stock").notNull().default(0),
  unitCost: integer("unit_cost").notNull().default(0),
  reason: text("reason").notNull().default(""),
  refCode: text("ref_code").notNull().default(""),
  partner: text("partner").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const suppliers = sqliteTable("suppliers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  contactPerson: text("contact_person").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  address: text("address").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderCode: text("order_code").notNull().unique(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull().default(""),
  customerAddress: text("customer_address").notNull().default(""),
  status: text("status", { enum: ["pending", "confirmed", "delivering", "completed", "cancelled"] }).notNull().default("pending"),
  totalAmount: integer("total_amount").notNull().default(0),
  note: text("note").notNull().default(""),
  stockDeducted: integer("stock_deducted").notNull().default(0), // 0 or 1
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull(),
  productId: integer("product_id").notNull(),
  productSku: text("product_sku").notNull().default(""),
  productName: text("product_name").notNull().default(""),
  quantity: integer("quantity").notNull(),
  unitPrice: integer("unit_price").notNull().default(0),
  lineTotal: integer("line_total").notNull().default(0),
});


