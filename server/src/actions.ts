import { defineAction, z, type ActionsModule, type SpaceDb } from "@hatch/space-sdk";
import { and, desc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";

type Db = SpaceDb<typeof schema>;
type ProdRow = typeof schema.products.$inferSelect;
type StaffRow = typeof schema.staff.$inferSelect;

const VERSION_CONFLICT = "Số tồn vừa thay đổi, vui lòng tải lại trang và thử lại.";

function genSku(category: string, idSeed: number) {
  const prefixMap: Record<string, string> = {
    "Bồn cầu": "BC",
    "Lavabo & Chậu rửa": "LV",
    "Vòi lavabo": "VL",
    "Sen tắm & Vòi sen": "ST",
    "Bồn tắm": "BT",
    "Xả & Phụ kiện bồn cầu": "PK",
    "Gương & Tủ lavabo": "GR",
    "Phụ kiện phòng tắm": "PK",
    "Bình nóng lạnh": "NL",
  };
  const prefix = prefixMap[category] ?? "SP";
  return `${prefix}-${String(idSeed).padStart(4, "0")}`;
}
function genOrderCode() {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `DH${ymd}-${rand}`;
}
function genRefCode(type: string) {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return type === "in" ? `PN${ymd}-${rand}` : type === "out" ? `PX${ymd}-${rand}` : `KK${ymd}-${rand}`;
}
function genStocktakeCode() {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `KK${ymd}-${rand}`;
}

// ---------- Helpers nội bộ ----------

// Hash SHA-256 bằng WebCrypto (server có thể chạy trên Workers: không dùng node:crypto hay Bun API).
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashPin(pin: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${pin}`);
}
function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newToken(): string {
  return randomHex(24); // 48 ký tự hex
}

// Seed lười: nếu chưa có nhân viên nào thì tạo tài khoản quản trị mặc định.
async function ensureAdminSeed(db: Db): Promise<void> {
  const rows = await db.select({ id: schema.staff.id }).from(schema.staff).limit(1);
  if (rows.length > 0) return;
  const salt = randomHex(16);
  const pinHash = await hashPin("123456", salt);
  await db.insert(schema.staff).values({ name: "Chủ cửa hàng", role: "admin", pinHash, pinSalt: salt, active: 1, mustChangePin: 1 });
}

// Token rỗng/null hoặc phiên không hợp lệ/hết hạn/tài khoản bị vô hiệu => null.
// Không còn chế độ "tương thích cũ" cho phép không đăng nhập: mọi action (trừ
// loginStaff) đều phải qua requireAuth() trước khi làm gì khác.
async function resolveActor(db: Db, actorToken?: string): Promise<StaffRow | null> {
  const token = (actorToken ?? "").trim();
  if (!token) return null;
  const sessions = await db.select().from(schema.staffSessions).where(eq(schema.staffSessions.token, token)).limit(1);
  const sess = sessions[0];
  if (!sess) return null;
  if (sess.expiresAt.getTime() <= Date.now()) return null;
  const staffRows = await db.select().from(schema.staff).where(eq(schema.staff.id, sess.staffId)).limit(1);
  const st = staffRows[0];
  if (!st || st.active !== 1) return null;
  return st;
}
function actorNameOf(actor: StaffRow | null): string {
  return actor ? actor.name : "Hệ thống (chưa đăng nhập)";
}

// Bắt buộc đăng nhập cho mọi action (trừ loginStaff). Phân biệt rõ 2 trường hợp:
// - thiếu token/trống => "Cần đăng nhập để thực hiện thao tác này."
// - token sai/hết hạn/tài khoản bị vô hiệu => "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại."
const AUTH_REQUIRED = "Cần đăng nhập để thực hiện thao tác này.";
const AUTH_EXPIRED = "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.";
type AuthResult = { ok: true; actor: StaffRow } | { ok: false; error: string };
async function requireAuth(db: Db, actorToken?: string): Promise<AuthResult> {
  const token = (actorToken ?? "").trim();
  if (!token) return { ok: false, error: AUTH_REQUIRED };
  const actor = await resolveActor(db, token);
  if (!actor) return { ok: false, error: AUTH_EXPIRED };
  return { ok: true, actor };
}
// Trả chuỗi lỗi tiếng Việt hoặc null. Chỉ gọi sau khi requireAuth() đã chắc chắn actor khác null.
function requireRole(actor: StaffRow, allowed: string[], message: string): string | null {
  if (!allowed.includes(actor.role)) return message;
  return null;
}
const ROLE_ADMIN_STOREKEEPER = ["admin", "storekeeper"];
const ROLE_ALL_STAFF = ["admin", "storekeeper", "sales"];

async function writeAudit(db: Db, actorName: string, action: string, entity: string, entityId: number, detailsObj: Record<string, unknown>): Promise<void> {
  await db.insert(schema.auditLogs).values({ actor: actorName, action, entity, entityId, details: JSON.stringify(detailsObj) });
}

async function checkIdem(db: Db, key: string | undefined, actionName: string): Promise<Record<string, unknown> | null> {
  const k = (key ?? "").trim();
  if (!k) return null;
  const rows = await db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, k)).limit(1);
  const row = rows[0];
  if (!row || row.action !== actionName) return null;
  try {
    return JSON.parse(row.result) as Record<string, unknown>;
  } catch {
    return null;
  }
}
async function saveIdem(db: Db, key: string | undefined, actionName: string, resultObj: Record<string, unknown>): Promise<void> {
  const k = (key ?? "").trim();
  if (!k) return;
  await db.insert(schema.idempotencyKeys).values({ key: k, action: actionName, result: JSON.stringify(resultObj) }).onConflictDoNothing();
}

// ---------- Cập nhật tồn chống lệch (optimistic concurrency) ----------
// Mọi cập nhật tồn đều kiểm tra version: nếu version trong DB khác version lúc đọc
// thì update trả về rỗng => xung đột. ctx.db() không có .transaction() nên đơn
// nhiều dòng dùng cơ chế saga: validate hết trước, cập nhật tồn từng dòng, nếu
// 1 dòng lỗi version thì bù trừ hoàn lại các dòng đã trừ, chỉ ghi movements sau
// khi mọi cập nhật tồn thành công.
type StockApply = {
  productId: number; beforeStock: number; beforeReserved: number; beforeVersion: number;
  afterStock: number; afterReserved: number; afterVersion: number;
};
async function applyStock(db: Db, prod: ProdRow, afterStock: number, afterReserved: number): Promise<StockApply | null> {
  const rows = await db
    .update(schema.products)
    .set({ currentStock: afterStock, reservedQty: afterReserved, version: prod.version + 1, updatedAt: new Date() })
    .where(and(eq(schema.products.id, prod.id), eq(schema.products.version, prod.version)))
    .returning({ id: schema.products.id });
  if (!rows[0]) return null;
  return {
    productId: prod.id, beforeStock: prod.currentStock, beforeReserved: prod.reservedQty, beforeVersion: prod.version,
    afterStock, afterReserved, afterVersion: prod.version + 1,
  };
}
// db.batch() yêu cầu tuple không rỗng và suy luận kiểu từ mảng builders hay lỗi;
// gom statements qua BatchItem<"sqlite">[] rồi ép tuple một lần ở đây.
async function batchAll(db: Db, stmts: BatchItem<"sqlite">[]): Promise<void> {
  if (stmts.length === 0) return;
  await db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}
async function compensateStock(db: Db, applied: StockApply[]): Promise<void> {
  for (const a of [...applied].reverse()) {
    await db
      .update(schema.products)
      .set({ currentStock: a.beforeStock, reservedQty: a.beforeReserved, version: a.afterVersion + 1, updatedAt: new Date() })
      .where(and(eq(schema.products.id, a.productId), eq(schema.products.version, a.afterVersion)));
  }
}
function trackApplied(prod: ProdRow, applied: StockApply): void {
  prod.currentStock = applied.afterStock;
  prod.reservedQty = applied.afterReserved;
  prod.version = applied.afterVersion;
}
async function getProduct(db: Db, id: number): Promise<ProdRow | undefined> {
  const rows = await db.select().from(schema.products).where(eq(schema.products.id, id)).limit(1);
  return rows[0];
}
function checkExpectedVersion(prod: ProdRow, expectedVersions: Record<string, number> | undefined): string | null {
  if (!expectedVersions) return null;
  const expected = expectedVersions[String(prod.id)];
  if (expected !== undefined && expected !== prod.version) return VERSION_CONFLICT;
  return null;
}
function isOverdueDebt(d: { dueDate: string; status: string }, todayStr: string): boolean {
  return d.status !== "paid" && d.status !== "cancelled" && d.dueDate !== "" && d.dueDate < todayStr;
}

// ---------- Shapes ----------
const productShape = z.object({
  id: z.number(), sku: z.string(), name: z.string(), category: z.string(), brand: z.string(),
  unit: z.string(), costPrice: z.number(), sellPrice: z.number(), currentStock: z.number(),
  minStock: z.number(), location: z.string(), notes: z.string(),
  version: z.number(), status: z.string(), reservedQty: z.number(),
  createdAt: z.string(), updatedAt: z.string(),
});
const movementShape = z.object({
  id: z.number(), productId: z.number(), productSku: z.string(), productName: z.string(),
  type: z.string(), quantity: z.number(), beforeStock: z.number(), afterStock: z.number(),
  unitCost: z.number(), reason: z.string(), refCode: z.string(), partner: z.string(), note: z.string(),
  requestKey: z.string(), actor: z.string(), createdAt: z.string(),
});
const supplierShape = z.object({
  id: z.number(), name: z.string(), contactPerson: z.string(), phone: z.string(), email: z.string(), address: z.string(), notes: z.string(), createdAt: z.string(),
});
const orderItemShape = z.object({
  id: z.number(), orderId: z.number(), productId: z.number(), productSku: z.string(), productName: z.string(), quantity: z.number(), unitPrice: z.number(), lineTotal: z.number(),
  returnedQty: z.number(), costPrice: z.number(),
});
const orderShape = z.object({
  id: z.number(), orderCode: z.string(), customerName: z.string(), customerPhone: z.string(), customerAddress: z.string(),
  status: z.string(), totalAmount: z.number(), note: z.string(), stockDeducted: z.number(),
  depositAmount: z.number(), paymentStatus: z.string(), deliveryPerson: z.string(), deliveryFee: z.number(),
  expectedDelivery: z.string(), reservedUntil: z.string(),
  createdAt: z.string(), updatedAt: z.string(),
  items: z.array(orderItemShape),
});

function toProduct(r: typeof schema.products.$inferSelect) {
  return { id: r.id, sku: r.sku, name: r.name, category: r.category, brand: r.brand, unit: r.unit, costPrice: r.costPrice, sellPrice: r.sellPrice, currentStock: r.currentStock, minStock: r.minStock, location: r.location, notes: r.notes, version: r.version, status: r.status, reservedQty: r.reservedQty, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}
function toMovement(r: typeof schema.movements.$inferSelect) {
  return { id: r.id, productId: r.productId, productSku: r.productSku, productName: r.productName, type: r.type, quantity: r.quantity, beforeStock: r.beforeStock, afterStock: r.afterStock, unitCost: r.unitCost, reason: r.reason, refCode: r.refCode, partner: r.partner, note: r.note, requestKey: r.requestKey ?? "", actor: r.actor, createdAt: r.createdAt.toISOString() };
}
function toSupplier(r: typeof schema.suppliers.$inferSelect) {
  return { id: r.id, name: r.name, contactPerson: r.contactPerson, phone: r.phone, email: r.email, address: r.address, notes: r.notes, createdAt: r.createdAt.toISOString() };
}
function toOrderItem(i: typeof schema.orderItems.$inferSelect) {
  return { id: i.id, orderId: i.orderId, productId: i.productId, productSku: i.productSku, productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, returnedQty: i.returnedQty, costPrice: i.costPrice };
}
function toOrder(o: typeof schema.orders.$inferSelect, allItems: (typeof schema.orderItems.$inferSelect)[]) {
  return {
    id: o.id, orderCode: o.orderCode, customerName: o.customerName, customerPhone: o.customerPhone, customerAddress: o.customerAddress,
    status: o.status, totalAmount: o.totalAmount, note: o.note, stockDeducted: o.stockDeducted,
    depositAmount: o.depositAmount, paymentStatus: o.paymentStatus, deliveryPerson: o.deliveryPerson, deliveryFee: o.deliveryFee,
    expectedDelivery: o.expectedDelivery, reservedUntil: o.reservedUntil ? o.reservedUntil.toISOString() : "",
    createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(),
    items: allItems.filter((i) => i.orderId === o.id).map(toOrderItem),
  };
}
function toDebt(d: typeof schema.debts.$inferSelect) {
  return { id: d.id, partnerName: d.partnerName, partnerType: d.partnerType, kind: d.kind, totalAmount: d.totalAmount, paidAmount: d.paidAmount, remaining: Math.max(0, d.totalAmount - d.paidAmount), dueDate: d.dueDate, refCode: d.refCode, note: d.note, status: d.status, createdAt: d.createdAt.toISOString() };
}

// Tạo công nợ phải thu cho đơn (chỉ khi còn dư > 0). Dùng cho đơn xác nhận/giao/hoàn thành.
// Công nợ đã bị void do hủy đơn (status "cancelled") không chặn việc tạo công nợ mới
// nếu đơn đó sau này được xác nhận lại.
async function createReceivableDebtIfNeeded(db: Db, order: { orderCode: string; customerName: string; totalAmount: number; depositAmount: number }): Promise<void> {
  const remaining = order.totalAmount - order.depositAmount;
  if (remaining <= 0) return;
  const existing = await db.select().from(schema.debts).where(eq(schema.debts.refCode, order.orderCode)).limit(1);
  if (existing[0] && existing[0].status !== "cancelled") return;
  await db.insert(schema.debts).values({
    partnerName: order.customerName, partnerType: "customer", kind: "receivable",
    totalAmount: remaining, paidAmount: 0, dueDate: "", refCode: order.orderCode,
    note: `Công nợ đơn ${order.orderCode}`, status: "open",
  });
}

// Hủy (void) công nợ phải thu gắn với đơn khi đơn bị hủy: còn lại về 0, trạng thái
// "cancelled", giữ paidAmount làm lịch sử (totalAmount đặt bằng paidAmount).
// Chỉ void công nợ còn dư (open/overdue); công nợ đã thu đủ (paid) giữ nguyên để
// cửa hàng xử lý hoàn tiền thủ công, không viết lại lịch sử đã thu.
async function voidReceivableDebtForOrder(db: Db, orderCode: string, actorName: string): Promise<void> {
  const rows = await db.select().from(schema.debts).where(eq(schema.debts.refCode, orderCode));
  for (const d of rows.filter((x) => x.kind === "receivable" && x.status !== "paid" && x.status !== "cancelled")) {
    const remaining = Math.max(0, d.totalAmount - d.paidAmount);
    if (remaining <= 0) continue;
    await db.update(schema.debts).set({
      totalAmount: d.paidAmount,
      status: "cancelled",
      note: d.note ? `${d.note} | Đã hủy đơn — công nợ đã xóa` : "Đã hủy đơn — công nợ đã xóa",
    }).where(eq(schema.debts.id, d.id));
    await writeAudit(db, actorName, "void_debt_on_cancel", "debt", d.id, { refCode: orderCode, paidAmount: d.paidAmount, voidedRemaining: remaining });
  }
}

// Đồng bộ trạng thái thanh toán của đơn theo công nợ phải thu gắn với đơn.
// Dùng sau mỗi lần thu nợ (recordDebtPayment) và sau khi trả hàng làm công nợ
// về 0 (createReturn): cộng số tiền vừa thu vào cọc (không vượt tổng tiền đơn),
// paymentStatus = paid khi công nợ còn 0, partial khi đã cọc > 0, unpaid khi chưa cọc.
async function syncOrderPaymentFromDebt(db: Db, orderCode: string, amountJustCollected: number, debtRemainingAfter: number): Promise<void> {
  const orderRows = await db.select().from(schema.orders).where(eq(schema.orders.orderCode, orderCode)).limit(1);
  const order = orderRows[0];
  if (!order) return;
  const newDeposit = Math.min(order.totalAmount, order.depositAmount + amountJustCollected);
  const paymentStatus = debtRemainingAfter === 0 ? "paid" : newDeposit > 0 ? "partial" : "unpaid";
  await db.update(schema.orders).set({ depositAmount: newDeposit, paymentStatus, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
}

// ---------- Sao lưu / khôi phục ----------
async function buildBackupData(db: Db): Promise<Record<string, unknown>> {
  const [products, movements, orders, orderItems, suppliers, categories, staffRows, auditLogs, debts, debtPayments, priceHistory, stocktakes, stocktakeItems, pendingRestocks] = await Promise.all([
    db.select().from(schema.products),
    db.select().from(schema.movements),
    db.select().from(schema.orders),
    db.select().from(schema.orderItems),
    db.select().from(schema.suppliers),
    db.select().from(schema.categories),
    db.select().from(schema.staff),
    db.select().from(schema.auditLogs),
    db.select().from(schema.debts),
    db.select().from(schema.debtPayments),
    db.select().from(schema.priceHistory),
    db.select().from(schema.stocktakes),
    db.select().from(schema.stocktakeItems),
    db.select().from(schema.pendingRestocks),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    products, movements, orders, orderItems, suppliers, categories,
    // Nhân viên xuất ra KHÔNG gồm pinHash/pinSalt.
    staff: staffRows.map((s) => ({ id: s.id, name: s.name, role: s.role, active: s.active, mustChangePin: s.mustChangePin, createdAt: s.createdAt })),
    auditLogs, debts, debtPayments, priceHistory, stocktakes, stocktakeItems, pendingRestocks,
  };
}
const BACKUP_PIN_NOTE = "Sao lưu không bao gồm mã PIN của nhân viên. Khi khôi phục, nhân viên đã có sẽ giữ nguyên mã PIN hiện tại; nhân viên mới trong bản sao lưu sẽ được đặt mã PIN mặc định 123456 và bắt buộc đổi PIN khi đăng nhập lần đầu.";

export const Actions = {
  getDashboard: defineAction({
    description: "Lấy tổng quan kho: giá trị tồn, số SKU, cảnh báo sắp hết, nhập/xuất hôm nay, đơn chờ xử lý.",
    request: z.object({ actorToken: z.string().optional() }),
    response: z.object({
      totalSkus: z.number(), totalUnits: z.number(), inventoryValueCost: z.number(), inventoryValueSell: z.number(),
      lowStockCount: z.number(), outOfStockCount: z.number(),
      todayInQty: z.number(), todayOutQty: z.number(), todayInValue: z.number(), todayOutValue: z.number(),
      pendingOrders: z.number(), totalOrders: z.number(),
      reservedOrders: z.number(), pendingRestockCount: z.number(), overdueDebtTotal: z.number(),
      lowStockProducts: z.array(productShape),
      recentMovements: z.array(movementShape),
      chart7Days: z.array(z.object({ date: z.string(), label: z.string(), inQty: z.number(), outQty: z.number() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      const products = await db.select().from(schema.products);
      const movements = await db.select().from(schema.movements).orderBy(desc(schema.movements.id));
      const orders = await db.select().from(schema.orders);
      const debts = await db.select().from(schema.debts);
      const pendingRestocks = await db.select().from(schema.pendingRestocks).where(eq(schema.pendingRestocks.status, "pending"));
      const totalSkus = products.length;
      const totalUnits = products.reduce((s, p) => s + p.currentStock, 0);
      const inventoryValueCost = products.reduce((s, p) => s + p.currentStock * p.costPrice, 0);
      const inventoryValueSell = products.reduce((s, p) => s + p.currentStock * p.sellPrice, 0);
      const lowStockProducts = products.filter(p => p.currentStock > 0 && p.currentStock <= p.minStock).sort((a, b) => a.currentStock - b.currentStock).map(toProduct);
      const outOfStockCount = products.filter(p => p.currentStock === 0).length;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayMovs = movements.filter(m => m.createdAt >= today);
      const todayInQty = todayMovs.filter(m => m.type === "in").reduce((s, m) => s + m.quantity, 0);
      const todayOutQty = todayMovs.filter(m => m.type === "out").reduce((s, m) => s + m.quantity, 0);
      const todayInValue = todayMovs.filter(m => m.type === "in").reduce((s, m) => s + m.quantity * m.unitCost, 0);
      const todayOutValue = todayMovs.filter(m => m.type === "out").reduce((s, m) => s + m.quantity * m.unitCost, 0);
      // chart 7 days
      const chart7Days: { date: string; label: string; inQty: number; outQty: number }[] = [];
      const allMovs = movements;
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
        const next = new Date(d); next.setDate(next.getDate() + 1);
        const dayMovs = allMovs.filter(m => m.createdAt >= d && m.createdAt < next);
        chart7Days.push({
          date: d.toISOString(),
          label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
          inQty: dayMovs.filter(m => m.type === "in").reduce((s, m) => s + m.quantity, 0),
          outQty: dayMovs.filter(m => m.type === "out").reduce((s, m) => s + m.quantity, 0),
        });
      }
      const todayStr = new Date().toISOString().slice(0, 10);
      const overdueDebtTotal = debts
        .filter((d) => isOverdueDebt(d, todayStr))
        .reduce((s, d) => s + Math.max(0, d.totalAmount - d.paidAmount), 0);
      return {
        totalSkus, totalUnits, inventoryValueCost, inventoryValueSell,
        lowStockCount: lowStockProducts.length, outOfStockCount,
        todayInQty, todayOutQty, todayInValue, todayOutValue,
        pendingOrders: orders.filter(o => o.status === "pending" || o.status === "confirmed").length,
        totalOrders: orders.length,
        reservedOrders: orders.filter(o => o.status === "reserved").length,
        pendingRestockCount: pendingRestocks.length,
        overdueDebtTotal,
        lowStockProducts: [...lowStockProducts, ...products.filter(p => p.currentStock === 0).map(toProduct)].slice(0, 10),
        recentMovements: movements.slice(0, 8).map(toMovement),
        chart7Days,
      };
    },
  }),

  listProducts: defineAction({
    description: "Danh sách sản phẩm tồn kho, có tìm kiếm và lọc theo danh mục / trạng thái tồn.",
    request: z.object({
      search: z.string().default(""),
      category: z.string().default(""),
      stockFilter: z.enum(["all", "in_stock", "low", "out"]).default("all"),
      actorToken: z.string().optional(),
    }),
    response: z.object({ products: z.array(productShape), categories: z.array(z.string()) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      let rows = await db.select().from(schema.products).orderBy(desc(schema.products.updatedAt));
      if (args.search.trim()) {
        const q = args.search.trim().toLowerCase();
        rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || r.brand.toLowerCase().includes(q));
      }
      if (args.category) rows = rows.filter(r => r.category === args.category);
      if (args.stockFilter === "in_stock") rows = rows.filter(r => r.currentStock > r.minStock);
      if (args.stockFilter === "low") rows = rows.filter(r => r.currentStock > 0 && r.currentStock <= r.minStock);
      if (args.stockFilter === "out") rows = rows.filter(r => r.currentStock === 0);
      const cats = await db.select().from(schema.categories).orderBy(schema.categories.name);
      return { products: rows.map(toProduct), categories: cats.map(c => c.name) };
    },
  }),

  createProduct: defineAction({
    description: "Tạo sản phẩm mới với mã SKU tự sinh nếu để trống, kèm tồn đầu kỳ.",
    request: z.object({
      sku: z.string().default(""), name: z.string().min(1), category: z.string().min(1), brand: z.string().default(""),
      unit: z.string().default("cái"), costPrice: z.number().int().min(0).default(0), sellPrice: z.number().int().min(0).default(0),
      initialStock: z.number().int().min(0).default(0), minStock: z.number().int().min(0).default(5),
      location: z.string().default(""), notes: z.string().default(""), actorToken: z.string().optional(),
    }),
    response: z.object({ ok: z.boolean(), id: z.number(), sku: z.string(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, id: 0, sku: "", error: auth.error };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được thêm sản phẩm.");
      if (roleErr) return { ok: false, id: 0, sku: "", error: roleErr };
      // ensure category exists
      const existingCat = await db.select().from(schema.categories).where(eq(schema.categories.name, args.category));
      if (existingCat.length === 0) {
        await db.insert(schema.categories).values({ name: args.category });
      }
      let sku = args.sku.trim().toUpperCase();
      if (sku) {
        const dup = await db.select().from(schema.products).where(eq(schema.products.sku, sku));
        if (dup.length > 0) return { ok: false, id: 0, sku, error: `Mã SKU "${sku}" đã tồn tại. Hãy dùng mã khác hoặc để trống để tự sinh.` };
      } else {
        const countRows = await db.select({ c: sql<number>`count(*)` }).from(schema.products);
        const seed = (countRows[0]?.c ?? 0) + 1 + Math.floor(Math.random() * 90);
        sku = genSku(args.category, seed * 7 + Date.now() % 1000);
        // ensure unique
        const dup2 = await db.select().from(schema.products).where(eq(schema.products.sku, sku));
        if (dup2.length > 0) sku = `${sku}-${Math.floor(Math.random() * 99)}`;
      }
      const inserted = await db.insert(schema.products).values({
        sku, name: args.name.trim(), category: args.category, brand: args.brand.trim(), unit: args.unit,
        costPrice: args.costPrice, sellPrice: args.sellPrice, currentStock: args.initialStock, minStock: args.minStock,
        location: args.location.trim(), notes: args.notes.trim(),
      }).returning({ id: schema.products.id });
      const row = inserted[0];
      if (!row) return { ok: false, id: 0, sku, error: "Không tạo được sản phẩm." };
      if (args.initialStock > 0) {
        await db.insert(schema.movements).values({
          productId: row.id, productSku: sku, productName: args.name.trim(), type: "in", quantity: args.initialStock,
          beforeStock: 0, afterStock: args.initialStock, unitCost: args.costPrice, reason: "Tồn đầu kỳ", refCode: genRefCode("in"), partner: "", note: "Nhập tồn khi tạo sản phẩm", actor: actorName,
        });
      }
      await writeAudit(db, actorName, "create_product", "product", row.id, { sku, name: args.name.trim(), initialStock: args.initialStock });
      ctx.invalidateQueries();
      return { ok: true, id: row.id, sku, error: null };
    },
  }),

  updateProduct: defineAction({
    description: "Cập nhật thông tin sản phẩm (không sửa trực tiếp tồn — dùng phiếu nhập/xuất/kiểm kê). Đổi giá chỉ quản trị viên được làm và được lưu lịch sử giá.",
    request: z.object({
      id: z.number(), name: z.string().min(1), category: z.string().min(1), brand: z.string().default(""),
      unit: z.string().default("cái"), costPrice: z.number().int().min(0), sellPrice: z.number().int().min(0),
      minStock: z.number().int().min(0), location: z.string().default(""), notes: z.string().default(""),
      actorToken: z.string().optional(), expectedVersion: z.number().optional(), priceChangeReason: z.string().optional(),
    }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const prod = await getProduct(db, args.id);
      if (!prod) return { ok: false, error: "Sản phẩm không tồn tại." };
      if (args.expectedVersion !== undefined && args.expectedVersion !== prod.version) {
        return { ok: false, error: VERSION_CONFLICT };
      }
      // Cấm đổi đơn vị khi còn tồn hoặc đã có phiếu (đơn vị gắn với lịch sử tồn/phiếu).
      if (args.unit !== prod.unit) {
        const hasMov = await db.select({ id: schema.movements.id }).from(schema.movements).where(eq(schema.movements.productId, prod.id)).limit(1);
        if (prod.currentStock > 0 || hasMov.length > 0) {
          return { ok: false, error: "Không thể đổi đơn vị khi sản phẩm còn tồn kho hoặc đã có phiếu nhập/xuất. Hãy tạo mã sản phẩm mới với đơn vị khác." };
        }
      }
      const priceChanged = args.costPrice !== prod.costPrice || args.sellPrice !== prod.sellPrice;
      if (priceChanged) {
        // Chỉ quản trị viên được đổi giá.
        const roleErr = requireRole(actor, ["admin"], "Chỉ quản trị viên được đổi giá.");
        if (roleErr) return { ok: false, error: roleErr };
      } else {
        // Sửa thông tin không đổi giá: quản trị viên hoặc thủ kho.
        const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được sửa sản phẩm.");
        if (roleErr) return { ok: false, error: roleErr };
      }
      const existingCat = await db.select().from(schema.categories).where(eq(schema.categories.name, args.category));
      if (existingCat.length === 0) await db.insert(schema.categories).values({ name: args.category });
      if (args.expectedVersion !== undefined) {
        const updated = await db.update(schema.products).set({
          name: args.name.trim(), category: args.category, brand: args.brand.trim(), unit: args.unit,
          costPrice: args.costPrice, sellPrice: args.sellPrice, minStock: args.minStock, location: args.location.trim(), notes: args.notes.trim(), updatedAt: new Date(),
          version: prod.version + 1,
        }).where(and(eq(schema.products.id, prod.id), eq(schema.products.version, prod.version))).returning({ id: schema.products.id });
        if (!updated[0]) return { ok: false, error: VERSION_CONFLICT };
      } else {
        await db.update(schema.products).set({
          name: args.name.trim(), category: args.category, brand: args.brand.trim(), unit: args.unit,
          costPrice: args.costPrice, sellPrice: args.sellPrice, minStock: args.minStock, location: args.location.trim(), notes: args.notes.trim(), updatedAt: new Date(),
        }).where(eq(schema.products.id, args.id));
      }
      if (priceChanged) {
        await db.insert(schema.priceHistory).values({
          productId: prod.id, oldCost: prod.costPrice, newCost: args.costPrice, oldSell: prod.sellPrice, newSell: args.sellPrice,
          actor: actorName, reason: (args.priceChangeReason ?? "").trim(),
        });
      }
      await writeAudit(db, actorName, "update_product", "product", prod.id, { sku: prod.sku, name: args.name.trim(), priceChanged, oldCost: prod.costPrice, newCost: args.costPrice, oldSell: prod.sellPrice, newSell: args.sellPrice });
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  deleteProduct: defineAction({
    description: "Ngưng kinh doanh sản phẩm (đặt status discontinued) thay vì xoá cứng, trừ khi sản phẩm chưa từng có phiếu/đơn nào thì xoá hẳn.",
    request: z.object({ id: z.number(), actorToken: z.string().optional() }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable(), discontinued: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error, discontinued: false };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ["admin"], "Chỉ quản trị viên được xoá sản phẩm.");
      if (roleErr) return { ok: false, error: roleErr, discontinued: false };
      const prod = await getProduct(db, args.id);
      if (!prod) return { ok: false, error: "Sản phẩm không tồn tại.", discontinued: false };
      if (prod.currentStock > 0) {
        return { ok: false, error: `Sản phẩm còn tồn ${prod.currentStock} ${prod.unit}, không thể xoá. Hãy xuất hết tồn trước, hoặc ngưng kinh doanh sau khi hết tồn.`, discontinued: false };
      }
      // Còn đơn chưa hoàn thành chứa sản phẩm => chặn.
      const openOrders = await db.select().from(schema.orders);
      const openOrderIds = new Set(openOrders.filter((o) => ["pending", "confirmed", "delivering", "reserved"].includes(o.status)).map((o) => o.id));
      if (openOrderIds.size > 0) {
        const items = await db.select().from(schema.orderItems);
        const blocking = items.find((i) => i.productId === prod.id && openOrderIds.has(i.orderId));
        if (blocking) {
          const ord = openOrders.find((o) => o.id === blocking.orderId);
          return { ok: false, error: `Sản phẩm còn trong đơn chưa hoàn thành ${ord?.orderCode ?? ""}. Hãy xử lý đơn đó trước.`, discontinued: false };
        }
      }
      // Còn phiếu gắn mã đơn chưa hoàn thành, hoặc còn phiếu kiểm kê nháp chứa sản phẩm => chặn.
      const movs = await db.select().from(schema.movements).where(eq(schema.movements.productId, prod.id));
      const unfinishedCodes = new Set(openOrders.filter((o) => ["pending", "confirmed", "delivering", "reserved"].includes(o.status)).map((o) => o.orderCode));
      if (movs.some((m) => m.refCode && unfinishedCodes.has(m.refCode))) {
        return { ok: false, error: "Sản phẩm còn phiếu gắn với đơn chưa hoàn thành. Hãy xử lý đơn đó trước.", discontinued: false };
      }
      const draftTakes = await db.select().from(schema.stocktakes).where(eq(schema.stocktakes.status, "draft"));
      if (draftTakes.length > 0) {
        const takeItems = await db.select().from(schema.stocktakeItems);
        const draftIds = new Set(draftTakes.map((t) => t.id));
        if (takeItems.some((i) => i.productId === prod.id && draftIds.has(i.stocktakeId))) {
          return { ok: false, error: "Sản phẩm đang nằm trong phiếu kiểm kê nháp. Hãy đóng hoặc xoá phiếu kiểm kê đó trước.", discontinued: false };
        }
      }
      const allItems = await db.select({ id: schema.orderItems.id }).from(schema.orderItems).where(eq(schema.orderItems.productId, prod.id)).limit(1);
      const hadHistory = movs.length > 0 || allItems.length > 0;
      if (!hadHistory) {
        // Chưa từng có phiếu/đơn nào: xoá cứng thật.
        await db.delete(schema.products).where(eq(schema.products.id, args.id));
        await writeAudit(db, actorName, "delete_product", "product", prod.id, { sku: prod.sku, name: prod.name, hardDelete: true });
        ctx.invalidateQueries();
        return { ok: true, error: null, discontinued: false };
      }
      await db.update(schema.products).set({ status: "discontinued", updatedAt: new Date() }).where(eq(schema.products.id, args.id));
      await writeAudit(db, actorName, "discontinue_product", "product", prod.id, { sku: prod.sku, name: prod.name });
      ctx.invalidateQueries();
      return { ok: true, error: null, discontinued: true };
    },
  }),

  listMovements: defineAction({
    description: "Lịch sử nhập/xuất/kiểm kê, lọc theo loại phiếu, sản phẩm và từ khoá.",
    request: z.object({ type: z.enum(["all", "in", "out", "adjust"]).default("all"), search: z.string().default(""), limit: z.number().int().positive().max(500).default(200), actorToken: z.string().optional() }),
    response: z.object({ movements: z.array(movementShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      let rows = await db.select().from(schema.movements).orderBy(desc(schema.movements.id));
      if (args.type !== "all") rows = rows.filter(r => r.type === args.type);
      if (args.search.trim()) {
        const q = args.search.trim().toLowerCase();
        rows = rows.filter(r => r.productName.toLowerCase().includes(q) || r.productSku.toLowerCase().includes(q) || r.refCode.toLowerCase().includes(q) || r.partner.toLowerCase().includes(q));
      }
      rows = rows.slice(0, args.limit);
      return { movements: rows.map(toMovement) };
    },
  }),

  createMovement: defineAction({
    description: "Tạo phiếu nhập, xuất hoặc kiểm kê và cập nhật tồn kho tương ứng (kiểm tra version để chống lệch tồn; hỗ trợ requestKey chống ghi trùng).",
    request: z.object({
      productId: z.number(), type: z.enum(["in", "out", "adjust"]), quantity: z.number().int().min(0),
      unitCost: z.number().int().min(0).default(0), reason: z.string().default(""), partner: z.string().default(""), note: z.string().default(""),
      actorToken: z.string().optional(), requestKey: z.string().optional(), expectedVersion: z.number().optional(),
    }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable(), newStock: z.number(), refCode: z.string(), version: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error, newStock: 0, refCode: "", version: 0 };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được tạo phiếu nhập/xuất.");
      if (roleErr) return { ok: false, error: roleErr, newStock: 0, refCode: "", version: 0 };
      const key = (args.requestKey ?? "").trim();
      if (key) {
        const prev = await checkIdem(db, key, "createMovement");
        if (prev) {
          return {
            ok: prev["ok"] as boolean, error: (prev["error"] as string | null) ?? null,
            newStock: prev["newStock"] as number, refCode: prev["refCode"] as string, version: prev["version"] as number,
          };
        }
      }
      const prod = await getProduct(db, args.productId);
      if (!prod) return { ok: false, error: "Sản phẩm không tồn tại.", newStock: 0, refCode: "", version: 0 };
      const versionErr = checkExpectedVersion(prod, args.expectedVersion !== undefined ? { [String(prod.id)]: args.expectedVersion } : undefined);
      if (versionErr) return { ok: false, error: versionErr, newStock: prod.currentStock, refCode: "", version: prod.version };
      const before = prod.currentStock;
      let after = before;
      let qtyRecord = args.quantity;
      if (args.type === "in") {
        if (args.quantity <= 0) return { ok: false, error: "Số lượng nhập phải lớn hơn 0.", newStock: before, refCode: "", version: prod.version };
        after = before + args.quantity;
      } else if (args.type === "out") {
        if (args.quantity <= 0) return { ok: false, error: "Số lượng xuất phải lớn hơn 0.", newStock: before, refCode: "", version: prod.version };
        if (args.quantity > before) return { ok: false, error: `Không đủ tồn: chỉ còn ${before} ${prod.unit} (cần xuất ${args.quantity}).`, newStock: before, refCode: "", version: prod.version };
        after = before - args.quantity;
      } else {
        // adjust: quantity is the counted actual stock
        after = args.quantity;
        qtyRecord = Math.abs(after - before);
      }
      const refCode = genRefCode(args.type);
      const unitCost = args.unitCost > 0 ? args.unitCost : (args.type === "in" ? prod.costPrice : prod.sellPrice);
      const applied = await applyStock(db, prod, after, prod.reservedQty);
      if (!applied) return { ok: false, error: VERSION_CONFLICT, newStock: before, refCode: "", version: prod.version };
      await batchAll(db, [
        db.insert(schema.movements).values({
          productId: prod.id, productSku: prod.sku, productName: prod.name, type: args.type, quantity: qtyRecord,
          beforeStock: before, afterStock: after, unitCost, reason: args.reason, refCode, partner: args.partner.trim(), note: args.note.trim(),
          requestKey: key || null, actor: actorName,
        }),
        db.insert(schema.auditLogs).values({ actor: actorName, action: "create_movement", entity: "movement", entityId: 0, details: JSON.stringify({ productId: prod.id, sku: prod.sku, type: args.type, quantity: qtyRecord, beforeStock: before, afterStock: after, refCode }) }),
      ]);
      ctx.invalidateQueries();
      const result = { ok: true, error: null as string | null, newStock: after, refCode, version: applied.afterVersion };
      await saveIdem(db, key, "createMovement", result);
      return result;
    },
  }),

  deleteMovement: defineAction({
    description: "Xoá một phiếu và hoàn lại tồn kho về trước phiếu đó (chỉ khi phiếu là phiếu gần nhất của sản phẩm).",
    request: z.object({ id: z.number(), actorToken: z.string().optional() }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được xoá phiếu.");
      if (roleErr) return { ok: false, error: roleErr };
      const rows = await db.select().from(schema.movements).where(eq(schema.movements.id, args.id));
      const mov = rows[0];
      if (!mov) return { ok: false, error: "Không tìm thấy phiếu." };
      // Chỉ được xoá phiếu gần nhất của sản phẩm đó — xoá phiếu cũ sẽ làm lệch chuỗi tồn trước/sau.
      const latestRows = await db.select().from(schema.movements).where(eq(schema.movements.productId, mov.productId)).orderBy(desc(schema.movements.id)).limit(1);
      const latest = latestRows[0];
      if (latest && latest.id !== mov.id) {
        return { ok: false, error: "Chỉ được xoá phiếu gần nhất của sản phẩm này. Hãy xoá các phiếu mới hơn trước, nếu cần." };
      }
      // Phiếu gắn với đơn hàng được quản lý theo vòng đời đơn: xoá riêng sẽ lệch cờ đã trừ kho của đơn và sinh hàng ảo khi huỷ đơn.
      if (mov.refCode) {
        const linkedOrders = await db.select().from(schema.orders).where(eq(schema.orders.orderCode, mov.refCode));
        if (linkedOrders.length > 0 && (mov.reason === "Xuất theo đơn hàng" || mov.reason === "Hoàn kho do huỷ đơn")) {
          return { ok: false, error: `Phiếu này gắn với đơn ${mov.refCode} — không xoá riêng được. Hãy huỷ đơn để hệ thống hoàn kho đồng bộ.` };
        }
      }
      const prod = await getProduct(db, mov.productId);
      if (prod) {
        // revert: set stock back to beforeStock only if current matches afterStock, else adjust by delta
        const delta = mov.afterStock - mov.beforeStock;
        const newStock = Math.max(0, prod.currentStock - delta);
        const applied = await applyStock(db, prod, newStock, prod.reservedQty);
        if (!applied) return { ok: false, error: VERSION_CONFLICT };
      }
      await db.delete(schema.movements).where(eq(schema.movements.id, args.id));
      await writeAudit(db, actorName, "delete_movement", "movement", mov.id, { productId: mov.productId, sku: mov.productSku, type: mov.type, quantity: mov.quantity, refCode: mov.refCode });
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  listSuppliers: defineAction({
    description: "Danh sách nhà cung cấp / đối tác.",
    request: z.object({ search: z.string().default(""), actorToken: z.string().optional() }),
    response: z.object({ suppliers: z.array(supplierShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      let rows = await db.select().from(schema.suppliers).orderBy(desc(schema.suppliers.id));
      if (args.search.trim()) {
        const q = args.search.trim().toLowerCase();
        rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.phone.includes(q));
      }
      return { suppliers: rows.map(toSupplier) };
    },
  }),

  createSupplier: defineAction({
    description: "Thêm nhà cung cấp mới.",
    request: z.object({ actorToken: z.string().optional(), name: z.string().min(1), contactPerson: z.string().default(""), phone: z.string().default(""), email: z.string().default(""), address: z.string().default(""), notes: z.string().default("") }),
    response: z.object({ ok: z.boolean(), id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      const actor = auth.actor;
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được quản lý nhà cung cấp.");
      if (roleErr) throw new Error(roleErr);
      const res = await db.insert(schema.suppliers).values({ name: args.name.trim(), contactPerson: args.contactPerson.trim(), phone: args.phone.trim(), email: args.email.trim(), address: args.address.trim(), notes: args.notes.trim() }).returning({ id: schema.suppliers.id });
      ctx.invalidateQueries();
      return { ok: true, id: res[0]?.id ?? 0 };
    },
  }),

  updateSupplier: defineAction({
    description: "Cập nhật nhà cung cấp.",
    request: z.object({ actorToken: z.string().optional(), id: z.number(), name: z.string().min(1), contactPerson: z.string().default(""), phone: z.string().default(""), email: z.string().default(""), address: z.string().default(""), notes: z.string().default("") }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      const actor = auth.actor;
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được quản lý nhà cung cấp.");
      if (roleErr) throw new Error(roleErr);
      await db.update(schema.suppliers).set({ name: args.name.trim(), contactPerson: args.contactPerson.trim(), phone: args.phone.trim(), email: args.email.trim(), address: args.address.trim(), notes: args.notes.trim() }).where(eq(schema.suppliers.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteSupplier: defineAction({
    description: "Xoá nhà cung cấp.",
    request: z.object({ actorToken: z.string().optional(), id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      const actor = auth.actor;
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được quản lý nhà cung cấp.");
      if (roleErr) throw new Error(roleErr);
      await db.delete(schema.suppliers).where(eq(schema.suppliers.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listCategories: defineAction({
    description: "Danh sách danh mục sản phẩm.",
    request: z.object({ actorToken: z.string().optional() }),
    response: z.object({ categories: z.array(z.object({ id: z.number(), name: z.string(), productCount: z.number() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      const cats = await db.select().from(schema.categories).orderBy(schema.categories.name);
      const prods = await db.select().from(schema.products);
      return { categories: cats.map(c => ({ id: c.id, name: c.name, productCount: prods.filter(p => p.category === c.name).length })) };
    },
  }),

  createCategory: defineAction({
    description: "Thêm danh mục sản phẩm mới.",
    request: z.object({ actorToken: z.string().optional(), name: z.string().min(1) }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error };
      const actor = auth.actor;
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được thêm danh mục.");
      if (roleErr) return { ok: false, error: roleErr };
      const dup = await db.select().from(schema.categories).where(eq(schema.categories.name, args.name.trim()));
      if (dup.length > 0) return { ok: false, error: "Danh mục đã tồn tại." };
      await db.insert(schema.categories).values({ name: args.name.trim() });
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  deleteCategory: defineAction({
    description: "Xoá danh mục (sản phẩm thuộc danh mục sẽ chuyển về 'Khác').",
    request: z.object({ actorToken: z.string().optional(), id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      const actor = auth.actor;
      const roleErr = requireRole(actor, ["admin"], "Chỉ quản trị viên được xoá danh mục.");
      if (roleErr) throw new Error(roleErr);
      const catRows = await db.select().from(schema.categories).where(eq(schema.categories.id, args.id));
      const cat = catRows[0];
      if (cat) {
        await db.update(schema.products).set({ category: "Khác" }).where(eq(schema.products.category, cat.name));
        await db.delete(schema.categories).where(eq(schema.categories.id, args.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listOrders: defineAction({
    description: "Danh sách đơn hàng kèm dòng hàng, lọc theo trạng thái và tìm kiếm.",
    request: z.object({ status: z.string().default("all"), search: z.string().default(""), actorToken: z.string().optional() }),
    response: z.object({ orders: z.array(orderShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      let rows = await db.select().from(schema.orders).orderBy(desc(schema.orders.id));
      if (args.status !== "all") rows = rows.filter(r => r.status === args.status);
      if (args.search.trim()) {
        const q = args.search.trim().toLowerCase();
        rows = rows.filter(r => r.customerName.toLowerCase().includes(q) || r.orderCode.toLowerCase().includes(q) || r.customerPhone.includes(q));
      }
      const allItems = await db.select().from(schema.orderItems);
      return { orders: rows.map((o) => toOrder(o, allItems)) };
    },
  }),

  createOrder: defineAction({
    description: "Tạo đơn hàng mới. Khi xác nhận (confirmed trở đi) sẽ tự trừ kho và ghi phiếu xuất; giữ hàng (reserved) trừ kho và cộng số lượng giữ. Giá vốn từng dòng được lưu theo giá nhập hiện tại.",
    request: z.object({
      customerName: z.string().min(1), customerPhone: z.string().default(""), customerAddress: z.string().default(""),
      status: z.enum(["pending", "confirmed", "delivering", "completed", "reserved"]).default("pending"),
      note: z.string().default(""),
      items: z.array(z.object({ productId: z.number(), quantity: z.number().int().positive(), unitPrice: z.number().int().min(0) })).min(1),
      actorToken: z.string().optional(), depositAmount: z.number().int().min(0).optional(),
      deliveryPerson: z.string().optional(), deliveryFee: z.number().int().min(0).optional(),
      expectedDelivery: z.string().optional(), reservedUntil: z.string().optional(), requestKey: z.string().optional(),
      expectedVersions: z.record(z.string(), z.number()).optional(),
    }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable(), orderCode: z.string(), id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error, orderCode: "", id: 0 };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ALL_STAFF, "Chỉ nhân viên cửa hàng được tạo đơn hàng.");
      if (roleErr) return { ok: false, error: roleErr, orderCode: "", id: 0 };
      const key = (args.requestKey ?? "").trim();
      if (key) {
        const prev = await checkIdem(db, key, "createOrder");
        if (prev) {
          return { ok: prev["ok"] as boolean, error: (prev["error"] as string | null) ?? null, orderCode: prev["orderCode"] as string, id: prev["id"] as number };
        }
      }
      const isReserved = args.status === "reserved";
      const shouldDeduct = args.status === "confirmed" || args.status === "delivering" || args.status === "completed" || isReserved;
      // validate hết trước khi ghi gì
      const prodMap = new Map<number, ProdRow>();
      const qtyByProduct = new Map<number, number>();
      for (const it of args.items) qtyByProduct.set(it.productId, (qtyByProduct.get(it.productId) ?? 0) + it.quantity);
      for (const it of args.items) {
        if (prodMap.has(it.productId)) continue;
        const p = await getProduct(db, it.productId);
        if (!p) return { ok: false, error: "Có sản phẩm không tồn tại trong kho.", orderCode: "", id: 0 };
        const versionErr = checkExpectedVersion(p, args.expectedVersions);
        if (versionErr) return { ok: false, error: versionErr, orderCode: "", id: 0 };
        prodMap.set(it.productId, p);
      }
      if (shouldDeduct) {
        for (const [pid, totalQty] of qtyByProduct) {
          const p = prodMap.get(pid)!;
          if (totalQty > p.currentStock) {
            return { ok: false, error: `"${p.name}" (${p.sku}) chỉ còn ${p.currentStock} ${p.unit}, không đủ cho đơn ${totalQty} (đã cộng dồn các dòng cùng sản phẩm).`, orderCode: "", id: 0 };
          }
        }
      }
      const depositAmount = args.depositAmount ?? 0;
      const deliveryFee = args.deliveryFee ?? 0;
      const deliveryPerson = (args.deliveryPerson ?? "").trim();
      const expectedDelivery = (args.expectedDelivery ?? "").trim();
      const reservedUntilStr = (args.reservedUntil ?? "").trim();
      const orderCode = genOrderCode();
      const totalAmount = args.items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
      const paymentStatus = depositAmount >= totalAmount && totalAmount > 0 ? "paid" : depositAmount > 0 ? "partial" : "unpaid";
      let reservedUntilMs: Date | null = null;
      if (reservedUntilStr) {
        const parsed = new Date(reservedUntilStr);
        if (!Number.isNaN(parsed.getTime())) reservedUntilMs = parsed;
      }
      const inserted = await db.insert(schema.orders).values({
        orderCode, customerName: args.customerName.trim(), customerPhone: args.customerPhone.trim(), customerAddress: args.customerAddress.trim(),
        status: args.status, totalAmount, note: args.note.trim(), stockDeducted: shouldDeduct ? 1 : 0,
        depositAmount, paymentStatus, deliveryPerson, deliveryFee,
        expectedDelivery, reservedUntil: reservedUntilMs, requestKey: key || null,
      }).returning({ id: schema.orders.id });
      const orderRow = inserted[0];
      if (!orderRow) return { ok: false, error: "Không tạo được đơn.", orderCode: "", id: 0 };
      await batchAll(db, args.items.map((it) => {
        const p = prodMap.get(it.productId)!;
        return db.insert(schema.orderItems).values({
          orderId: orderRow.id, productId: it.productId, productSku: p.sku, productName: p.name, quantity: it.quantity, unitPrice: it.unitPrice, lineTotal: it.quantity * it.unitPrice, costPrice: p.costPrice,
        });
      }));
      if (shouldDeduct) {
        // Saga: trừ kho từng dòng (version-checked); 1 dòng lỗi thì bù trừ hoàn lại rồi xoá đơn vừa tạo.
        const applied: StockApply[] = [];
        const movData: { prod: ProdRow; before: number; after: number; qty: number }[] = [];
        for (const it of args.items) {
          const p = prodMap.get(it.productId)!;
          const before = p.currentStock;
          const after = before - it.quantity;
          const afterReserved = isReserved ? p.reservedQty + it.quantity : p.reservedQty;
          const one = await applyStock(db, p, after, afterReserved);
          if (!one) {
            await compensateStock(db, applied);
            await db.delete(schema.orderItems).where(eq(schema.orderItems.orderId, orderRow.id));
            await db.delete(schema.orders).where(eq(schema.orders.id, orderRow.id));
            return { ok: false, error: VERSION_CONFLICT, orderCode: "", id: 0 };
          }
          trackApplied(p, one);
          applied.push(one);
          movData.push({ prod: p, before, after, qty: it.quantity });
        }
        await batchAll(db, movData.map((m) => db.insert(schema.movements).values({
          productId: m.prod.id, productSku: m.prod.sku, productName: m.prod.name, type: "out", quantity: m.qty, beforeStock: m.before, afterStock: m.after,
          unitCost: args.items.find((i) => i.productId === m.prod.id)?.unitPrice ?? 0,
          reason: isReserved ? "Giữ hàng theo đơn" : "Xuất theo đơn hàng", refCode: orderCode, partner: args.customerName.trim(), note: `Đơn ${orderCode}`, actor: actorName,
        })));
      }
      if (shouldDeduct) {
        await createReceivableDebtIfNeeded(db, { orderCode, customerName: args.customerName.trim(), totalAmount, depositAmount });
      }
      await writeAudit(db, actorName, "create_order", "order", orderRow.id, { orderCode, status: args.status, totalAmount, depositAmount });
      ctx.invalidateQueries();
      const result = { ok: true, error: null as string | null, orderCode, id: orderRow.id };
      await saveIdem(db, key, "createOrder", result);
      return result;
    },
  }),

  updateOrderStatus: defineAction({
    description: "Đổi trạng thái đơn hàng; tự trừ kho khi xác nhận và hoàn kho khi huỷ đơn đã trừ. Trả hàng thì dùng chức năng Trả hàng, không đổi trực tiếp sang returned.",
    request: z.object({
      id: z.number(),
      status: z.enum(["pending", "confirmed", "delivering", "completed", "cancelled", "reserved", "returned", "partially_returned"]),
      actorToken: z.string().optional(),
    }),
    response: z.object({
      ok: z.boolean(), error: z.string().nullable(),
      pendingRestocks: z.array(z.object({ productName: z.string(), quantity: z.number() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error, pendingRestocks: [] };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ALL_STAFF, "Chỉ nhân viên cửa hàng được đổi trạng thái đơn.");
      if (roleErr) return { ok: false, error: roleErr, pendingRestocks: [] };
      const pendingRestocks: { productName: string; quantity: number }[] = [];
      const rows = await db.select().from(schema.orders).where(eq(schema.orders.id, args.id));
      const order = rows[0];
      if (!order) return { ok: false, error: "Không tìm thấy đơn hàng.", pendingRestocks };
      if (args.status === "returned" || args.status === "partially_returned") {
        return { ok: false, error: "Hãy dùng chức năng Trả hàng để trả hàng cho đơn này.", pendingRestocks };
      }
      const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
      const wasDeducted = order.stockDeducted === 1;
      const isReservedOrder = order.status === "reserved";
      const target = args.status;
      const shouldDeductTarget = target === "confirmed" || target === "delivering" || target === "completed";

      // Tải sản phẩm cho mọi dòng (dùng chung cho các nhánh).
      const prodById = new Map<number, ProdRow>();
      for (const it of items) {
        if (prodById.has(it.productId)) continue;
        const p = await getProduct(db, it.productId);
        if (p) prodById.set(it.productId, p);
      }

      if (target === "reserved") {
        if (!isReservedOrder) {
          if (wasDeducted) {
            // confirmed -> reserved: kho đã trừ, chỉ cộng số lượng giữ.
            const applied: StockApply[] = [];
            for (const it of items) {
              const p = prodById.get(it.productId);
              if (!p) return { ok: false, error: `Sản phẩm "${it.productName}" (${it.productSku}) trong đơn đã bị xoá khỏi kho — không thể chuyển sang giữ hàng.`, pendingRestocks };
              const one = await applyStock(db, p, p.currentStock, p.reservedQty + it.quantity);
              if (!one) { await compensateStock(db, applied); return { ok: false, error: VERSION_CONFLICT, pendingRestocks }; }
              trackApplied(p, one);
              applied.push(one);
            }
          } else {
            // pending -> reserved: trừ kho + cộng số lượng giữ.
            const qtyByProduct = new Map<number, number>();
            for (const it of items) qtyByProduct.set(it.productId, (qtyByProduct.get(it.productId) ?? 0) + it.quantity);
            for (const [pid, totalQty] of qtyByProduct) {
              const p = prodById.get(pid);
              if (!p) return { ok: false, error: `Sản phẩm trong đơn đã bị xoá khỏi kho — không thể giữ hàng.`, pendingRestocks };
              if (totalQty > p.currentStock) return { ok: false, error: `"${p.name}" chỉ còn ${p.currentStock}, không đủ để giữ hàng (cần ${totalQty} sau khi cộng dồn các dòng cùng sản phẩm).`, pendingRestocks };
            }
            const applied: StockApply[] = [];
            const movData: { prod: ProdRow; before: number; after: number; qty: number }[] = [];
            for (const it of items) {
              const p = prodById.get(it.productId)!;
              const before = p.currentStock; const after = before - it.quantity;
              const one = await applyStock(db, p, after, p.reservedQty + it.quantity);
              if (!one) { await compensateStock(db, applied); return { ok: false, error: VERSION_CONFLICT, pendingRestocks }; }
              trackApplied(p, one);
              applied.push(one);
              movData.push({ prod: p, before, after, qty: it.quantity });
            }
            await batchAll(db, movData.map((m) => db.insert(schema.movements).values({
              productId: m.prod.id, productSku: m.prod.sku, productName: m.prod.name, type: "out", quantity: m.qty, beforeStock: m.before, afterStock: m.after,
              unitCost: items.find((i) => i.productId === m.prod.id)?.unitPrice ?? 0,
              reason: "Giữ hàng theo đơn", refCode: order.orderCode, partner: order.customerName, note: `Đơn ${order.orderCode}`, actor: actorName,
            })));
          }
          await db.update(schema.orders).set({ status: "reserved", stockDeducted: 1, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
        }
      } else if (shouldDeductTarget) {
        if (isReservedOrder && wasDeducted) {
          // reserved -> confirmed/delivering/completed: kho đã trừ, chỉ trừ số lượng giữ.
          const applied: StockApply[] = [];
          for (const it of items) {
            const p = prodById.get(it.productId);
            if (!p) return { ok: false, error: `Sản phẩm "${it.productName}" (${it.productSku}) trong đơn đã bị xoá khỏi kho — không thể xác nhận đơn.`, pendingRestocks };
            const one = await applyStock(db, p, p.currentStock, Math.max(0, p.reservedQty - it.quantity));
            if (!one) { await compensateStock(db, applied); return { ok: false, error: VERSION_CONFLICT, pendingRestocks }; }
            trackApplied(p, one);
            applied.push(one);
          }
          await db.update(schema.orders).set({ status: target, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
        } else if (!wasDeducted) {
          // Cộng dồn dòng cùng sản phẩm + chặn khi sản phẩm đã bị xoá: không được đánh dấu đã trừ kho khi không có phiếu xuất tương ứng.
          const qtyByProduct = new Map<number, number>();
          for (const it of items) qtyByProduct.set(it.productId, (qtyByProduct.get(it.productId) ?? 0) + it.quantity);
          for (const it of items) {
            if (!prodById.get(it.productId)) {
              return { ok: false, error: `Sản phẩm "${it.productName}" (${it.productSku}) trong đơn đã bị xoá khỏi kho — không thể xác nhận đơn. Hãy huỷ đơn này và tạo đơn mới, hoặc thêm lại sản phẩm.`, pendingRestocks };
            }
          }
          for (const [pid, totalQty] of qtyByProduct) {
            const p = prodById.get(pid)!;
            if (totalQty > p.currentStock) return { ok: false, error: `"${p.name}" chỉ còn ${p.currentStock}, không đủ để xác nhận đơn (cần ${totalQty} sau khi cộng dồn các dòng cùng sản phẩm).`, pendingRestocks };
          }
          const applied: StockApply[] = [];
          const movData: { prod: ProdRow; before: number; after: number; qty: number }[] = [];
          for (const it of items) {
            const p = prodById.get(it.productId)!;
            const before = p.currentStock; const after = before - it.quantity;
            const one = await applyStock(db, p, after, p.reservedQty);
            if (!one) { await compensateStock(db, applied); return { ok: false, error: VERSION_CONFLICT, pendingRestocks }; }
            trackApplied(p, one);
            applied.push(one);
            movData.push({ prod: p, before, after, qty: it.quantity });
          }
          await batchAll(db, movData.map((m) => db.insert(schema.movements).values({
            productId: m.prod.id, productSku: m.prod.sku, productName: m.prod.name, type: "out", quantity: m.qty, beforeStock: m.before, afterStock: m.after,
            unitCost: items.find((i) => i.productId === m.prod.id)?.unitPrice ?? 0,
            reason: "Xuất theo đơn hàng", refCode: order.orderCode, partner: order.customerName, note: `Đơn ${order.orderCode}`, actor: actorName,
          })));
          await db.update(schema.orders).set({ status: target, stockDeducted: 1, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
        } else {
          await db.update(schema.orders).set({ status: target, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
        }
        await createReceivableDebtIfNeeded(db, { orderCode: order.orderCode, customerName: order.customerName, totalAmount: order.totalAmount, depositAmount: order.depositAmount });
      } else if (target === "cancelled" || (target === "pending" && isReservedOrder)) {
        if (wasDeducted) {
          const applied: StockApply[] = [];
          const movData: { prod: ProdRow; before: number; after: number; qty: number }[] = [];
          for (const it of items) {
            // Chỉ hoàn lại phần CHƯA trả (net = số lượng − đã trả): hàng đã trả khách
            // trước đó đã được cộng lại kho lúc trả, hủy đơn không được cộng lần nữa.
            const netQty = Math.max(0, it.quantity - (it.returnedQty ?? 0));
            const p = prodById.get(it.productId);
            if (!p || p.status === "discontinued") {
              // Không bỏ qua im lặng: ghi vào phiếu chờ hoàn kho để xử lý sau.
              if (netQty > 0) {
                pendingRestocks.push({ productName: it.productName, quantity: netQty });
                await db.insert(schema.pendingRestocks).values({
                  orderCode: order.orderCode, productId: it.productId, productSku: it.productSku, productName: it.productName,
                  quantity: netQty, unitPrice: it.unitPrice, reason: "Sản phẩm đã bị xóa/ngưng khi hủy đơn",
                });
              }
              continue;
            }
            if (netQty <= 0) continue; // dòng này đã trả hết: không sinh phiếu hoàn kho
            const before = p.currentStock; const after = before + netQty;
            const afterReserved = isReservedOrder ? Math.max(0, p.reservedQty - it.quantity) : p.reservedQty;
            const one = await applyStock(db, p, after, afterReserved);
            if (!one) { await compensateStock(db, applied); return { ok: false, error: VERSION_CONFLICT, pendingRestocks }; }
            trackApplied(p, one);
            applied.push(one);
            movData.push({ prod: p, before, after, qty: netQty });
          }
          if (movData.length > 0) {
            await batchAll(db, movData.map((m) => db.insert(schema.movements).values({
              productId: m.prod.id, productSku: m.prod.sku, productName: m.prod.name, type: "in", quantity: m.qty, beforeStock: m.before, afterStock: m.after,
              unitCost: items.find((i) => i.productId === m.prod.id)?.unitPrice ?? 0,
              reason: isReservedOrder ? "Hủy giữ hàng" : "Hoàn kho do huỷ đơn", refCode: order.orderCode, partner: order.customerName, note: target === "cancelled" ? `Huỷ đơn ${order.orderCode}` : `Bỏ giữ hàng đơn ${order.orderCode}`, actor: actorName,
            })));
          }
          await db.update(schema.orders).set({ status: target, stockDeducted: 0, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
        } else {
          await db.update(schema.orders).set({ status: target, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
        }
        // Hủy đơn (không áp cho chuyển giữ hàng -> chờ xử lý): void công nợ phải thu của đơn.
        if (target === "cancelled") await voidReceivableDebtForOrder(db, order.orderCode, actorName);
      } else {
        await db.update(schema.orders).set({ status: target, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
      }
      await writeAudit(db, actorName, "update_order_status", "order", order.id, { orderCode: order.orderCode, fromStatus: order.status, toStatus: target, pendingRestocks: pendingRestocks.length });
      ctx.invalidateQueries();
      return { ok: true, error: null, pendingRestocks };
    },
  }),

  createMovementBatch: defineAction({
    description: "Tạo một phiếu nhập/xuất chung (một mã PN/PX) cho nhiều dòng. Một dòng lỗi thì cả phiếu không ghi.",
    request: z.object({
      actorToken: z.string().optional(),
      type: z.enum(["in", "out"]),
      lines: z.array(z.object({
        productId: z.number(), quantity: z.number().int().positive(),
        unitCost: z.number().int().min(0).optional(), reason: z.string().default(""), partner: z.string().default(""), note: z.string().default(""),
      })).min(1),
      requestKey: z.string().optional(),
      expectedVersions: z.record(z.string(), z.number()).optional(),
    }),
    response: z.object({
      ok: z.boolean(), error: z.string().nullable(), refCode: z.string(),
      results: z.array(z.object({ productId: z.number(), newStock: z.number(), version: z.number() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error, refCode: "", results: [] };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được tạo phiếu nhập/xuất.");
      if (roleErr) return { ok: false, error: roleErr, refCode: "", results: [] };
      const key = (args.requestKey ?? "").trim();
      if (key) {
        const prev = await checkIdem(db, key, "createMovementBatch");
        if (prev) {
          return {
            ok: prev["ok"] as boolean, error: (prev["error"] as string | null) ?? null, refCode: prev["refCode"] as string,
            results: prev["results"] as { productId: number; newStock: number; version: number }[],
          };
        }
      }
      // Validate hết trước.
      const prodMap = new Map<number, ProdRow>();
      const qtyByProduct = new Map<number, number>();
      for (const line of args.lines) qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.quantity);
      for (const line of args.lines) {
        if (prodMap.has(line.productId)) continue;
        const p = await getProduct(db, line.productId);
        if (!p) return { ok: false, error: "Có sản phẩm không tồn tại trong kho.", refCode: "", results: [] };
        const versionErr = checkExpectedVersion(p, args.expectedVersions);
        if (versionErr) return { ok: false, error: versionErr, refCode: "", results: [] };
        prodMap.set(line.productId, p);
      }
      if (args.type === "out") {
        for (const [pid, totalQty] of qtyByProduct) {
          const p = prodMap.get(pid)!;
          if (totalQty > p.currentStock) {
            return { ok: false, error: `"${p.name}" (${p.sku}) chỉ còn ${p.currentStock} ${p.unit}, không đủ để xuất ${totalQty} (đã cộng dồn các dòng cùng sản phẩm).`, refCode: "", results: [] };
          }
        }
      }
      const refCode = genRefCode(args.type);
      const applied: StockApply[] = [];
      const movData: { prod: ProdRow; before: number; after: number; line: (typeof args.lines)[number] }[] = [];
      for (const line of args.lines) {
        const p = prodMap.get(line.productId)!;
        const before = p.currentStock;
        const after = args.type === "in" ? before + line.quantity : before - line.quantity;
        const one = await applyStock(db, p, after, p.reservedQty);
        if (!one) { await compensateStock(db, applied); return { ok: false, error: VERSION_CONFLICT, refCode: "", results: [] }; }
        trackApplied(p, one);
        applied.push(one);
        movData.push({ prod: p, before, after, line });
      }
      await batchAll(db, [
        ...movData.map((m) => db.insert(schema.movements).values({
          productId: m.prod.id, productSku: m.prod.sku, productName: m.prod.name, type: args.type, quantity: m.line.quantity,
          beforeStock: m.before, afterStock: m.after,
          unitCost: m.line.unitCost !== undefined && m.line.unitCost > 0 ? m.line.unitCost : (args.type === "in" ? m.prod.costPrice : m.prod.sellPrice),
          reason: m.line.reason, refCode, partner: m.line.partner.trim(), note: m.line.note.trim(), actor: actorName,
        })),
        db.insert(schema.auditLogs).values({ actor: actorName, action: "create_movement_batch", entity: "movement", entityId: 0, details: JSON.stringify({ type: args.type, refCode, lines: args.lines.length }) }),
      ]);
      ctx.invalidateQueries();
      const result = {
        ok: true, error: null as string | null, refCode,
        results: movData.map((m) => ({ productId: m.prod.id, newStock: m.after, version: m.prod.version })),
      };
      await saveIdem(db, key, "createMovementBatch", result);
      return result;
    },
  }),

  createReturn: defineAction({
    description: "Trả hàng từ đơn đã xác nhận/đang giao/hoàn thành: hoàn kho, tăng số lượng đã trả, giảm công nợ phải thu của đơn.",
    request: z.object({
      actorToken: z.string().optional(),
      orderId: z.number(),
      lines: z.array(z.object({ orderItemId: z.number(), quantity: z.number().int().positive() })).min(1),
      reason: z.string().default(""),
    }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable(), refCode: z.string(), newStatus: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error, refCode: "", newStatus: "" };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ALL_STAFF, "Chỉ nhân viên cửa hàng được trả hàng.");
      if (roleErr) return { ok: false, error: roleErr, refCode: "", newStatus: "" };
      const orderRows = await db.select().from(schema.orders).where(eq(schema.orders.id, args.orderId));
      const order = orderRows[0];
      if (!order) return { ok: false, error: "Không tìm thấy đơn hàng.", refCode: "", newStatus: "" };
      if (!["confirmed", "delivering", "completed", "partially_returned"].includes(order.status)) {
        return { ok: false, error: "Chỉ trả hàng được khi đơn đang ở trạng thái đã xác nhận, đang giao, hoàn thành hoặc đã trả một phần.", refCode: "", newStatus: order.status };
      }
      const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
      // Validate hết trước.
      const lineItems: { item: (typeof items)[number]; qty: number; prod: ProdRow }[] = [];
      for (const line of args.lines) {
        const item = items.find((i) => i.id === line.orderItemId);
        if (!item) return { ok: false, error: "Có dòng hàng không thuộc đơn này.", refCode: "", newStatus: order.status };
        const returnable = item.quantity - item.returnedQty;
        if (line.quantity > returnable) {
          return { ok: false, error: `"${item.productName}" chỉ còn trả được ${returnable} (đã trả ${item.returnedQty}/${item.quantity}).`, refCode: "", newStatus: order.status };
        }
        const prod = await getProduct(db, item.productId);
        if (!prod) return { ok: false, error: `Sản phẩm "${item.productName}" đã bị xoá khỏi kho, không thể hoàn kho. Hãy liên hệ quản trị viên.`, refCode: "", newStatus: order.status };
        lineItems.push({ item, qty: line.quantity, prod });
      }
      const applied: StockApply[] = [];
      const movData: { prod: ProdRow; before: number; after: number; qty: number; unitPrice: number }[] = [];
      for (const li of lineItems) {
        const before = li.prod.currentStock;
        const after = before + li.qty;
        const one = await applyStock(db, li.prod, after, li.prod.reservedQty);
        if (!one) { await compensateStock(db, applied); return { ok: false, error: VERSION_CONFLICT, refCode: "", newStatus: order.status }; }
        trackApplied(li.prod, one);
        applied.push(one);
        movData.push({ prod: li.prod, before, after, qty: li.qty, unitPrice: li.item.unitPrice });
      }
      const refundTotal = lineItems.reduce((s, li) => s + li.qty * li.item.unitPrice, 0);
      const newReturned = new Map<number, number>();
      for (const li of lineItems) newReturned.set(li.item.id, li.item.returnedQty + li.qty);
      const allReturned = items.every((i) => (newReturned.get(i.id) ?? i.returnedQty) >= i.quantity);
      const newStatus = allReturned ? "returned" : "partially_returned";
      const debtRows = await db.select().from(schema.debts).where(eq(schema.debts.refCode, order.orderCode));
      const debt = debtRows.find((d) => d.kind === "receivable" && d.status !== "cancelled");
      const stmts: BatchItem<"sqlite">[] = [
        ...movData.map((m) => db.insert(schema.movements).values({
          productId: m.prod.id, productSku: m.prod.sku, productName: m.prod.name, type: "in", quantity: m.qty, beforeStock: m.before, afterStock: m.after,
          unitCost: m.unitPrice, reason: `Trả hàng từ đơn ${order.orderCode}`, refCode: order.orderCode, partner: order.customerName,
          note: args.reason.trim() || `Trả hàng đơn ${order.orderCode}`, actor: actorName,
        })),
        ...lineItems.map((li) => db.update(schema.orderItems).set({ returnedQty: li.item.returnedQty + li.qty }).where(eq(schema.orderItems.id, li.item.id))),
        db.update(schema.orders).set({ status: newStatus, updatedAt: new Date() }).where(eq(schema.orders.id, order.id)),
      ];
      if (debt) {
        const newTotal = Math.max(0, debt.totalAmount - refundTotal);
        const newNote = debt.note ? `${debt.note} | Đã trừ trả hàng: ${refundTotal.toLocaleString("vi-VN")}đ (đơn ${order.orderCode})` : `Đã trừ trả hàng: ${refundTotal.toLocaleString("vi-VN")}đ (đơn ${order.orderCode})`;
        stmts.push(db.update(schema.debts).set({
          totalAmount: newTotal, note: newNote,
          status: newTotal - debt.paidAmount <= 0 ? "paid" : debt.status,
        }).where(eq(schema.debts.id, debt.id)));
      }
      await batchAll(db, stmts);
      // Trả hàng làm công nợ về 0 thì đồng bộ trạng thái thanh toán của đơn
      // (đơn coi như đã thanh toán đủ — không còn nợ).
      if (debt) {
        const debtRemainingAfter = Math.max(0, Math.max(0, debt.totalAmount - refundTotal) - debt.paidAmount);
        if (debtRemainingAfter === 0) await syncOrderPaymentFromDebt(db, order.orderCode, refundTotal, 0);
      }
      await writeAudit(db, actorName, "create_return", "order", order.id, { orderCode: order.orderCode, refundTotal, newStatus, reason: args.reason.trim() });
      ctx.invalidateQueries();
      return { ok: true, error: null, refCode: order.orderCode, newStatus };
    },
  }),

  recordDeposit: defineAction({
    description: "Ghi nhận tiền cọc/thanh toán thêm cho đơn và trừ công nợ phải thu tương ứng.",
    request: z.object({ actorToken: z.string().optional(), orderId: z.number(), amount: z.number().int().positive() }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable(), depositAmount: z.number(), paymentStatus: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error, depositAmount: 0, paymentStatus: "" };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ALL_STAFF, "Chỉ nhân viên cửa hàng được ghi nhận cọc.");
      if (roleErr) return { ok: false, error: roleErr, depositAmount: 0, paymentStatus: "" };
      const orderRows = await db.select().from(schema.orders).where(eq(schema.orders.id, args.orderId));
      const order = orderRows[0];
      if (!order) return { ok: false, error: "Không tìm thấy đơn hàng.", depositAmount: 0, paymentStatus: "" };
      const newDeposit = order.depositAmount + args.amount;
      if (newDeposit > order.totalAmount) {
        return { ok: false, error: `Tiền cọc (${newDeposit.toLocaleString("vi-VN")}đ) vượt quá tổng tiền đơn (${order.totalAmount.toLocaleString("vi-VN")}đ).`, depositAmount: order.depositAmount, paymentStatus: order.paymentStatus };
      }
      const paymentStatus = newDeposit >= order.totalAmount ? "paid" : "partial";
      await db.update(schema.orders).set({ depositAmount: newDeposit, paymentStatus, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
      const debtRows = await db.select().from(schema.debts).where(eq(schema.debts.refCode, order.orderCode));
      const debt = debtRows.find((d) => d.kind === "receivable" && d.status !== "cancelled");
      if (debt) {
        const newPaid = Math.min(debt.totalAmount, debt.paidAmount + args.amount);
        await db.update(schema.debts).set({ paidAmount: newPaid, status: newPaid >= debt.totalAmount ? "paid" : debt.status }).where(eq(schema.debts.id, debt.id));
      }
      await writeAudit(db, actorName, "record_deposit", "order", order.id, { orderCode: order.orderCode, amount: args.amount, depositAmount: newDeposit, paymentStatus });
      ctx.invalidateQueries();
      return { ok: true, error: null, depositAmount: newDeposit, paymentStatus };
    },
  }),

  releaseReservation: defineAction({
    description: "Huỷ giữ hàng: hoàn kho + trừ số lượng giữ, đơn chuyển sang đã huỷ.",
    request: z.object({ actorToken: z.string().optional(), orderId: z.number() }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ALL_STAFF, "Chỉ nhân viên cửa hàng được huỷ giữ hàng.");
      if (roleErr) return { ok: false, error: roleErr };
      const orderRows = await db.select().from(schema.orders).where(eq(schema.orders.id, args.orderId));
      const order = orderRows[0];
      if (!order) return { ok: false, error: "Không tìm thấy đơn hàng." };
      if (order.status !== "reserved") return { ok: false, error: "Chỉ huỷ giữ hàng được khi đơn đang ở trạng thái giữ hàng." };
      const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
      const applied: StockApply[] = [];
      const movData: { prod: ProdRow; before: number; after: number; qty: number }[] = [];
      for (const it of items) {
        const prod = await getProduct(db, it.productId);
        if (!prod) continue; // sản phẩm đã xoá: không hoàn được kho, đơn vẫn huỷ (ghi chú trong audit)
        const before = prod.currentStock; const after = before + it.quantity;
        const one = await applyStock(db, prod, after, Math.max(0, prod.reservedQty - it.quantity));
        if (!one) { await compensateStock(db, applied); return { ok: false, error: VERSION_CONFLICT }; }
        trackApplied(prod, one);
        applied.push(one);
        movData.push({ prod, before, after, qty: it.quantity });
      }
      await batchAll(db, [
        ...movData.map((m) => db.insert(schema.movements).values({
          productId: m.prod.id, productSku: m.prod.sku, productName: m.prod.name, type: "in", quantity: m.qty, beforeStock: m.before, afterStock: m.after,
          unitCost: items.find((i) => i.productId === m.prod.id)?.unitPrice ?? 0,
          reason: "Hủy giữ hàng", refCode: order.orderCode, partner: order.customerName, note: `Hủy giữ hàng đơn ${order.orderCode}`, actor: actorName,
        })),
        db.update(schema.orders).set({ status: "cancelled", stockDeducted: 0, updatedAt: new Date() }).where(eq(schema.orders.id, order.id)),
      ]);
      // Đơn giữ hàng cũng đã sinh công nợ phải thu lúc tạo: hủy giữ thì void công nợ như hủy đơn.
      await voidReceivableDebtForOrder(db, order.orderCode, actorName);
      await writeAudit(db, actorName, "release_reservation", "order", order.id, { orderCode: order.orderCode });
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  reconcileStock: defineAction({
    description: "Tính lại tồn kho từng sản phẩm từ phiếu (nhập cộng, xuất trừ, kiểm kê lấy tồn sau phiếu) và so với tồn hệ thống. apply=true sẽ cập nhật tồn về số tính lại.",
    request: z.object({ actorToken: z.string().optional(), apply: z.boolean().default(false) }),
    response: z.object({
      ok: z.boolean(), error: z.string().nullable(), applied: z.boolean(),
      diffs: z.array(z.object({ productId: z.number(), sku: z.string(), name: z.string(), systemStock: z.number(), calculatedStock: z.number(), diff: z.number() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error, applied: false, diffs: [] };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const products = await db.select().from(schema.products);
      const movements = await db.select().from(schema.movements).orderBy(schema.movements.id);
      const diffs: { productId: number; sku: string; name: string; systemStock: number; calculatedStock: number; diff: number }[] = [];
      for (const p of products) {
        let calc = 0;
        for (const m of movements.filter((x) => x.productId === p.id)) {
          if (m.type === "in") calc += m.quantity;
          else if (m.type === "out") calc -= m.quantity;
          else calc = m.afterStock; // adjust: tồn sau phiếu là số kiểm đếm
        }
        if (calc !== p.currentStock) {
          diffs.push({ productId: p.id, sku: p.sku, name: p.name, systemStock: p.currentStock, calculatedStock: calc, diff: calc - p.currentStock });
        }
      }
      if (!args.apply) return { ok: true, error: null, applied: false, diffs };
      // apply=true: chỉ quản trị viên được chốt lại tồn theo sổ phiếu.
      const roleErr = requireRole(actor, ["admin"], "Chỉ quản trị viên được áp dụng đối chiếu tồn kho.");
      if (roleErr) return { ok: false, error: roleErr, applied: false, diffs };
      const applied: StockApply[] = [];
      const movData: { prod: ProdRow; before: number; after: number }[] = [];
      for (const d of diffs) {
        const prod = products.find((p) => p.id === d.productId)!;
        const one = await applyStock(db, prod, d.calculatedStock, prod.reservedQty);
        if (!one) { await compensateStock(db, applied); return { ok: false, error: VERSION_CONFLICT, applied: false, diffs }; }
        trackApplied(prod, one);
        applied.push(one);
        movData.push({ prod, before: d.systemStock, after: d.calculatedStock });
      }
      await batchAll(db, [
        ...movData.map((m) => db.insert(schema.movements).values({
          productId: m.prod.id, productSku: m.prod.sku, productName: m.prod.name, type: "adjust", quantity: Math.abs(m.after - m.before),
          beforeStock: m.before, afterStock: m.after, unitCost: m.prod.costPrice, reason: "Đối chiếu tồn kho", refCode: genRefCode("adjust"), partner: "", note: "Đối chiếu tồn kho", actor: actorName,
        })),
        ...movData.map((m) => db.insert(schema.auditLogs).values({ actor: actorName, action: "reconcile_stock", entity: "product", entityId: m.prod.id, details: JSON.stringify({ sku: m.prod.sku, systemStock: m.before, calculatedStock: m.after }) })),
      ]);
      ctx.invalidateQueries();
      return { ok: true, error: null, applied: true, diffs };
    },
  }),

  getPendingRestocks: defineAction({
    description: "Danh sách các khoản hoàn kho đang chờ xử lý (sản phẩm bị xoá/ngưng khi huỷ đơn).",
    request: z.object({ actorToken: z.string().optional() }),
    response: z.object({ items: z.array(z.object({
      id: z.number(), orderCode: z.string(), productId: z.number(), productSku: z.string(), productName: z.string(),
      quantity: z.number(), unitPrice: z.number(), reason: z.string(), status: z.string(), createdAt: z.string(),
    })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      const rows = await db.select().from(schema.pendingRestocks).orderBy(desc(schema.pendingRestocks.id));
      return { items: rows.map((r) => ({ id: r.id, orderCode: r.orderCode, productId: r.productId, productSku: r.productSku, productName: r.productName, quantity: r.quantity, unitPrice: r.unitPrice, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString() })) };
    },
  }),

  resolvePendingRestock: defineAction({
    description: "Xử lý một khoản chờ hoàn kho: cộng tồn cho sản phẩm đã được thêm lại (tìm theo mã SKU) và ghi phiếu nhập hoàn kho.",
    request: z.object({ actorToken: z.string().optional(), id: z.number(), productId: z.number().optional() }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được xử lý hoàn kho chờ xử lý.");
      if (roleErr) return { ok: false, error: roleErr };
      const rows = await db.select().from(schema.pendingRestocks).where(eq(schema.pendingRestocks.id, args.id));
      const item = rows[0];
      if (!item) return { ok: false, error: "Không tìm thấy khoản chờ hoàn kho." };
      if (item.status !== "pending") return { ok: false, error: "Khoản chờ hoàn kho này đã được xử lý." };
      let prod: ProdRow | undefined;
      if (args.productId !== undefined) {
        prod = await getProduct(db, args.productId);
      } else {
        const bySku = await db.select().from(schema.products).where(eq(schema.products.sku, item.productSku)).limit(1);
        prod = bySku[0];
      }
      if (!prod) return { ok: false, error: `Chưa tìm thấy sản phẩm với mã SKU "${item.productSku}" trong kho. Hãy thêm lại sản phẩm với đúng mã SKU rồi thử lại.` };
      const before = prod.currentStock;
      const after = before + item.quantity;
      const applied = await applyStock(db, prod, after, prod.reservedQty);
      if (!applied) return { ok: false, error: VERSION_CONFLICT };
      await batchAll(db, [
        db.insert(schema.movements).values({
          productId: prod.id, productSku: prod.sku, productName: prod.name, type: "in", quantity: item.quantity,
          beforeStock: before, afterStock: after, unitCost: item.unitPrice, reason: "Hoàn kho chờ xử lý", refCode: item.orderCode, partner: "", note: `Hoàn kho chờ xử lý từ đơn ${item.orderCode}`, actor: actorName,
        }),
        db.update(schema.pendingRestocks).set({ status: "resolved", resolvedAt: new Date() }).where(eq(schema.pendingRestocks.id, item.id)),
      ]);
      await writeAudit(db, actorName, "resolve_pending_restock", "pending_restock", item.id, { orderCode: item.orderCode, productId: prod.id, sku: prod.sku, quantity: item.quantity });
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  loginStaff: defineAction({
    description: "Đăng nhập nhân viên bằng mã PIN. Tài khoản quản trị mặc định (tên 'Chủ cửa hàng', PIN 123456, bắt buộc đổi PIN) được tạo tự động khi chưa có nhân viên nào.",
    request: z.object({ pin: z.string().min(1) }),
    response: z.object({
      ok: z.boolean(), token: z.string(), error: z.string().nullable(),
      staff: z.object({ id: z.number(), name: z.string(), role: z.string(), mustChangePin: z.number() }).nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureAdminSeed(db);
      const now = Date.now();
      const allStaff = await db.select().from(schema.staff).where(eq(schema.staff.active, 1));
      // Chống dò PIN (đơn giản): đăng nhập chỉ dùng mã PIN nên lần sai không gắn được
      // với một tài khoản cụ thể — mỗi lần sai tăng bộ đếm cho mọi tài khoản đang hoạt
      // động; đủ 5 lần sai liên tiếp thì khóa toàn bộ đăng nhập 15 phút.
      let matched: StaffRow | null = null;
      for (const st of allStaff) {
        if (st.lockedUntil && st.lockedUntil.getTime() > now) continue; // đang bị khóa: không cho khớp
        const hashed = await hashPin(args.pin, st.pinSalt);
        if (hashed === st.pinHash) { matched = st; break; }
      }
      if (!matched) {
        const anyLocked = allStaff.some((st) => st.lockedUntil && st.lockedUntil.getTime() > now);
        for (const st of allStaff) {
          if (st.lockedUntil && st.lockedUntil.getTime() > now) continue; // đang bị khóa: giữ nguyên
          // Khóa đã hết hạn thì đếm lại từ đầu (1 lần sai này), không khóa ngay lại.
          const expiredLock = st.lockedUntil && st.lockedUntil.getTime() <= now;
          const attempts = expiredLock ? 1 : (st.failedAttempts ?? 0) + 1;
          await db.update(schema.staff).set({
            failedAttempts: attempts,
            lockedUntil: attempts >= 5 ? new Date(now + 15 * 60 * 1000) : null,
          }).where(eq(schema.staff.id, st.id));
        }
        if (anyLocked) return { ok: false, token: "", error: "Tài khoản tạm khóa 15 phút do nhập sai mã PIN quá nhiều lần. Vui lòng thử lại sau.", staff: null };
        return { ok: false, token: "", error: "Mã PIN không đúng.", staff: null };
      }
      const token = newToken();
      const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
      await batchAll(db, [
        db.insert(schema.staffSessions).values({ token, staffId: matched.id, expiresAt }),
        db.update(schema.staff).set({ failedAttempts: 0, lockedUntil: null }).where(eq(schema.staff.id, matched.id)),
      ]);
      return { ok: true, token, error: null, staff: { id: matched.id, name: matched.name, role: matched.role, mustChangePin: matched.mustChangePin } };
    },
  }),

  changePin: defineAction({
    description: "Đổi mã PIN của nhân viên đang đăng nhập (4–8 chữ số).",
    request: z.object({ token: z.string().min(1), oldPin: z.string().min(1), newPin: z.string().min(1) }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (!/^\d{4,8}$/.test(args.newPin)) return { ok: false, error: "Mã PIN mới phải gồm 4–8 chữ số." };
      const actor = await resolveActor(db, args.token);
      if (!actor) return { ok: false, error: "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại." };
      const hashedOld = await hashPin(args.oldPin, actor.pinSalt);
      if (hashedOld !== actor.pinHash) return { ok: false, error: "Mã PIN cũ không đúng." };
      const salt = randomHex(16);
      const pinHash = await hashPin(args.newPin, salt);
      await db.update(schema.staff).set({ pinHash, pinSalt: salt, mustChangePin: 0 }).where(eq(schema.staff.id, actor.id));
      await writeAudit(db, actor.name, "change_pin", "staff", actor.id, {});
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  listStaff: defineAction({
    description: "Danh sách nhân viên (chỉ quản trị viên đã đăng nhập).",
    request: z.object({ actorToken: z.string().optional() }),
    response: z.object({
      staff: z.array(z.object({ id: z.number(), name: z.string(), role: z.string(), active: z.number(), mustChangePin: z.number() })),
      error: z.string().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureAdminSeed(db);
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { staff: [], error: auth.error };
      const actor = auth.actor;
      if (actor.role !== "admin") return { staff: [], error: "Chỉ quản trị viên được xem danh sách nhân viên." };
      const rows = await db.select().from(schema.staff).orderBy(schema.staff.id);
      return { staff: rows.map((s) => ({ id: s.id, name: s.name, role: s.role, active: s.active, mustChangePin: s.mustChangePin })), error: null };
    },
  }),

  createStaff: defineAction({
    description: "Thêm nhân viên mới (chỉ quản trị viên đã đăng nhập).",
    request: z.object({ actorToken: z.string().optional(), name: z.string().min(1), role: z.enum(["admin", "storekeeper", "sales"]), pin: z.string().min(1) }),
    response: z.object({ ok: z.boolean(), id: z.number(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureAdminSeed(db);
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, id: 0, error: auth.error };
      const actor = auth.actor;
      const roleErr = requireRole(actor, ["admin"], "Chỉ quản trị viên được thêm nhân viên.");
      if (roleErr) return { ok: false, id: 0, error: roleErr };
      if (!/^\d{4,8}$/.test(args.pin)) return { ok: false, id: 0, error: "Mã PIN phải gồm 4–8 chữ số." };
      const salt = randomHex(16);
      const pinHash = await hashPin(args.pin, salt);
      const inserted = await db.insert(schema.staff).values({ name: args.name.trim(), role: args.role, pinHash, pinSalt: salt, active: 1, mustChangePin: 0 }).returning({ id: schema.staff.id });
      const row = inserted[0];
      if (!row) return { ok: false, id: 0, error: "Không tạo được nhân viên." };
      await writeAudit(db, actorNameOf(actor), "create_staff", "staff", row.id, { name: args.name.trim(), role: args.role });
      ctx.invalidateQueries();
      return { ok: true, id: row.id, error: null };
    },
  }),

  setStaffActive: defineAction({
    description: "Bật/tắt tài khoản nhân viên (chỉ quản trị viên; không cho vô hiệu hoá quản trị viên cuối cùng còn hoạt động).",
    request: z.object({ actorToken: z.string().optional(), id: z.number(), active: z.number().int().min(0).max(1) }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureAdminSeed(db);
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error };
      const actor = auth.actor;
      const roleErr = requireRole(actor, ["admin"], "Chỉ quản trị viên được thay đổi trạng thái nhân viên.");
      if (roleErr) return { ok: false, error: roleErr };
      const rows = await db.select().from(schema.staff).where(eq(schema.staff.id, args.id));
      const st = rows[0];
      if (!st) return { ok: false, error: "Không tìm thấy nhân viên." };
      if (args.active === 0 && st.role === "admin") {
        const activeAdmins = await db.select().from(schema.staff);
        const count = activeAdmins.filter((s) => s.role === "admin" && s.active === 1).length;
        if (count <= 1) return { ok: false, error: "Không thể vô hiệu hoá quản trị viên cuối cùng còn hoạt động." };
      }
      await db.update(schema.staff).set({ active: args.active }).where(eq(schema.staff.id, args.id));
      await writeAudit(db, actorNameOf(actor), "set_staff_active", "staff", st.id, { name: st.name, active: args.active });
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  listAuditLogs: defineAction({
    description: "Nhật ký thao tác, lọc theo tên người thực hiện và khoảng ngày.",
    request: z.object({ actorToken: z.string().optional(), actor: z.string().default(""), from: z.string().default(""), to: z.string().default(""), limit: z.number().int().positive().max(500).default(200) }),
    response: z.object({ logs: z.array(z.object({ id: z.number(), actor: z.string(), action: z.string(), entity: z.string(), entityId: z.number(), details: z.string(), createdAt: z.string() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      let rows = await db.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.id));
      if (args.actor.trim()) {
        const q = args.actor.trim().toLowerCase();
        rows = rows.filter((r) => r.actor.toLowerCase().includes(q));
      }
      if (args.from.trim()) {
        const fromMs = new Date(args.from.trim()).getTime();
        if (!Number.isNaN(fromMs)) rows = rows.filter((r) => r.createdAt.getTime() >= fromMs);
      }
      if (args.to.trim()) {
        const toRaw = args.to.trim();
        let toMs: number;
        if (/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
          // Ngày dạng YYYY-MM-DD: lấy tới cuối ngày.
          const d = new Date(`${toRaw}T23:59:59.999`);
          toMs = d.getTime();
        } else {
          toMs = new Date(toRaw).getTime();
        }
        if (!Number.isNaN(toMs)) rows = rows.filter((r) => r.createdAt.getTime() <= toMs);
      }
      rows = rows.slice(0, args.limit);
      return { logs: rows.map((r) => ({ id: r.id, actor: r.actor, action: r.action, entity: r.entity, entityId: r.entityId, details: r.details, createdAt: r.createdAt.toISOString() })) };
    },
  }),

  listPriceHistory: defineAction({
    description: "Lịch sử thay đổi giá nhập/giá bán của sản phẩm.",
    request: z.object({ actorToken: z.string().optional(), productId: z.number().optional() }),
    response: z.object({ history: z.array(z.object({
      id: z.number(), productId: z.number(), productSku: z.string(), productName: z.string(),
      oldCost: z.number(), newCost: z.number(), oldSell: z.number(), newSell: z.number(),
      actor: z.string(), reason: z.string(), createdAt: z.string(),
    })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      let rows = await db.select().from(schema.priceHistory).orderBy(desc(schema.priceHistory.id));
      if (args.productId !== undefined) rows = rows.filter((r) => r.productId === args.productId);
      const products = await db.select().from(schema.products);
      const prodById = new Map(products.map((p) => [p.id, p]));
      return { history: rows.map((r) => {
        const p = prodById.get(r.productId);
        return { id: r.id, productId: r.productId, productSku: p?.sku ?? "", productName: p?.name ?? "", oldCost: r.oldCost, newCost: r.newCost, oldSell: r.oldSell, newSell: r.newSell, actor: r.actor, reason: r.reason, createdAt: r.createdAt.toISOString() };
      }) };
    },
  }),

  exportBackup: defineAction({
    description: "Xuất toàn bộ dữ liệu kho thành chuỗi JSON để sao lưu (không gồm mã PIN nhân viên).",
    request: z.object({ actorToken: z.string().optional() }),
    response: z.object({ ok: z.boolean(), data: z.string(), error: z.string().nullable(), note: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, data: "", error: auth.error, note: BACKUP_PIN_NOTE };
      const actor = auth.actor;
      const roleErr = requireRole(actor, ["admin"], "Chỉ quản trị viên được xuất sao lưu.");
      if (roleErr) return { ok: false, data: "", error: roleErr, note: BACKUP_PIN_NOTE };
      try {
        const dataObj = await buildBackupData(db);
        return { ok: true, data: JSON.stringify(dataObj), error: null, note: BACKUP_PIN_NOTE };
      } catch {
        return { ok: false, data: "", error: "Không xuất được bản sao lưu.", note: BACKUP_PIN_NOTE };
      }
    },
  }),

  createBackupSnapshot: defineAction({
    description: "Lưu một bản sao lưu (snapshot) vào bảng backups trên máy chủ.",
    request: z.object({ actorToken: z.string().optional() }),
    response: z.object({ ok: z.boolean(), id: z.number(), size: z.number(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, id: 0, size: 0, error: auth.error };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được tạo bản sao lưu.");
      if (roleErr) return { ok: false, id: 0, size: 0, error: roleErr };
      try {
        const dataObj = await buildBackupData(db);
        const data = JSON.stringify(dataObj);
        const size = new TextEncoder().encode(data).length;
        const inserted = await db.insert(schema.backups).values({ createdBy: actorName, sizeBytes: size, data }).returning({ id: schema.backups.id });
        const row = inserted[0];
        if (!row) return { ok: false, id: 0, size: 0, error: "Không lưu được bản sao lưu." };
        await writeAudit(db, actorName, "create_backup", "backup", row.id, { sizeBytes: size });
        ctx.invalidateQueries();
        return { ok: true, id: row.id, size, error: null };
      } catch {
        return { ok: false, id: 0, size: 0, error: "Không lưu được bản sao lưu." };
      }
    },
  }),

  listBackups: defineAction({
    description: "Danh sách các bản sao lưu đã lưu trên máy chủ.",
    request: z.object({ actorToken: z.string().optional() }),
    response: z.object({ backups: z.array(z.object({ id: z.number(), createdAt: z.string(), createdBy: z.string(), sizeBytes: z.number() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      const rows = await db.select().from(schema.backups).orderBy(desc(schema.backups.id));
      return { backups: rows.map((b) => ({ id: b.id, createdAt: b.createdAt.toISOString(), createdBy: b.createdBy, sizeBytes: b.sizeBytes })) };
    },
  }),

  restoreBackup: defineAction({
    description: "Khôi phục dữ liệu từ một bản sao lưu (chỉ quản trị viên đã đăng nhập). Nhân viên hiện tại giữ nguyên mã PIN; nhân viên mới trong bản sao lưu nhận PIN mặc định 123456 và bắt buộc đổi PIN.",
    request: z.object({ actorToken: z.string().optional(), backupId: z.number() }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error };
      const actor = auth.actor;
      if (actor.role !== "admin") return { ok: false, error: "Chỉ quản trị viên được khôi phục dữ liệu." };
      const rows = await db.select().from(schema.backups).where(eq(schema.backups.id, args.backupId));
      const backup = rows[0];
      if (!backup) return { ok: false, error: "Không tìm thấy bản sao lưu." };
      let snap: Record<string, unknown>;
      try {
        snap = JSON.parse(backup.data) as Record<string, unknown>;
      } catch {
        return { ok: false, error: "Bản sao lưu bị hỏng, không đọc được." };
      }
      const arr = (key: string): Record<string, unknown>[] => (Array.isArray(snap[key]) ? (snap[key] as Record<string, unknown>[]) : []);
      const toDate = (v: unknown): Date => new Date(String(v ?? new Date(0)));
      const toDateOrNull = (v: unknown): Date | null => (v === null || v === undefined || v === "" ? null : new Date(String(v)));
      // Xoá toàn bộ dữ liệu các bảng nghiệp vụ (giữ lại staff + backups).
      await batchAll(db, [
        db.delete(schema.orderItems),
        db.delete(schema.orders),
        db.delete(schema.movements),
        db.delete(schema.products),
        db.delete(schema.suppliers),
        db.delete(schema.categories),
        db.delete(schema.debts),
        db.delete(schema.debtPayments),
        db.delete(schema.priceHistory),
        db.delete(schema.stocktakes),
        db.delete(schema.stocktakeItems),
        db.delete(schema.pendingRestocks),
        db.delete(schema.auditLogs),
        db.delete(schema.idempotencyKeys),
      ]);
      for (const p of arr("products")) {
        await db.insert(schema.products).values({
          id: p["id"] as number, sku: String(p["sku"] ?? ""), name: String(p["name"] ?? ""), category: String(p["category"] ?? "Khác"),
          brand: String(p["brand"] ?? ""), unit: String(p["unit"] ?? "cái"),
          costPrice: (p["costPrice"] as number) ?? 0, sellPrice: (p["sellPrice"] as number) ?? 0,
          currentStock: (p["currentStock"] as number) ?? 0, minStock: (p["minStock"] as number) ?? 5,
          location: String(p["location"] ?? ""), notes: String(p["notes"] ?? ""),
          version: (p["version"] as number) ?? 0, status: (p["status"] as "active" | "discontinued") ?? "active",
          reservedQty: (p["reservedQty"] as number) ?? 0,
          createdAt: toDate(p["createdAt"]), updatedAt: toDate(p["updatedAt"]),
        });
      }
      for (const m of arr("movements")) {
        await db.insert(schema.movements).values({
          id: m["id"] as number, productId: (m["productId"] as number) ?? 0, productSku: String(m["productSku"] ?? ""), productName: String(m["productName"] ?? ""),
          type: (m["type"] as "in" | "out" | "adjust") ?? "in", quantity: (m["quantity"] as number) ?? 0,
          beforeStock: (m["beforeStock"] as number) ?? 0, afterStock: (m["afterStock"] as number) ?? 0, unitCost: (m["unitCost"] as number) ?? 0,
          reason: String(m["reason"] ?? ""), refCode: String(m["refCode"] ?? ""), partner: String(m["partner"] ?? ""), note: String(m["note"] ?? ""),
          requestKey: (m["requestKey"] as string | null) ?? null, actor: String(m["actor"] ?? ""), createdAt: toDate(m["createdAt"]),
        });
      }
      for (const s of arr("suppliers")) {
        await db.insert(schema.suppliers).values({
          id: s["id"] as number, name: String(s["name"] ?? ""), contactPerson: String(s["contactPerson"] ?? ""), phone: String(s["phone"] ?? ""),
          email: String(s["email"] ?? ""), address: String(s["address"] ?? ""), notes: String(s["notes"] ?? ""), createdAt: toDate(s["createdAt"]),
        });
      }
      for (const c of arr("categories")) {
        await db.insert(schema.categories).values({ id: c["id"] as number, name: String(c["name"] ?? ""), createdAt: toDate(c["createdAt"]) });
      }
      for (const o of arr("orders")) {
        await db.insert(schema.orders).values({
          id: o["id"] as number, orderCode: String(o["orderCode"] ?? ""), customerName: String(o["customerName"] ?? ""),
          customerPhone: String(o["customerPhone"] ?? ""), customerAddress: String(o["customerAddress"] ?? ""),
          status: String(o["status"] ?? "pending") as typeof schema.orders.$inferInsert.status,
          totalAmount: (o["totalAmount"] as number) ?? 0, note: String(o["note"] ?? ""), stockDeducted: (o["stockDeducted"] as number) ?? 0,
          depositAmount: (o["depositAmount"] as number) ?? 0,
          paymentStatus: (o["paymentStatus"] as "unpaid" | "partial" | "paid") ?? "unpaid",
          deliveryPerson: String(o["deliveryPerson"] ?? ""), deliveryFee: (o["deliveryFee"] as number) ?? 0,
          expectedDelivery: String(o["expectedDelivery"] ?? ""), reservedUntil: toDateOrNull(o["reservedUntil"]),
          requestKey: (o["requestKey"] as string | null) ?? null,
          createdAt: toDate(o["createdAt"]), updatedAt: toDate(o["updatedAt"]),
        });
      }
      for (const i of arr("orderItems")) {
        await db.insert(schema.orderItems).values({
          id: i["id"] as number, orderId: (i["orderId"] as number) ?? 0, productId: (i["productId"] as number) ?? 0,
          productSku: String(i["productSku"] ?? ""), productName: String(i["productName"] ?? ""), quantity: (i["quantity"] as number) ?? 0,
          unitPrice: (i["unitPrice"] as number) ?? 0, lineTotal: (i["lineTotal"] as number) ?? 0,
          returnedQty: (i["returnedQty"] as number) ?? 0, costPrice: (i["costPrice"] as number) ?? 0,
        });
      }
      for (const d of arr("debts")) {
        await db.insert(schema.debts).values({
          id: d["id"] as number, partnerName: String(d["partnerName"] ?? ""), partnerType: (d["partnerType"] as "customer" | "supplier") ?? "customer",
          kind: (d["kind"] as "receivable" | "payable") ?? "receivable", totalAmount: (d["totalAmount"] as number) ?? 0,
          paidAmount: (d["paidAmount"] as number) ?? 0, dueDate: String(d["dueDate"] ?? ""), refCode: String(d["refCode"] ?? ""),
          note: String(d["note"] ?? ""), status: (d["status"] as "open" | "paid" | "overdue" | "cancelled") ?? "open", createdAt: toDate(d["createdAt"]),
        });
      }
      for (const dp of arr("debtPayments")) {
        await db.insert(schema.debtPayments).values({
          id: dp["id"] as number, debtId: (dp["debtId"] as number) ?? 0, amount: (dp["amount"] as number) ?? 0,
          method: String(dp["method"] ?? ""), note: String(dp["note"] ?? ""), createdAt: toDate(dp["createdAt"]),
        });
      }
      for (const ph of arr("priceHistory")) {
        await db.insert(schema.priceHistory).values({
          id: ph["id"] as number, productId: (ph["productId"] as number) ?? 0, oldCost: (ph["oldCost"] as number) ?? 0,
          newCost: (ph["newCost"] as number) ?? 0, oldSell: (ph["oldSell"] as number) ?? 0, newSell: (ph["newSell"] as number) ?? 0,
          actor: String(ph["actor"] ?? ""), reason: String(ph["reason"] ?? ""), createdAt: toDate(ph["createdAt"]),
        });
      }
      for (const st of arr("stocktakes")) {
        await db.insert(schema.stocktakes).values({
          id: st["id"] as number, code: String(st["code"] ?? ""), note: String(st["note"] ?? ""), status: (st["status"] as "draft" | "closed") ?? "draft",
          createdBy: String(st["createdBy"] ?? ""), createdAt: toDate(st["createdAt"]), closedAt: toDateOrNull(st["closedAt"]),
        });
      }
      for (const si of arr("stocktakeItems")) {
        await db.insert(schema.stocktakeItems).values({
          id: si["id"] as number, stocktakeId: (si["stocktakeId"] as number) ?? 0, productId: (si["productId"] as number) ?? 0,
          productSku: String(si["productSku"] ?? ""), productName: String(si["productName"] ?? ""), countedQty: (si["countedQty"] as number) ?? 0,
          systemQty: (si["systemQty"] as number) ?? 0, diffQty: (si["diffQty"] as number) ?? 0, note: String(si["note"] ?? ""),
        });
      }
      for (const pr of arr("pendingRestocks")) {
        await db.insert(schema.pendingRestocks).values({
          id: pr["id"] as number, orderCode: String(pr["orderCode"] ?? ""), productId: (pr["productId"] as number) ?? 0,
          productSku: String(pr["productSku"] ?? ""), productName: String(pr["productName"] ?? ""), quantity: (pr["quantity"] as number) ?? 0,
          unitPrice: (pr["unitPrice"] as number) ?? 0, reason: String(pr["reason"] ?? ""),
          status: (pr["status"] as "pending" | "resolved") ?? "pending",
          createdAt: toDate(pr["createdAt"]), resolvedAt: toDateOrNull(pr["resolvedAt"]),
        });
      }
      for (const a of arr("auditLogs")) {
        await db.insert(schema.auditLogs).values({
          id: a["id"] as number, actor: String(a["actor"] ?? ""), action: String(a["action"] ?? ""), entity: String(a["entity"] ?? ""),
          entityId: (a["entityId"] as number) ?? 0, details: String(a["details"] ?? "{}"), createdAt: toDate(a["createdAt"]),
        });
      }
      // Staff: giữ nguyên staff hiện tại (không ghi đè PIN); chỉ thêm staff mới trong backup.
      const currentStaff = await db.select().from(schema.staff);
      const existingNames = new Set(currentStaff.map((s) => s.name));
      for (const s of arr("staff")) {
        const name = String(s["name"] ?? "");
        if (!name || existingNames.has(name)) continue;
        const salt = randomHex(16);
        const pinHash = await hashPin("123456", salt);
        await db.insert(schema.staff).values({
          name, role: (s["role"] as "admin" | "storekeeper" | "sales") ?? "sales", pinHash, pinSalt: salt,
          active: (s["active"] as number) ?? 1, mustChangePin: 1, createdAt: toDate(s["createdAt"]),
        });
        existingNames.add(name);
      }
      await writeAudit(db, actor.name, "restore_backup", "backup", backup.id, { backupId: backup.id, exportedAt: snap["exportedAt"] ?? null });
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  listDebts: defineAction({
    description: "Danh sách công nợ phải thu/phải trả, kèm số còn lại.",
    request: z.object({ actorToken: z.string().optional(), kind: z.enum(["receivable", "payable", "all"]).default("all") }),
    response: z.object({ debts: z.array(z.object({
      id: z.number(), partnerName: z.string(), partnerType: z.string(), kind: z.string(),
      totalAmount: z.number(), paidAmount: z.number(), remaining: z.number(), dueDate: z.string(),
      refCode: z.string(), note: z.string(), status: z.string(), createdAt: z.string(),
    })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      let rows = await db.select().from(schema.debts).orderBy(desc(schema.debts.id));
      if (args.kind !== "all") rows = rows.filter((r) => r.kind === args.kind);
      return { debts: rows.map(toDebt) };
    },
  }),

  recordDebtPayment: defineAction({
    description: "Ghi nhận một khoản thu/chi công nợ.",
    request: z.object({ actorToken: z.string().optional(), debtId: z.number(), amount: z.number().int().positive(), method: z.string().default(""), note: z.string().default("") }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable(), remaining: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error, remaining: 0 };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ALL_STAFF, "Chỉ nhân viên cửa hàng được ghi nhận thanh toán công nợ.");
      if (roleErr) return { ok: false, error: roleErr, remaining: 0 };
      const rows = await db.select().from(schema.debts).where(eq(schema.debts.id, args.debtId));
      const debt = rows[0];
      if (!debt) return { ok: false, error: "Không tìm thấy khoản công nợ.", remaining: 0 };
      const remaining = Math.max(0, debt.totalAmount - debt.paidAmount);
      if (args.amount > remaining) {
        return { ok: false, error: `Số tiền vượt quá số còn nợ (${remaining.toLocaleString("vi-VN")}đ).`, remaining };
      }
      const newPaid = debt.paidAmount + args.amount;
      const newRemaining = Math.max(0, debt.totalAmount - newPaid);
      await batchAll(db, [
        db.update(schema.debts).set({ paidAmount: newPaid, status: newRemaining === 0 ? "paid" : debt.status }).where(eq(schema.debts.id, debt.id)),
        db.insert(schema.debtPayments).values({ debtId: debt.id, amount: args.amount, method: args.method.trim(), note: args.note.trim() }),
      ]);
      // Đồng bộ đơn hàng gắn với công nợ phải thu này: tiền vừa thu cộng vào cọc,
      // thu đủ thì đơn chuyển sang đã thanh toán đủ.
      if (debt.kind === "receivable" && debt.refCode) {
        await syncOrderPaymentFromDebt(db, debt.refCode, args.amount, newRemaining);
      }
      await writeAudit(db, actorName, "record_debt_payment", "debt", debt.id, { partnerName: debt.partnerName, amount: args.amount, method: args.method.trim(), remaining: newRemaining });
      ctx.invalidateQueries();
      return { ok: true, error: null, remaining: newRemaining };
    },
  }),

  createStocktake: defineAction({
    description: "Tạo phiếu kiểm kê mới (mã KK-YYYYMMDD-xxxx).",
    request: z.object({ actorToken: z.string().optional(), note: z.string().default("") }),
    response: z.object({ ok: z.boolean(), id: z.number(), code: z.string(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, id: 0, code: "", error: auth.error };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được tạo đợt kiểm kê.");
      if (roleErr) return { ok: false, id: 0, code: "", error: roleErr };
      let code = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = genStocktakeCode();
        const dup = await db.select().from(schema.stocktakes).where(eq(schema.stocktakes.code, candidate)).limit(1);
        if (dup.length === 0) { code = candidate; break; }
      }
      if (!code) return { ok: false, id: 0, code: "", error: "Không sinh được mã kiểm kê, vui lòng thử lại." };
      const inserted = await db.insert(schema.stocktakes).values({ code, note: args.note.trim(), status: "draft", createdBy: actorName }).returning({ id: schema.stocktakes.id });
      const row = inserted[0];
      if (!row) return { ok: false, id: 0, code: "", error: "Không tạo được phiếu kiểm kê." };
      await writeAudit(db, actorName, "create_stocktake", "stocktake", row.id, { code });
      ctx.invalidateQueries();
      return { ok: true, id: row.id, code, error: null };
    },
  }),

  listStocktakes: defineAction({
    description: "Danh sách phiếu kiểm kê kèm các dòng đã đếm.",
    request: z.object({ actorToken: z.string().optional() }),
    response: z.object({ stocktakes: z.array(z.object({
      id: z.number(), code: z.string(), note: z.string(), status: z.string(), createdBy: z.string(),
      createdAt: z.string(), closedAt: z.string().nullable(),
      items: z.array(z.object({ id: z.number(), productId: z.number(), productSku: z.string(), productName: z.string(), countedQty: z.number(), systemQty: z.number(), diffQty: z.number(), note: z.string() })),
    })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      const takes = await db.select().from(schema.stocktakes).orderBy(desc(schema.stocktakes.id));
      const allItems = await db.select().from(schema.stocktakeItems);
      return { stocktakes: takes.map((t) => ({
        id: t.id, code: t.code, note: t.note, status: t.status, createdBy: t.createdBy,
        createdAt: t.createdAt.toISOString(), closedAt: t.closedAt ? t.closedAt.toISOString() : null,
        items: allItems.filter((i) => i.stocktakeId === t.id).map((i) => ({ id: i.id, productId: i.productId, productSku: i.productSku, productName: i.productName, countedQty: i.countedQty, systemQty: i.systemQty, diffQty: i.diffQty, note: i.note })),
      })) };
    },
  }),

  saveStocktakeItem: defineAction({
    description: "Lưu một dòng đếm trong phiếu kiểm kê nháp (tồn hệ thống lấy tại thời điểm lưu).",
    request: z.object({ actorToken: z.string().optional(), stocktakeId: z.number(), productId: z.number(), countedQty: z.number().int().min(0), note: z.string().default("") }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error };
      const actor = auth.actor;
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được lưu số đếm kiểm kê.");
      if (roleErr) return { ok: false, error: roleErr };
      const takeRows = await db.select().from(schema.stocktakes).where(eq(schema.stocktakes.id, args.stocktakeId));
      const take = takeRows[0];
      if (!take) return { ok: false, error: "Không tìm thấy phiếu kiểm kê." };
      if (take.status !== "draft") return { ok: false, error: "Phiếu kiểm kê đã đóng, không sửa được." };
      const prod = await getProduct(db, args.productId);
      if (!prod) return { ok: false, error: "Sản phẩm không tồn tại." };
      const systemQty = prod.currentStock;
      const diffQty = args.countedQty - systemQty;
      const existing = await db.select().from(schema.stocktakeItems).where(and(eq(schema.stocktakeItems.stocktakeId, args.stocktakeId), eq(schema.stocktakeItems.productId, args.productId))).limit(1);
      const row = existing[0];
      if (row) {
        await db.update(schema.stocktakeItems).set({ countedQty: args.countedQty, systemQty, diffQty, note: args.note.trim() }).where(eq(schema.stocktakeItems.id, row.id));
      } else {
        await db.insert(schema.stocktakeItems).values({
          stocktakeId: args.stocktakeId, productId: prod.id, productSku: prod.sku, productName: prod.name,
          countedQty: args.countedQty, systemQty, diffQty, note: args.note.trim(),
        });
      }
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  closeStocktake: defineAction({
    description: "Đóng phiếu kiểm kê: mỗi dòng lệch áp chênh lệch lúc đếm (đếm − sổ lúc đếm) vào tồn hiện tại lúc chốt, để không mất hàng nhập/xuất xen giữa lúc đếm và lúc chốt.",
    request: z.object({ actorToken: z.string().optional(), stocktakeId: z.number() }),
    response: z.object({
      ok: z.boolean(), error: z.string().nullable(),
      diffs: z.array(z.object({ productSku: z.string(), productName: z.string(), systemQty: z.number(), countedQty: z.number(), diff: z.number(), systemQtyAtCount: z.number(), systemQtyAtClose: z.number(), appliedDiff: z.number() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, error: auth.error, diffs: [] };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được chốt kiểm kê.");
      if (roleErr) return { ok: false, error: roleErr, diffs: [] };
      const takeRows = await db.select().from(schema.stocktakes).where(eq(schema.stocktakes.id, args.stocktakeId));
      const take = takeRows[0];
      if (!take) return { ok: false, error: "Không tìm thấy phiếu kiểm kê.", diffs: [] };
      if (take.status !== "draft") return { ok: false, error: "Phiếu kiểm kê đã đóng.", diffs: [] };
      const items = await db.select().from(schema.stocktakeItems).where(eq(schema.stocktakeItems.stocktakeId, take.id));
      const diffItems = items.filter((i) => i.diffQty !== 0);
      const diffs: { productSku: string; productName: string; systemQty: number; countedQty: number; diff: number; systemQtyAtCount: number; systemQtyAtClose: number; appliedDiff: number }[] = [];
      const applied: StockApply[] = [];
      const movData: { prod: ProdRow; item: (typeof items)[number]; before: number; after: number }[] = [];
      for (const item of diffItems) {
        const prod = await getProduct(db, item.productId);
        if (!prod || prod.status === "discontinued") return { ok: false, error: `Sản phẩm "${item.productName}" đã bị xoá hoặc ngưng kinh doanh, không thể điều chỉnh tồn.`, diffs };
        // Chốt theo delta: chênh lệch ghi lúc đếm (đếm − sổ lúc đếm) được cộng vào
        // tồn HIỆN TẠI lúc chốt, để không nuốt mất hàng nhập/xuất xen giữa lúc đếm và lúc chốt.
        // VD: sổ lúc đếm 4, đếm được 9 (diff +5), nhập thêm 5 (tồn 9) -> chốt ghi tồn 14.
        const currentStock = prod.currentStock;
        const after = currentStock + item.diffQty;
        if (after < 0) return { ok: false, error: `Không thể chốt kiểm kê: tồn của "${item.productName}" sau điều chỉnh sẽ âm (${after}). Hãy kiểm tra lại số đếm hoặc phiếu nhập/xuất gần đây.`, diffs };
        const one = await applyStock(db, prod, after, prod.reservedQty);
        if (!one) { await compensateStock(db, applied); return { ok: false, error: VERSION_CONFLICT, diffs }; }
        trackApplied(prod, one);
        applied.push(one);
        movData.push({ prod, item, before: currentStock, after });
        // Diffs trả về tính lại theo tồn hiện tại lúc chốt (systemQty = tồn lúc chốt,
        // diff = đếm − tồn lúc chốt); số điều chỉnh thực tế áp vào kho là appliedDiff.
        diffs.push({ productSku: item.productSku, productName: item.productName, systemQty: currentStock, countedQty: item.countedQty, diff: item.countedQty - currentStock, systemQtyAtCount: item.systemQty, systemQtyAtClose: currentStock, appliedDiff: item.diffQty });
      }
      await batchAll(db, [
        ...movData.map((m) => db.insert(schema.movements).values({
          productId: m.prod.id, productSku: m.prod.sku, productName: m.prod.name, type: "adjust", quantity: Math.abs(m.item.diffQty),
          beforeStock: m.before, afterStock: m.after, unitCost: m.prod.costPrice,
          reason: `Kiểm kê ${take.code}`, refCode: take.code, partner: "",
          note: `Kiểm kê ${take.code}: đếm ${m.item.countedQty}, sổ lúc đếm ${m.item.systemQty}, sổ lúc chốt ${m.before}, điều chỉnh ${m.item.diffQty > 0 ? "+" : ""}${m.item.diffQty}`,
          actor: actorName,
        })),
        ...movData.map((m) => db.insert(schema.auditLogs).values({ actor: actorName, action: "close_stocktake_adjust", entity: "product", entityId: m.prod.id, details: JSON.stringify({ stocktakeCode: take.code, sku: m.prod.sku, systemQtyAtCount: m.item.systemQty, systemQtyAtClose: m.before, countedQty: m.item.countedQty, appliedDiff: m.item.diffQty }) })),
        db.update(schema.stocktakes).set({ status: "closed", closedAt: new Date() }).where(eq(schema.stocktakes.id, take.id)),
      ]);
      await writeAudit(db, actorName, "close_stocktake", "stocktake", take.id, { code: take.code, diffCount: diffItems.length });
      ctx.invalidateQueries();
      return { ok: true, error: null, diffs };
    },
  }),

  importProductsCsv: defineAction({
    description: "Nhập sản phẩm từ chuỗi CSV (header tiếng Việt: sku, tên, danh mục, hãng, đơn vị, giá nhập, giá bán, tồn đầu, tồn tối thiểu, vị trí). Dòng lỗi được ghi lại và bỏ qua, các dòng đúng vẫn nhập.",
    request: z.object({ actorToken: z.string().optional(), csv: z.string().min(1) }),
    response: z.object({ ok: z.boolean(), imported: z.number(), errors: z.array(z.object({ line: z.number(), error: z.string() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) return { ok: false, imported: 0, errors: [{ line: 1, error: auth.error }] };
      const actor = auth.actor;
      const actorName = actorNameOf(actor);
      const roleErr = requireRole(actor, ROLE_ADMIN_STOREKEEPER, "Chỉ quản trị viên hoặc thủ kho được nhập sản phẩm từ CSV.");
      if (roleErr) return { ok: false, imported: 0, errors: [{ line: 1, error: roleErr }] };
      // Tách một dòng CSV, hỗ trợ dấu phẩy trong ngoặc kép ("...") và "" thoát.
      const parseCsvLine = (line: string): string[] => {
        const out: string[] = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i] ?? "";
          if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = !inQuotes;
          } else if (ch === "," && !inQuotes) {
            out.push(cur);
            cur = "";
          } else {
            cur += ch;
          }
        }
        out.push(cur);
        return out.map((s) => s.trim());
      };
      const parseIntCell = (raw: string): number | null => {
        const cleaned = raw.replace(/[^0-9-]/g, "");
        if (cleaned === "" || cleaned === "-") return null;
        const n = parseInt(cleaned, 10);
        return Number.isNaN(n) ? null : n;
      };
      const rawLines = args.csv.replace(/^\uFEFF/, "").split(/\r?\n/);
      // Bỏ các dòng trống ở cuối nhưng giữ số dòng để báo lỗi đúng dòng.
      while (rawLines.length > 0 && (rawLines[rawLines.length - 1] ?? "").trim() === "") rawLines.pop();
      if (rawLines.length < 2) {
        return { ok: false, imported: 0, errors: [{ line: 1, error: "File CSV trống hoặc thiếu header và dữ liệu." }] };
      }
      const header = parseCsvLine(rawLines[0] ?? "").map((h) => h.toLowerCase().trim());
      const findCol = (aliases: string[]): number => header.findIndex((h) => aliases.includes(h));
      const colSku = findCol(["sku", "mã", "mã sku", "ma sku"]);
      const colName = findCol(["tên", "ten", "name", "tên sản phẩm", "ten san pham", "tên hàng"]);
      const colCategory = findCol(["danh mục", "danh muc", "category", "nhóm", "nhom"]);
      const colBrand = findCol(["hãng", "hang", "brand", "thương hiệu", "thuong hieu"]);
      const colUnit = findCol(["đơn vị", "don vi", "unit", "đvt"]);
      const colCost = findCol(["giá nhập", "gia nhap", "cost", "costprice", "giá vốn", "gia von", "giá cost"]);
      const colSell = findCol(["giá bán", "gia ban", "sell", "sellprice", "giá lẻ"]);
      const colStock = findCol(["tồn đầu", "ton dau", "tồn đầu kỳ", "ton dau ky", "initialstock", "tồn kho", "ton kho", "số lượng", "so luong"]);
      const colMin = findCol(["tồn tối thiểu", "ton toi thieu", "minstock", "tồn min"]);
      const colLocation = findCol(["vị trí", "vi tri", "location", "kệ", "ke"]);
      if (colName < 0) {
        return { ok: false, imported: 0, errors: [{ line: 1, error: "Thiếu cột tên sản phẩm (tên/name) trong header." }] };
      }
      const get = (cells: string[], col: number): string => (col >= 0 ? (cells[col] ?? "") : "");
      const errors: { line: number; error: string }[] = [];
      let imported = 0;
      for (let idx = 1; idx < rawLines.length; idx++) {
        const lineNo = idx + 1;
        const line = rawLines[idx] ?? "";
        if (line.trim() === "") continue;
        const cells = parseCsvLine(line);
        const name = get(cells, colName).trim();
        if (!name) { errors.push({ line: lineNo, error: "Thiếu tên sản phẩm." }); continue; }
        const category = get(cells, colCategory).trim() || "Khác";
        const brand = get(cells, colBrand).trim();
        const unit = get(cells, colUnit).trim() || "cái";
        const location = get(cells, colLocation).trim();
        const costRaw = get(cells, colCost).trim();
        const sellRaw = get(cells, colSell).trim();
        const stockRaw = get(cells, colStock).trim();
        const minRaw = get(cells, colMin).trim();
        const costPrice = costRaw === "" ? 0 : parseIntCell(costRaw);
        const sellPrice = sellRaw === "" ? 0 : parseIntCell(sellRaw);
        const initialStock = stockRaw === "" ? 0 : parseIntCell(stockRaw);
        const minStock = minRaw === "" ? 5 : parseIntCell(minRaw);
        if (costPrice === null) { errors.push({ line: lineNo, error: `Giá nhập "${costRaw}" không hợp lệ.` }); continue; }
        if (sellPrice === null) { errors.push({ line: lineNo, error: `Giá bán "${sellRaw}" không hợp lệ.` }); continue; }
        if (initialStock === null || initialStock < 0) { errors.push({ line: lineNo, error: `Tồn đầu "${stockRaw}" không hợp lệ.` }); continue; }
        if (minStock === null || minStock < 0) { errors.push({ line: lineNo, error: `Tồn tối thiểu "${minRaw}" không hợp lệ.` }); continue; }
        let sku = get(cells, colSku).trim().toUpperCase();
        if (sku) {
          const dup = await db.select().from(schema.products).where(eq(schema.products.sku, sku)).limit(1);
          if (dup.length > 0) { errors.push({ line: lineNo, error: `Mã SKU "${sku}" đã tồn tại.` }); continue; }
        } else {
          const countRows = await db.select({ c: sql<number>`count(*)` }).from(schema.products);
          const seed = (countRows[0]?.c ?? 0) + 1 + Math.floor(Math.random() * 90);
          sku = genSku(category, seed * 7 + Date.now() % 1000);
          const dup2 = await db.select().from(schema.products).where(eq(schema.products.sku, sku)).limit(1);
          if (dup2.length > 0) sku = `${sku}-${Math.floor(Math.random() * 99)}`;
        }
        const existingCat = await db.select().from(schema.categories).where(eq(schema.categories.name, category));
        if (existingCat.length === 0) await db.insert(schema.categories).values({ name: category });
        const inserted = await db.insert(schema.products).values({
          sku, name, category, brand, unit, costPrice, sellPrice, currentStock: initialStock, minStock, location, notes: "",
        }).returning({ id: schema.products.id });
        const row = inserted[0];
        if (!row) { errors.push({ line: lineNo, error: "Không tạo được sản phẩm." }); continue; }
        if (initialStock > 0) {
          await db.insert(schema.movements).values({
            productId: row.id, productSku: sku, productName: name, type: "in", quantity: initialStock,
            beforeStock: 0, afterStock: initialStock, unitCost: costPrice, reason: "Tồn đầu kỳ", refCode: genRefCode("in"), partner: "", note: "Nhập tồn khi nhập CSV", actor: actorName,
          });
        }
        imported++;
      }
      await writeAudit(db, actorName, "import_products_csv", "product", 0, { imported, errorCount: errors.length });
      ctx.invalidateQueries();
      return { ok: errors.length === 0, imported, errors };
    },
  }),

  getReports: defineAction({
    description: "Báo cáo doanh thu/lợi nhuận 30 ngày gần nhất (mặc định). Cách tính: doanh thu = tổng tiền các đơn completed/partially_returned/returned trong khoảng ngày (theo ngày tạo đơn) trừ phần đã trả lại; giá vốn = tổng costPrice từng dòng (đã trừ phần trả); lợi nhuận = doanh thu − giá vốn. Công nợ quá hạn tính theo dueDate.",
    request: z.object({ actorToken: z.string().optional(), from: z.string().default(""), to: z.string().default("") }),
    response: z.object({
      revenueByDay: z.array(z.object({ date: z.string(), revenue: z.number(), cost: z.number(), profit: z.number() })),
      topProducts: z.array(z.object({ productId: z.number(), sku: z.string(), name: z.string(), qty: z.number(), revenue: z.number(), profit: z.number() })),
      lowStock: z.array(productShape),
      debtSummary: z.object({ receivable: z.number(), payable: z.number(), overdueReceivable: z.number(), overduePayable: z.number() }),
      totalRevenue: z.number(), totalCost: z.number(), totalProfit: z.number(), totalOrders: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const auth = await requireAuth(db, args.actorToken);
      if (!auth.ok) throw new Error(auth.error);
      const now = new Date();
      const toRaw = args.to.trim() ? new Date(args.to.trim()) : now;
      const to = Number.isNaN(toRaw.getTime()) ? now : toRaw;
      to.setHours(23, 59, 59, 999);
      const fromRaw = args.from.trim() ? new Date(args.from.trim()) : new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
      const from = Number.isNaN(fromRaw.getTime()) ? new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000) : fromRaw;
      from.setHours(0, 0, 0, 0);
      const orders = await db.select().from(schema.orders);
      const ranged = orders.filter((o) => o.createdAt >= from && o.createdAt <= to && ["completed", "partially_returned", "returned"].includes(o.status));
      const allItems = await db.select().from(schema.orderItems);
      const itemsByOrder = new Map<number, (typeof allItems)[number][]>();
      for (const it of allItems) {
        const list = itemsByOrder.get(it.orderId) ?? [];
        list.push(it);
        itemsByOrder.set(it.orderId, list);
      }
      let totalRevenue = 0;
      let totalCost = 0;
      const byDay = new Map<string, { revenue: number; cost: number }>();
      const byProduct = new Map<number, { productId: number; sku: string; name: string; qty: number; revenue: number; cost: number }>();
      for (const o of ranged) {
        const items = itemsByOrder.get(o.id) ?? [];
        let revenue = o.totalAmount;
        let cost = 0;
        for (const it of items) {
          const soldQty = it.quantity - it.returnedQty;
          revenue -= it.returnedQty * it.unitPrice;
          cost += soldQty * it.costPrice;
          const agg = byProduct.get(it.productId) ?? { productId: it.productId, sku: it.productSku, name: it.productName, qty: 0, revenue: 0, cost: 0 };
          agg.qty += soldQty;
          agg.revenue += soldQty * it.unitPrice;
          agg.cost += soldQty * it.costPrice;
          byProduct.set(it.productId, agg);
        }
        totalRevenue += revenue;
        totalCost += cost;
        const day = o.createdAt.toISOString().slice(0, 10);
        const dayAgg = byDay.get(day) ?? { revenue: 0, cost: 0 };
        dayAgg.revenue += revenue;
        dayAgg.cost += cost;
        byDay.set(day, dayAgg);
      }
      const revenueByDay = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, revenue: v.revenue, cost: v.cost, profit: v.revenue - v.cost }));
      const topProducts = [...byProduct.values()]
        .map((p) => ({ productId: p.productId, sku: p.sku, name: p.name, qty: p.qty, revenue: p.revenue, profit: p.revenue - p.cost }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);
      const products = await db.select().from(schema.products);
      const lowStock = products.filter((p) => p.currentStock <= p.minStock).sort((a, b) => a.currentStock - b.currentStock).map(toProduct);
      const debts = await db.select().from(schema.debts);
      const todayStr = new Date().toISOString().slice(0, 10);
      const remainingOf = (d: (typeof debts)[number]) => Math.max(0, d.totalAmount - d.paidAmount);
      const receivable = debts.filter((d) => d.kind === "receivable" && d.status !== "paid").reduce((s, d) => s + remainingOf(d), 0);
      const payable = debts.filter((d) => d.kind === "payable" && d.status !== "paid").reduce((s, d) => s + remainingOf(d), 0);
      const overdueReceivable = debts.filter((d) => d.kind === "receivable" && isOverdueDebt(d, todayStr)).reduce((s, d) => s + remainingOf(d), 0);
      const overduePayable = debts.filter((d) => d.kind === "payable" && isOverdueDebt(d, todayStr)).reduce((s, d) => s + remainingOf(d), 0);
      return {
        revenueByDay, topProducts, lowStock,
        debtSummary: { receivable, payable, overdueReceivable, overduePayable },
        totalRevenue, totalCost, totalProfit: totalRevenue - totalCost, totalOrders: ranged.length,
      };
    },
  }),

} satisfies ActionsModule;
