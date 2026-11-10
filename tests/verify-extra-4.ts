// Kiểm chứng phụ đợt 2 (chạy bằng `bun tests/verify-extra-4.ts`).
// Không phải harness chính: kiểm tra các luồng phụ bị chạm tới khi sửa 4 nhóm lỗi:
// khôi phục backup chứa công nợ trùng, hủy -> mở lại sau khi trả một phần,
// hủy giữ hàng, và migration 0001->0005.
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import * as schema from "../server/src/schema";
import { Actions } from "../server/src/actions";

const ROOT = `${import.meta.dir}/..`;
const MIGRATIONS = ["0001_initial.sql", "0002_warehouse_tables.sql", "0003_stock_safety_and_ops.sql", "0004_auth_and_debt_status.sql", "0005_debt_unique_active.sql"];

async function freshEnv() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  for (const f of MIGRATIONS) await client.executeMultiple(readFileSync(`${ROOT}/drizzle/${f}`, "utf8"));
  return { client, db, ctx: { db: () => db, invalidateQueries: () => {} } };
}
async function call(env: any, name: string, args: Record<string, unknown>) {
  try { return await (Actions as any)[name].handler(env.ctx, args); }
  catch (e) { return { __thrown: true, error: e instanceof Error ? e.message : String(e) }; }
}
const isOk = (r: any) => !!r && r.ok !== false && !r.__thrown;
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name} — ${detail}`);
  ok ? pass++ : fail++;
}

async function seedStaff(env: any) {
  const admin = await call(env, "loginStaff", { pin: "123456" });
  const sk = await call(env, "createStaff", { actorToken: admin.token, name: "Thủ kho A", role: "storekeeper", pin: "111111" });
  const sl = await call(env, "createStaff", { actorToken: admin.token, name: "Bán hàng B", role: "sales", pin: "222222" });
  const skLogin = await call(env, "loginStaff", { pin: "111111" });
  const slLogin = await call(env, "loginStaff", { pin: "222222" });
  return { adminToken: admin.token as string, skToken: skLogin.token as string, slToken: slLogin.token as string };
}
async function mkProduct(env: any, token: string, stock: number, price = 100) {
  const r = await call(env, "createProduct", { sku: "", name: "SP Thử", category: "Bồn cầu", brand: "", unit: "cái", costPrice: 50, sellPrice: price, initialStock: stock, minStock: 1, location: "", notes: "", actorToken: token });
  if (!isOk(r)) throw new Error(JSON.stringify(r));
  return r.id as number;
}
async function stockOf(env: any, id: number) {
  return (await env.db.select().from(schema.products).where(eq(schema.products.id, id)))[0]?.currentStock ?? -999;
}
async function orderOf(env: any, token: string, id: number) {
  const list = await call(env, "listOrders", { status: "all", search: "", actorToken: token });
  return (list.orders as any[]).find((o: any) => o.id === id);
}

console.log("=== KIỂM CHỨNG PHỤ ĐỢT 2 ===");
console.log(`Ngày chạy: ${new Date().toISOString()}`);

// E1. Migration 0001->0005: đủ bảng + index unique công nợ active.
{
  const env = await freshEnv();
  const tables = await env.client.execute("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'");
  const idx = await env.client.execute("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='debts_one_active_per_ref'");
  check("E1 migration 0001->0005: 18 bảng + index debts_one_active_per_ref",
    Number(tables.rows[0].n) === 18 && Number(idx.rows[0].n) === 1,
    `tables=${tables.rows[0].n}, index=${idx.rows[0].n}`);
}

// E2. Khôi phục backup chứa 2 công nợ active trùng -> chỉ giữ 1 active, không lỗi.
{
  const env = await freshEnv();
  const { adminToken, skToken } = await seedStaff(env);
  const p = await mkProduct(env, adminToken, 10, 100);
  const order = await call(env, "createOrder", { customerName: "Khách Thử", customerPhone: "", customerAddress: "", status: "confirmed", note: "", items: [{ productId: p, quantity: 1, unitPrice: 100 }], actorToken: skToken, depositAmount: 0, deliveryPerson: "", deliveryFee: 0, expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined });
  const snap = await call(env, "createBackupSnapshot", { actorToken: adminToken });
  const stored = (await env.db.select().from(schema.backups).where(eq(schema.backups.id, snap.id)))[0];
  const data = JSON.parse(stored.data as string);
  const dup = { ...data.debts[0], id: 999 };
  data.debts.push(dup);
  await env.db.update(schema.backups).set({ data: JSON.stringify(data) }).where(eq(schema.backups.id, snap.id));
  const restored = await call(env, "restoreBackup", { actorToken: adminToken, backupId: snap.id });
  const debts = await env.db.select().from(schema.debts).where(eq(schema.debts.refCode, order.orderCode));
  const active = debts.filter((d: any) => d.status === "open" || d.status === "overdue");
  check("E2 khôi phục backup có công nợ trùng: thành công, chỉ 1 active, khoản trùng thành cancelled",
    isOk(restored) && debts.length === 2 && active.length === 1,
    `restored ok=${isOk(restored)} err=${(restored as any).error ?? ""}, debts=${debts.length} active=${active.length} statuses=${debts.map((d: any) => d.status).join(",")}`);
}

// E3. Trả một phần rồi hủy rồi mở lại: công nợ kích hoạt lại theo netPayable (tổng - hoàn - cọc).
{
  const env = await freshEnv();
  const { adminToken, slToken } = await seedStaff(env);
  const pa = await mkProduct(env, adminToken, 10, 60);
  const pb = await mkProduct(env, adminToken, 10, 40);
  const created = await call(env, "createOrder", { customerName: "Khách Thử", customerPhone: "", customerAddress: "", status: "confirmed", note: "", items: [{ productId: pa, quantity: 1, unitPrice: 60 }, { productId: pb, quantity: 1, unitPrice: 40 }], actorToken: slToken, depositAmount: 0, deliveryPerson: "", deliveryFee: 0, expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined });
  const order = await orderOf(env, slToken, created.id);
  const itemB = order.items.find((i: any) => i.productId === pb);
  await call(env, "createReturn", { actorToken: slToken, orderId: order.id, lines: [{ orderItemId: itemB.id, quantity: 1 }], reason: "Trả B" });
  await call(env, "updateOrderStatus", { id: order.id, status: "cancelled", actorToken: slToken });
  const reConfirm = await call(env, "updateOrderStatus", { id: order.id, status: "confirmed", actorToken: slToken });
  const debts = await env.db.select().from(schema.debts).where(eq(schema.debts.refCode, order.orderCode));
  const d = debts.find((x: any) => x.status === "open");
  check("E3 trả 40đ rồi hủy-mở lại: chỉ 1 hàng nợ, kích hoạt lại còn 60đ (= 100 - 40 hoàn - 0 cọc)",
    isOk(reConfirm) && debts.length === 1 && !!d && d.totalAmount === 60 && d.paidAmount === 0,
    `debts=${JSON.stringify(debts.map((x: any) => ({ total: x.totalAmount, paid: x.paidAmount, status: x.status })))}`);
}

// E4. Hủy giữ hàng: hoàn kho + trừ số lượng giữ, void công nợ, đơn đã hủy.
{
  const env = await freshEnv();
  const { adminToken, skToken } = await seedStaff(env);
  const p = await mkProduct(env, adminToken, 10, 100);
  const created = await call(env, "createOrder", { customerName: "Khách Thử", customerPhone: "", customerAddress: "", status: "reserved", note: "", items: [{ productId: p, quantity: 3, unitPrice: 100 }], actorToken: skToken, depositAmount: 0, deliveryPerson: "", deliveryFee: 0, expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined });
  const mid = await stockOf(env, p);
  const prodMid = (await env.db.select().from(schema.products).where(eq(schema.products.id, p)))[0];
  const rel = await call(env, "releaseReservation", { actorToken: skToken, orderId: created.id });
  const after = await stockOf(env, p);
  const prodAfter = (await env.db.select().from(schema.products).where(eq(schema.products.id, p)))[0];
  const order = await orderOf(env, skToken, created.id);
  const debts = await env.db.select().from(schema.debts).where(eq(schema.debts.refCode, order.orderCode));
  check("E4 hủy giữ hàng: tồn 7 -> 10, giữ 3 -> 0, đơn cancelled, công nợ cancelled",
    mid === 7 && prodMid.reservedQty === 3 && isOk(rel) && after === 10 && prodAfter.reservedQty === 0
    && order.status === "cancelled" && debts.every((d: any) => d.status === "cancelled"),
    `mid stock=${mid} reserved=${prodMid.reservedQty}, after stock=${after} reserved=${prodAfter.reservedQty}, order=${order.status}, debts=${debts.map((d: any) => d.status).join(",")}`);
}

// E5. Hủy đơn 2 lần liên tiếp: lần 2 không hoàn kho trùng (hồi quy sau khi thêm guard chứng từ).
{
  const env = await freshEnv();
  const { adminToken, slToken } = await seedStaff(env);
  const p = await mkProduct(env, adminToken, 10, 100);
  const created = await call(env, "createOrder", { customerName: "Khách Thử", customerPhone: "", customerAddress: "", status: "confirmed", note: "", items: [{ productId: p, quantity: 2, unitPrice: 100 }], actorToken: slToken, depositAmount: 0, deliveryPerson: "", deliveryFee: 0, expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined });
  await call(env, "updateOrderStatus", { id: created.id, status: "cancelled", actorToken: slToken });
  const s1 = await stockOf(env, p);
  const c2 = await call(env, "updateOrderStatus", { id: created.id, status: "cancelled", actorToken: slToken });
  const s2 = await stockOf(env, p);
  check("E5 hủy đơn 2 lần: tồn 10 sau lần 1, vẫn 10 sau lần 2",
    s1 === 10 && s2 === 10, `sau lần 1=${s1}, sau lần 2=${s2}, lần 2=${JSON.stringify(c2)}`);
}

// E6. Đổi PIN rồi đăng nhập lại (hồi quy auth sau khi sửa).
{
  const env = await freshEnv();
  const { adminToken } = await seedStaff(env);
  const ch = await call(env, "changePin", { token: adminToken, oldPin: "123456", newPin: "654321" });
  const loginOld = await call(env, "loginStaff", { pin: "123456" });
  const loginNew = await call(env, "loginStaff", { pin: "654321" });
  check("E6 đổi PIN 123456 -> 654321: PIN cũ lỗi, PIN mới đăng nhập được",
    isOk(ch) && !isOk(loginOld) && isOk(loginNew), `change=${JSON.stringify(ch)}, old ok=${isOk(loginOld)}, new ok=${isOk(loginNew)}`);
}

console.log(`\nTỔNG PHỤ: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
