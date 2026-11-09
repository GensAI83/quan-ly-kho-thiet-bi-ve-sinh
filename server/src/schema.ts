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
  version: integer("version").notNull().default(0),
  status: text("status", { enum: ["active", "discontinued"] }).notNull().default("active"),
  reservedQty: integer("reserved_qty").notNull().default(0),
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
  requestKey: text("request_key"),
  actor: text("actor").notNull().default(""),
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
  status: text("status", { enum: ["pending", "confirmed", "delivering", "completed", "cancelled", "reserved", "returned", "partially_returned"] }).notNull().default("pending"),
  totalAmount: integer("total_amount").notNull().default(0),
  note: text("note").notNull().default(""),
  stockDeducted: integer("stock_deducted").notNull().default(0), // 0 or 1
  depositAmount: integer("deposit_amount").notNull().default(0),
  paymentStatus: text("payment_status", { enum: ["unpaid", "partial", "paid"] }).notNull().default("unpaid"),
  deliveryPerson: text("delivery_person").notNull().default(""),
  deliveryFee: integer("delivery_fee").notNull().default(0),
  expectedDelivery: text("expected_delivery").notNull().default(""),
  reservedUntil: integer("reserved_until", { mode: "timestamp_ms" }),
  requestKey: text("request_key"),
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
  returnedQty: integer("returned_qty").notNull().default(0),
  costPrice: integer("cost_price").notNull().default(0),
});

export const priceHistory = sqliteTable("price_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id").notNull(),
  oldCost: integer("old_cost").notNull().default(0),
  newCost: integer("new_cost").notNull().default(0),
  oldSell: integer("old_sell").notNull().default(0),
  newSell: integer("new_sell").notNull().default(0),
  actor: text("actor").notNull().default(""),
  reason: text("reason").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const staff = sqliteTable("staff", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role", { enum: ["admin", "storekeeper", "sales"] }).notNull().default("sales"),
  pinHash: text("pin_hash").notNull().default(""),
  pinSalt: text("pin_salt").notNull().default(""),
  active: integer("active").notNull().default(1), // 0 or 1
  mustChangePin: integer("must_change_pin").notNull().default(0), // 0 or 1
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const staffSessions = sqliteTable("staff_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  staffId: integer("staff_id").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: text("actor").notNull().default(""),
  action: text("action").notNull().default(""),
  entity: text("entity").notNull().default(""),
  entityId: integer("entity_id").notNull().default(0),
  details: text("details").notNull().default("{}"), // JSON string
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const backups = sqliteTable("backups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  createdBy: text("created_by").notNull().default(""),
  sizeBytes: integer("size_bytes").notNull().default(0),
  data: text("data").notNull().default(""),
});

export const pendingRestocks = sqliteTable("pending_restocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderCode: text("order_code").notNull().default(""),
  productId: integer("product_id").notNull(),
  productSku: text("product_sku").notNull().default(""),
  productName: text("product_name").notNull().default(""),
  quantity: integer("quantity").notNull().default(0),
  unitPrice: integer("unit_price").notNull().default(0),
  reason: text("reason").notNull().default(""),
  status: text("status", { enum: ["pending", "resolved"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
});

export const debts = sqliteTable("debts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  partnerName: text("partner_name").notNull().default(""),
  partnerType: text("partner_type", { enum: ["customer", "supplier"] }).notNull().default("customer"),
  kind: text("kind", { enum: ["receivable", "payable"] }).notNull().default("receivable"),
  totalAmount: integer("total_amount").notNull().default(0),
  paidAmount: integer("paid_amount").notNull().default(0),
  dueDate: text("due_date").notNull().default(""),
  refCode: text("ref_code").notNull().default(""),
  note: text("note").notNull().default(""),
  status: text("status", { enum: ["open", "paid", "overdue"] }).notNull().default("open"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const debtPayments = sqliteTable("debt_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  debtId: integer("debt_id").notNull(),
  amount: integer("amount").notNull().default(0),
  method: text("method").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const stocktakes = sqliteTable("stocktakes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  note: text("note").notNull().default(""),
  status: text("status", { enum: ["draft", "closed"] }).notNull().default("draft"),
  createdBy: text("created_by").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
});

export const stocktakeItems = sqliteTable("stocktake_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stocktakeId: integer("stocktake_id").notNull(),
  productId: integer("product_id").notNull(),
  productSku: text("product_sku").notNull().default(""),
  productName: text("product_name").notNull().default(""),
  countedQty: integer("counted_qty").notNull().default(0),
  systemQty: integer("system_qty").notNull().default(0),
  diffQty: integer("diff_qty").notNull().default(0),
  note: text("note").notNull().default(""),
});

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(),
  action: text("action").notNull().default(""),
  result: text("result").notNull().default("{}"), // JSON string
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
