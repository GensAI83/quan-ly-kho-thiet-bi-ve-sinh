// Harness tái hiện 4 nhóm lỗi đợt 2 (chạy bằng `bun tests/repro-4-bugs.ts`).
// Không nhúng vào bundle app. Dùng Actions handler trực tiếp + SQLite trong bộ nhớ
// (libsql :memory:), áp migration drizzle/0001 -> 0005 từ file SQL.
// Mỗi nhóm dùng một DB mới để không nhiễm chéo.
// Quy ước: call() trả về kết quả action, hoặc { __thrown: true, error } khi handler ném lỗi.
// "Lỗi" của một thao tác = ok === false hoặc handler ném lỗi có thông báo đúng.
// Không sửa tests/repro-5-bugs.ts — chạy lại nó để đảm bảo không hồi quy.

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, and, desc } from "drizzle-orm";
import { readFileSync, existsSync } from "node:fs";
import * as schema from "../server/src/schema";
import { Actions } from "../server/src/actions";

const ROOT = `${import.meta.dir}/..`;
const MIGRATIONS = ["0001_initial.sql", "0002_warehouse_tables.sql", "0003_stock_safety_and_ops.sql", "0004_auth_and_debt_status.sql", "0005_debt_unique_active.sql"];

type Env = { client: ReturnType<typeof createClient>; db: ReturnType<typeof drizzle<typeof schema>>; ctx: any };

async function freshEnv(): Promise<Env> {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  for (const f of MIGRATIONS) {
    const p = `${ROOT}/drizzle/${f}`;
    if (!existsSync(p)) {
      console.log(`  (lưu ý) migration ${f} chưa có — bỏ qua`);
      continue;
    }
    await client.executeMultiple(readFileSync(p, "utf8"));
  }
  return { client, db, ctx: { db: () => db, invalidateQueries: () => {} } };
}

async function call(env: Env, name: string, args: Record<string, unknown>): Promise<any> {
  return callCtx(env.ctx, name, args);
}
async function callCtx(ctx: any, name: string, args: Record<string, unknown>): Promise<any> {
  try {
    return await (Actions as any)[name].handler(ctx, args);
  } catch (e) {
    return { __thrown: true, error: e instanceof Error ? e.message : String(e) };
  }
}

function isFail(r: any, msgPart?: string): boolean {
  if (!r) return false;
  const failed = r.ok === false || r.__thrown === true || (typeof r.error === "string" && r.error !== "");
  if (!failed) return false;
  if (msgPart) return String(r.error ?? "").includes(msgPart);
  return true;
}
function isOk(r: any): boolean {
  return !!r && r.ok !== false && !r.__thrown;
}

type Check = { name: string; pass: boolean; detail: string };
const results: { group: string; checks: Check[] }[] = [];
function group(name: string) {
  const g = { group: name, checks: [] as Check[] };
  results.push(g);
  return g;
}
function check(g: { checks: Check[] }, name: string, pass: boolean, detail: string) {
  g.checks.push({ name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

// ---------- Tiêm lỗi ghi (mô phỏng mất mạng / lỗi ghi sau khi đã áp tồn) ----------
// Builder giả: nối chuỗi được như builder thật, nhưng await sẽ reject.
function throwingBuilder(message: string, onReject?: () => Promise<void>): any {
  const err = new Error(message);
  let rejected = false;
  const proxy: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") {
        return (res: any, rej: any) => {
          if (rejected) { rej(err); return; }
          rejected = true;
          if (onReject) onReject().then(() => rej(err), () => rej(err));
          else rej(err);
        };
      }
      if (prop === Symbol.toPrimitive) return () => message;
      return (..._a: any[]) => proxy;
    },
  });
  return proxy;
}

// Bọc builder thật: trước khi builder chạy (lúc await), chạy `before` một lần duy nhất.
function withBefore(builder: any, before: () => Promise<void>): any {
  let done = false;
  const wrap = (obj: any): any => new Proxy(obj, {
    get(t, prop, receiver) {
      if (prop === "then") {
        return (res: any, rej: any) => {
          if (!done) {
            done = true;
            before().then(() => (t as any).then(res, rej), rej);
          } else {
            (t as any).then(res, rej);
          }
        };
      }
      const v = Reflect.get(t, prop);
      if (typeof v === "function") {
        return (...a: any[]) => {
          const r = (v as any).apply(t, a);
          return r !== null && (typeof r === "object" || typeof r === "function") ? wrap(r) : r;
        };
      }
      return v;
    },
  });
  return wrap(builder);
}

// ctx mà lần insert thứ `occurrence` vào `table` sẽ ném lỗi (mô phỏng mất mạng khi ghi).
function ctxFailInsert(env: Env, table: any, occurrence: number, opts?: { bumpProductId?: number }): any {
  let n = 0;
  const wrappedDb = new Proxy(env.db, {
    get(t: any, prop: string) {
      if (prop === "insert") {
        return (...a: any[]) => {
          if (a[0] === table) {
            n++;
            if (n === occurrence) {
              const onReject = opts?.bumpProductId !== undefined
                ? async () => { await env.client.execute({ sql: "UPDATE products SET version = version + 1 WHERE id = ?", args: [opts.bumpProductId] }); }
                : undefined;
              return throwingBuilder("Mô phỏng mất mạng khi ghi dữ liệu.", onReject);
            }
          }
          return (t as any).insert(...a);
        };
      }
      const v = (t as any)[prop];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return { db: () => wrappedDb, invalidateQueries: () => {} };
}

// ctx mà lần update thứ `occurrence` vào bảng products sẽ tăng version của sản phẩm
// `productId` ngay trước khi câu update chạy (mô phỏng người khác đổi tồn xen giữa),
// khiến update version-guarded khớp 0 hàng -> xung đột version.
function ctxBumpVersionBeforeUpdate(env: Env, productId: number, occurrence: number): any {
  let n = 0;
  const wrappedDb = new Proxy(env.db, {
    get(t: any, prop: string) {
      if (prop === "update") {
        return (...a: any[]) => {
          if (a[0] === schema.products) {
            n++;
            if (n === occurrence) {
              return withBefore((t as any).update(...a), async () => {
                await env.client.execute({ sql: "UPDATE products SET version = version + 1 WHERE id = ?", args: [productId] });
              });
            }
          }
          return (t as any).update(...a);
        };
      }
      const v = (t as any)[prop];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return { db: () => wrappedDb, invalidateQueries: () => {} };
}

// ---------- helpers nghiệp vụ (cùng mẫu với tests/repro-5-bugs.ts) ----------
async function seedStaff(env: Env) {
  const admin = await call(env, "loginStaff", { pin: "123456" });
  if (!isOk(admin) || !admin.token) throw new Error(`không đăng nhập được admin mặc định: ${JSON.stringify(admin)}`);
  const adminToken = admin.token as string;
  const sk = await call(env, "createStaff", { actorToken: adminToken, name: "Thủ kho A", role: "storekeeper", pin: "111111" });
  const sl = await call(env, "createStaff", { actorToken: adminToken, name: "Bán hàng B", role: "sales", pin: "222222" });
  if (!isOk(sk) || !isOk(sl)) throw new Error(`không tạo được nhân viên thử: ${JSON.stringify({ sk, sl })}`);
  const skLogin = await call(env, "loginStaff", { pin: "111111" });
  const slLogin = await call(env, "loginStaff", { pin: "222222" });
  if (!isOk(skLogin) || !isOk(slLogin)) throw new Error("không đăng nhập được thủ kho / bán hàng");
  return { adminToken, skToken: skLogin.token as string, slToken: slLogin.token as string };
}

async function mkProduct(env: Env, token: string, stock: number, price = 100) {
  const r = await call(env, "createProduct", {
    sku: "", name: "SP Thử", category: "Bồn cầu", brand: "", unit: "cái",
    costPrice: 50, sellPrice: price, initialStock: stock, minStock: 1,
    location: "", notes: "", actorToken: token,
  });
  if (!isOk(r)) throw new Error(`không tạo được sản phẩm: ${JSON.stringify(r)}`);
  return r.id as number;
}

async function stockOf(env: Env, productId: number): Promise<number> {
  const rows = await env.db.select().from(schema.products).where(eq(schema.products.id, productId));
  return rows[0]?.currentStock ?? -999;
}

async function mkOrder(env: Env, token: string, items: { productId: number; quantity: number; unitPrice: number }[], opts?: { deposit?: number; status?: string }) {
  const r = await call(env, "createOrder", {
    customerName: "Khách Thử", customerPhone: "", customerAddress: "", status: opts?.status ?? "confirmed", note: "",
    items, actorToken: token, depositAmount: opts?.deposit ?? 0, deliveryPerson: "", deliveryFee: 0,
    expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined,
  });
  if (!isOk(r)) throw new Error(`không tạo được đơn: ${JSON.stringify(r)}`);
  const order = await orderOf(env, token, r.id);
  if (!order) throw new Error("không tìm thấy đơn vừa tạo");
  return order;
}

async function orderOf(env: Env, token: string, orderId: number) {
  const list = await call(env, "listOrders", { status: "all", search: "", actorToken: token });
  return (list.orders as any[]).find((o: any) => o.id === orderId);
}

async function debtsOfOrder(env: Env, orderCode: string) {
  const rows = await env.db.select().from(schema.debts).where(eq(schema.debts.refCode, orderCode));
  return rows.filter((d: any) => d.kind === "receivable");
}

async function movementsOf(env: Env, where: { productId?: number; refCode?: string; type?: string }) {
  let rows = await env.db.select().from(schema.movements);
  if (where.productId !== undefined) rows = rows.filter((m: any) => m.productId === where.productId);
  if (where.refCode !== undefined) rows = rows.filter((m: any) => m.refCode === where.refCode);
  if (where.type !== undefined) rows = rows.filter((m: any) => m.type === where.type);
  return rows;
}

async function takeStatus(env: Env, takeId: number): Promise<string> {
  const rows = await env.db.select().from(schema.stocktakes).where(eq(schema.stocktakes.id, takeId));
  return rows[0]?.status ?? "?";
}

async function pendingRestocks(env: Env) {
  return env.db.select().from(schema.pendingRestocks);
}

// Bất biến tiền: (a) công nợ còn lại == max(0, netPayable − cọc);
// (b) cọc == tiền thực thu (cọc ban đầu + các khoản thu qua recordDebtPayment/recordDeposit).
async function checkMoneyInvariant(env: Env, token: string, orderId: number, collected: number): Promise<{ ok: boolean; detail: string }> {
  const o = await orderOf(env, token, orderId);
  if (!o) return { ok: false, detail: "không tìm thấy đơn" };
  const items = await env.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  const refunded = items.reduce((s: number, i: any) => s + i.returnedQty * i.unitPrice, 0);
  const netPayable = o.totalAmount - refunded;
  const debts = await debtsOfOrder(env, o.orderCode);
  const d = debts.find((x: any) => x.status !== "cancelled");
  const remaining = d ? Math.max(0, d.totalAmount - d.paidAmount) : 0;
  const expectedRemaining = Math.max(0, netPayable - o.depositAmount);
  const okRemaining = remaining === expectedRemaining;
  const okDeposit = o.depositAmount === collected;
  return {
    ok: okRemaining && okDeposit,
    detail: `netPayable=${netPayable} (tổng ${o.totalAmount} − hoàn ${refunded}), cọc=${o.depositAmount} (thực thu ${collected}), công nợ còn=${remaining} (mong đợi ${expectedRemaining}), trạng thái đơn=${o.paymentStatus}`,
  };
}

// ---------- Nhóm 1: kiểm kê nhiều mặt hàng lỗi giữa chừng ----------
async function group1() {
  const g = group("1 — Kiểm kê nhiều mặt hàng lỗi giữa chừng");
  const env = await freshEnv();
  const { adminToken, skToken } = await seedStaff(env);

  // 1a. Dòng thứ 3 bị ngưng bán -> chốt phải lỗi, tồn cả 3 mặt hàng KHÔNG đổi, không phiếu adjust nào.
  {
    const p1 = await mkProduct(env, adminToken, 10);
    const p2 = await mkProduct(env, adminToken, 5);
    const p3 = await mkProduct(env, adminToken, 8);
    const take = await call(env, "createStocktake", { actorToken: skToken, note: "KK 3 dòng" });
    await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: p1, countedQty: 12, note: "" });
    await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: p2, countedQty: 3, note: "" });
    await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: p3, countedQty: 10, note: "" });
    await env.db.update(schema.products).set({ status: "discontinued" }).where(eq(schema.products.id, p3));
    const close = await call(env, "closeStocktake", { actorToken: skToken, stocktakeId: take.id });
    const s1 = await stockOf(env, p1); const s2 = await stockOf(env, p2); const s3 = await stockOf(env, p3);
    const adj = await movementsOf(env, { refCode: take.code, type: "adjust" });
    const st = await takeStatus(env, take.id);
    check(g, "1a dòng 3 ngưng bán: chốt lỗi, tồn 10/5/8 không đổi, 0 phiếu adjust, phiếu vẫn nháp",
      close.ok === false && s1 === 10 && s2 === 5 && s3 === 8 && adj.length === 0 && st === "draft",
      `close=${JSON.stringify(close)}, stocks=${s1}/${s2}/${s3}, adjust=${adj.length}, status=${st}`);
  }

  // 1b. Xung đột version ở dòng 2 -> tồn các dòng đã áp được hoàn về.
  {
    const p1 = await mkProduct(env, adminToken, 10);
    const p2 = await mkProduct(env, adminToken, 5);
    const take = await call(env, "createStocktake", { actorToken: skToken, note: "KK xung đột" });
    await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: p1, countedQty: 12, note: "" });
    await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: p2, countedQty: 3, note: "" });
    const gated = ctxBumpVersionBeforeUpdate(env, p2, 2);
    const close = await callCtx(gated, "closeStocktake", { actorToken: skToken, stocktakeId: take.id });
    const s1 = await stockOf(env, p1); const s2 = await stockOf(env, p2);
    const adj = await movementsOf(env, { refCode: take.code, type: "adjust" });
    const st = await takeStatus(env, take.id);
    check(g, "1b xung đột version dòng 2: chốt lỗi version, tồn hoàn về 10/5, 0 phiếu adjust, phiếu vẫn nháp",
      close.ok === false && String(close.error ?? "").includes("tải lại") && s1 === 10 && s2 === 5 && adj.length === 0 && st === "draft",
      `close=${JSON.stringify(close)}, stocks=${s1}/${s2}, adjust=${adj.length}, status=${st}`);
  }

  // 1c. Ghi movements lỗi sau khi đã áp -> tồn hoàn về, không movement mồ côi.
  {
    const p1 = await mkProduct(env, adminToken, 10);
    const p2 = await mkProduct(env, adminToken, 5);
    const take = await call(env, "createStocktake", { actorToken: skToken, note: "KK lỗi ghi" });
    await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: p1, countedQty: 12, note: "" });
    await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: p2, countedQty: 3, note: "" });
    const failing = ctxFailInsert(env, schema.movements, 1);
    const close = await callCtx(failing, "closeStocktake", { actorToken: skToken, stocktakeId: take.id });
    const s1 = await stockOf(env, p1); const s2 = await stockOf(env, p2);
    const adj = await movementsOf(env, { refCode: take.code, type: "adjust" });
    const st = await takeStatus(env, take.id);
    check(g, "1c lỗi ghi movements: chốt lỗi (không ném), tồn hoàn về 10/5, 0 phiếu adjust, phiếu vẫn nháp",
      close.ok === false && s1 === 10 && s2 === 5 && adj.length === 0 && st === "draft",
      `close=${JSON.stringify(close)}, stocks=${s1}/${s2}, adjust=${adj.length}, status=${st}`);
  }

  // 1d. Chốt lại sau thất bại (dòng đã áp một phần) -> không điều chỉnh trùng.
  {
    const p1 = await mkProduct(env, adminToken, 10);
    const p2 = await mkProduct(env, adminToken, 5);
    const take = await call(env, "createStocktake", { actorToken: skToken, note: "KK chốt lại" });
    await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: p1, countedQty: 12, note: "" });
    await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: p2, countedQty: 3, note: "" });
    const failing = ctxFailInsert(env, schema.movements, 2);
    const close1 = await callCtx(failing, "closeStocktake", { actorToken: skToken, stocktakeId: take.id });
    const s1a = await stockOf(env, p1); const s2a = await stockOf(env, p2);
    const adj1 = await movementsOf(env, { refCode: take.code, type: "adjust" });
    const st1 = await takeStatus(env, take.id);
    check(g, "1d-1 lần chốt 1 lỗi ghi ở dòng 2: tồn hoàn về 10/5, 0 phiếu adjust, phiếu vẫn nháp",
      close1.ok === false && s1a === 10 && s2a === 5 && adj1.length === 0 && st1 === "draft",
      `close1=${JSON.stringify(close1)}, stocks=${s1a}/${s2a}, adjust=${adj1.length}, status=${st1}`);
    const close2 = await call(env, "closeStocktake", { actorToken: skToken, stocktakeId: take.id });
    const s1b = await stockOf(env, p1); const s2b = await stockOf(env, p2);
    const adj2 = await movementsOf(env, { refCode: take.code, type: "adjust" });
    const st2 = await takeStatus(env, take.id);
    check(g, "1d-2 chốt lại: thành công, tồn đúng 12/3, mỗi SP đúng 1 phiếu adjust, phiếu đã đóng",
      isOk(close2) && s1b === 12 && s2b === 3 && adj2.length === 2 && st2 === "closed",
      `close2=${JSON.stringify(close2)}, stocks=${s1b}/${s2b}, adjust=${adj2.length}, status=${st2}`);
  }

  // 1e (thêm). Đã có sẵn 1 phiếu adjust cho dòng 1 từ lần chốt dở trước -> chốt lại bỏ qua dòng đó.
  {
    const p1 = await mkProduct(env, adminToken, 10);
    const p2 = await mkProduct(env, adminToken, 5);
    const take = await call(env, "createStocktake", { actorToken: skToken, note: "KK chốt dở" });
    await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: p1, countedQty: 12, note: "" });
    await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: p2, countedQty: 3, note: "" });
    // Giả lập lần chốt trước đã áp dòng 1 (phiếu adjust đã ghi, tồn đã +2) rồi lỗi.
    await env.db.insert(schema.movements).values({
      productId: p1, productSku: "", productName: "SP Thử", type: "adjust", quantity: 2,
      beforeStock: 10, afterStock: 12, unitCost: 50, reason: `Kiểm kê ${take.code}`, refCode: take.code,
      partner: "", note: "Chốt dở lần trước", actor: "Thủ kho A",
    });
    await env.db.update(schema.products).set({ currentStock: 12 }).where(eq(schema.products.id, p1));
    const close = await call(env, "closeStocktake", { actorToken: skToken, stocktakeId: take.id });
    const s1 = await stockOf(env, p1); const s2 = await stockOf(env, p2);
    const adj1 = await movementsOf(env, { productId: p1, refCode: take.code, type: "adjust" });
    const adj2 = await movementsOf(env, { productId: p2, refCode: take.code, type: "adjust" });
    const st = await takeStatus(env, take.id);
    check(g, "1e dòng 1 đã có phiếu adjust: chốt lại bỏ qua dòng 1, tồn đúng 12/3, mỗi SP 1 phiếu, phiếu đã đóng",
      isOk(close) && s1 === 12 && s2 === 3 && adj1.length === 1 && adj2.length === 1 && st === "closed",
      `close=${JSON.stringify(close)}, stocks=${s1}/${s2}, adjust P1=${adj1.length} P2=${adj2.length}, status=${st}`);
  }
}

// ---------- Nhóm 2: trả hàng làm sai số tiền đã thu ----------
async function group2() {
  const g = group("2 — Trả hàng làm sai số tiền đã thu");
  const env = await freshEnv();
  const { adminToken, slToken } = await seedStaff(env);

  // 2a. Đơn 100đ chưa cọc, trả hết hàng -> cọc vẫn 0, paymentStatus KHÔNG phải "paid", công nợ còn 0.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [{ productId: p, quantity: 1, unitPrice: 100 }]);
    const ret = await call(env, "createReturn", { actorToken: slToken, orderId: order.id, lines: [{ orderItemId: order.items[0].id, quantity: 1 }], reason: "Trả hết" });
    const o = await orderOf(env, slToken, order.id);
    const debts = await debtsOfOrder(env, order.orderCode);
    const d = debts.find((x: any) => x.status !== "cancelled");
    const remaining = d ? Math.max(0, d.totalAmount - d.paidAmount) : 0;
    const inv = await checkMoneyInvariant(env, slToken, order.id, 0);
    check(g, "2a trả hết khi chưa cọc: cọc 0, trạng thái KHÔNG paid, công nợ còn 0, bất biến tiền đúng",
      isOk(ret) && o.depositAmount === 0 && o.paymentStatus !== "paid" && remaining === 0 && inv.ok,
      `ret=${JSON.stringify(ret)}, order deposit=${o.depositAmount} status=${o.paymentStatus}, debt remaining=${remaining}, inv: ${inv.detail}`);
  }

  // 2b. Trả một phần 40đ rồi thu 60đ còn lại qua recordDebtPayment -> đơn "paid" VÀ công nợ còn 0.
  {
    const pa = await mkProduct(env, adminToken, 10, 60);
    const pb = await mkProduct(env, adminToken, 10, 40);
    const order = await mkOrder(env, slToken, [
      { productId: pa, quantity: 1, unitPrice: 60 },
      { productId: pb, quantity: 1, unitPrice: 40 },
    ]);
    const itemB = order.items.find((i: any) => i.productId === pb);
    const ret = await call(env, "createReturn", { actorToken: slToken, orderId: order.id, lines: [{ orderItemId: itemB.id, quantity: 1 }], reason: "Trả B" });
    const invMid = await checkMoneyInvariant(env, slToken, order.id, 0);
    const debts = await debtsOfOrder(env, order.orderCode);
    const d = debts.find((x: any) => x.status !== "cancelled");
    const pay = await call(env, "recordDebtPayment", { actorToken: slToken, debtId: d.id, amount: 60, method: "Tiền mặt", note: "" });
    const o = await orderOf(env, slToken, order.id);
    const debtsAfter = await debtsOfOrder(env, order.orderCode);
    const dAfter = debtsAfter.find((x: any) => x.status !== "cancelled");
    const remaining = dAfter ? Math.max(0, dAfter.totalAmount - dAfter.paidAmount) : 0;
    const inv = await checkMoneyInvariant(env, slToken, order.id, 60);
    check(g, "2b trả 40đ rồi thu 60đ qua công nợ: đơn paid, cọc 60, công nợ còn 0, bất biến tiền đúng",
      isOk(ret) && invMid.ok && isOk(pay) && o.paymentStatus === "paid" && o.depositAmount === 60 && remaining === 0 && inv.ok,
      `ret ok=${isOk(ret)}, inv giữa: ${invMid.detail}, pay=${JSON.stringify(pay)}, order deposit=${o.depositAmount} status=${o.paymentStatus}, debt remaining=${remaining}, inv: ${inv.detail}`);
  }

  // 2c. Trả một phần rồi thu qua recordDeposit -> đơn và công nợ khớp nhau.
  {
    const pa = await mkProduct(env, adminToken, 10, 60);
    const pb = await mkProduct(env, adminToken, 10, 40);
    const order = await mkOrder(env, slToken, [
      { productId: pa, quantity: 1, unitPrice: 60 },
      { productId: pb, quantity: 1, unitPrice: 40 },
    ]);
    const itemB = order.items.find((i: any) => i.productId === pb);
    const ret = await call(env, "createReturn", { actorToken: slToken, orderId: order.id, lines: [{ orderItemId: itemB.id, quantity: 1 }], reason: "Trả B" });
    const dep = await call(env, "recordDeposit", { actorToken: slToken, orderId: order.id, amount: 60 });
    const o = await orderOf(env, slToken, order.id);
    const debts = await debtsOfOrder(env, order.orderCode);
    const d = debts.find((x: any) => x.status !== "cancelled");
    const remaining = d ? Math.max(0, d.totalAmount - d.paidAmount) : 0;
    const inv = await checkMoneyInvariant(env, slToken, order.id, 60);
    check(g, "2c trả 40đ rồi cọc 60đ: đơn paid, cọc 60, công nợ còn 0, hai bên khớp, bất biến tiền đúng",
      isOk(ret) && isOk(dep) && o.paymentStatus === "paid" && o.depositAmount === 60 && remaining === 0 && inv.ok,
      `dep=${JSON.stringify(dep)}, order deposit=${o.depositAmount} status=${o.paymentStatus}, debt remaining=${remaining} (paid=${d?.paidAmount}/${d?.totalAmount} ${d?.status}), inv: ${inv.detail}`);
  }

  // 2d. Cọc vượt số còn phải trả sau khi trả hàng phải bị chặn (cọc so với netPayable, không phải tổng gốc).
  {
    const pa = await mkProduct(env, adminToken, 10, 60);
    const pb = await mkProduct(env, adminToken, 10, 40);
    const order = await mkOrder(env, slToken, [
      { productId: pa, quantity: 1, unitPrice: 60 },
      { productId: pb, quantity: 1, unitPrice: 40 },
    ]);
    const itemB = order.items.find((i: any) => i.productId === pb);
    await call(env, "createReturn", { actorToken: slToken, orderId: order.id, lines: [{ orderItemId: itemB.id, quantity: 1 }], reason: "Trả B" });
    const depOver = await call(env, "recordDeposit", { actorToken: slToken, orderId: order.id, amount: 70 });
    const o = await orderOf(env, slToken, order.id);
    check(g, "2d cọc 70đ khi chỉ còn phải trả 60đ phải bị chặn, cọc vẫn 0",
      isFail(depOver) && o.depositAmount === 0,
      `depOver=${JSON.stringify(depOver)}, deposit=${o.depositAmount}`);
  }
}

// ---------- Nhóm 3: mở lại đơn đã hủy làm nhân công nợ ----------
async function group3() {
  const g = group("3 — Mở lại đơn đã hủy làm nhân công nợ");
  const env = await freshEnv();
  const { adminToken, slToken } = await seedStaff(env);

  // 3a. Xác nhận -> hủy -> xác nhận lại -> đang giao -> hoàn thành: chỉ 1 công nợ active, 1 hàng công nợ.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [{ productId: p, quantity: 1, unitPrice: 100 }]);
    const countDebts = async () => {
      const ds = await debtsOfOrder(env, order.orderCode);
      return { total: ds.length, active: ds.filter((d: any) => d.status === "open" || d.status === "overdue").length, rows: ds };
    };
    const c1 = await countDebts();
    const cancel = await call(env, "updateOrderStatus", { id: order.id, status: "cancelled", actorToken: slToken });
    const c2 = await countDebts();
    const reConfirm = await call(env, "updateOrderStatus", { id: order.id, status: "confirmed", actorToken: slToken });
    const delivering = await call(env, "updateOrderStatus", { id: order.id, status: "delivering", actorToken: slToken });
    const completed = await call(env, "updateOrderStatus", { id: order.id, status: "completed", actorToken: slToken });
    const c3 = await countDebts();
    const d = c3.rows.find((x: any) => x.status === "open" || x.status === "overdue");
    check(g, "3a xác nhận-hủy-mở lại-giao-hoàn thành: chỉ 1 hàng công nợ, 1 active, số còn lại 100",
      c1.total === 1 && c1.active === 1 && isOk(cancel) && c2.rows.some((x: any) => x.status === "cancelled")
      && isOk(reConfirm) && isOk(delivering) && isOk(completed)
      && c3.total === 1 && c3.active === 1 && d && d.totalAmount === 100 && d.paidAmount === 0,
      `sau xác nhận: ${JSON.stringify(c1.rows)}, sau hủy: ${JSON.stringify(c2.rows)}, cuối: ${JSON.stringify(c3.rows)}`);
  }

  // 3b. Hủy rồi mở lại khi đã cọc một phần -> kích hoạt lại với số còn lại đúng, không trùng.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [{ productId: p, quantity: 1, unitPrice: 100 }], { deposit: 40 });
    const before = await debtsOfOrder(env, order.orderCode);
    const cancel = await call(env, "updateOrderStatus", { id: order.id, status: "cancelled", actorToken: slToken });
    const reConfirm = await call(env, "updateOrderStatus", { id: order.id, status: "confirmed", actorToken: slToken });
    const after = await debtsOfOrder(env, order.orderCode);
    const d = after.find((x: any) => x.status === "open" || x.status === "overdue");
    const o = await orderOf(env, slToken, order.id);
    check(g, "3b đã cọc 40đ rồi hủy-mở lại: chỉ 1 hàng công nợ, kích hoạt lại còn 60đ, cọc vẫn 40đ",
      before.length === 1 && before[0].totalAmount === 60 && isOk(cancel) && isOk(reConfirm)
      && after.length === 1 && d && d.totalAmount === 60 && d.paidAmount === 0 && d.status === "open" && o.depositAmount === 40,
      `trước: ${JSON.stringify(before)}, sau: ${JSON.stringify(after)}, order deposit=${o.depositAmount}`);
  }

  // 3c. Phòng thủ tầng DB: chèn trực tiếp 2 công nợ active cùng đơn phải lỗi (unique index có điều kiện).
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [{ productId: p, quantity: 1, unitPrice: 100 }]);
    let threw = false;
    let errMsg = "";
    try {
      await env.db.insert(schema.debts).values({
        partnerName: "Khách Thử", partnerType: "customer", kind: "receivable",
        totalAmount: 100, paidAmount: 0, dueDate: "", refCode: order.orderCode,
        note: "Trùng", status: "open",
      });
    } catch (e) {
      threw = true;
      errMsg = e instanceof Error ? e.message : String(e);
    }
    const ds = await debtsOfOrder(env, order.orderCode);
    check(g, "3c chèn trực tiếp công nợ active trùng phải lỗi, vẫn chỉ 1 hàng công nợ",
      threw && ds.length === 1, `threw=${threw} err=${errMsg}, rows=${ds.length}`);
  }
}

// ---------- Nhóm 4: ghi dữ liệu thất bại vẫn làm mất tồn ----------
async function group4() {
  const g = group("4 — Ghi dữ liệu thất bại vẫn làm mất tồn");
  const env = await freshEnv();
  const { adminToken, skToken, slToken } = await seedStaff(env);

  // 4a. Lỗi ghi sau khi áp tồn: createMovement + createOrder -> tồn không đổi, không phiếu/đơn mồ côi.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const failing = ctxFailInsert(env, schema.movements, 1);
    const mov = await callCtx(failing, "createMovement", {
      productId: p, type: "out", quantity: 2, unitCost: 0, reason: "Xuất", partner: "", note: "",
      actorToken: skToken, requestKey: "", expectedVersion: undefined,
    });
    const s1 = await stockOf(env, p);
    const outs1 = await movementsOf(env, { productId: p, type: "out" });
    check(g, "4a-1 lỗi ghi phiếu xuất: trả lỗi (không ném), tồn vẫn 10, 0 phiếu xuất",
      mov.ok === false && s1 === 10 && outs1.length === 0,
      `mov=${JSON.stringify(mov)}, stock=${s1}, out movements=${outs1.length}`);
    const failing2 = ctxFailInsert(env, schema.movements, 1);
    const ord = await callCtx(failing2, "createOrder", {
      customerName: "Khách Thử", customerPhone: "", customerAddress: "", status: "confirmed", note: "",
      items: [{ productId: p, quantity: 2, unitPrice: 100 }],
      actorToken: slToken, depositAmount: 0, deliveryPerson: "", deliveryFee: 0,
      expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined,
    });
    const s2 = await stockOf(env, p);
    const orders = await env.db.select().from(schema.orders);
    const outs2 = await movementsOf(env, { productId: p, type: "out" });
    check(g, "4a-2 lỗi ghi đơn xác nhận: trả lỗi (không ném), tồn vẫn 10, 0 đơn, 0 phiếu xuất",
      ord.ok === false && s2 === 10 && orders.length === 0 && outs2.length === 0,
      `ord=${JSON.stringify(ord)}, stock=${s2}, orders=${orders.length}, out movements=${outs2.length}`);
  }

  // 4b. Hai người xuất cùng lúc với cùng expectedVersion -> chỉ 1 thành công, tồn đúng, không âm.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const prod = (await env.db.select().from(schema.products).where(eq(schema.products.id, p)))[0];
    const mk = () => call(env, "createMovement", {
      productId: p, type: "out", quantity: 3, unitCost: 0, reason: "Xuất", partner: "", note: "",
      actorToken: skToken, requestKey: "", expectedVersion: prod.version,
    });
    const [r1, r2] = await Promise.all([mk(), mk()]);
    const s = await stockOf(env, p);
    const outs = await movementsOf(env, { productId: p, type: "out" });
    const okCount = [r1, r2].filter(isOk).length;
    check(g, "4b 2 lần xuất cùng lúc (cùng version): chỉ 1 thành công, tồn 7, đúng 1 phiếu xuất",
      okCount === 1 && s === 7 && outs.length === 1,
      `r1=${JSON.stringify(r1)}, r2=${JSON.stringify(r2)}, stock=${s}, out movements=${outs.length}`);
  }

  // 4c. Hai lần xác nhận đơn cùng lúc -> chỉ trừ tồn 1 lần.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [{ productId: p, quantity: 2, unitPrice: 100 }], { status: "pending" });
    const c1 = () => call(env, "updateOrderStatus", { id: order.id, status: "confirmed", actorToken: slToken });
    const [r1, r2] = await Promise.all([c1(), c1()]);
    const s = await stockOf(env, p);
    const outs = await movementsOf(env, { refCode: order.orderCode, type: "out" });
    const o = await orderOf(env, slToken, order.id);
    const okCount = [r1, r2].filter(isOk).length;
    check(g, "4c 2 lần xác nhận cùng lúc: tồn chỉ trừ 1 lần (8), đúng 1 phiếu xuất, đơn đã xác nhận",
      s === 8 && outs.length === 1 && o.status === "confirmed" && o.stockDeducted === 1,
      `r1=${JSON.stringify(r1)}, r2=${JSON.stringify(r2)} (ok=${okCount}), stock=${s}, out movements=${outs.length}, order=${o.status}/${o.stockDeducted}`);
  }

  // 4d. Bù trừ bị ép thất bại -> ghi bản ghi sửa chữa + trả lỗi nêu rõ, không im lặng.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const failing = ctxFailInsert(env, schema.movements, 1, { bumpProductId: p });
    const mov = await callCtx(failing, "createMovement", {
      productId: p, type: "out", quantity: 2, unitCost: 0, reason: "Xuất", partner: "", note: "",
      actorToken: skToken, requestKey: "", expectedVersion: undefined,
    });
    const s = await stockOf(env, p);
    const repairs = (await pendingRestocks(env)).filter((r: any) => r.productId === p && r.reason.includes("Bù trừ"));
    check(g, "4d bù trừ thất bại: trả lỗi nêu rõ đối chiếu tồn kho, có bản ghi sửa chữa, không im lặng",
      mov.ok === false && String(mov.error ?? "").includes("đối chiếu") && repairs.length >= 1,
      `mov=${JSON.stringify(mov)}, stock=${s} (tồn đã áp chưa hoàn được — đã ghi sửa chữa), repair rows=${repairs.length} ${JSON.stringify(repairs.map((r: any) => r.reason))}`);
  }
}

// ---------- main ----------
console.log("=== HARNESS TÁI HIỆN 4 NHÓM LỖI ĐỢT 2 — quản lý kho thiết bị vệ sinh ===");
console.log(`Ngày chạy: ${new Date().toISOString()}`);
await group1();
await group2();
await group3();
await group4();
console.log("\n=== TỔNG KẾT ===");
let totalPass = 0, totalFail = 0;
for (const r of results) {
  const p = r.checks.filter((c) => c.pass).length;
  const f = r.checks.length - p;
  totalPass += p; totalFail += f;
  console.log(`${r.group}: ${p}/${r.checks.length} PASS`);
}
console.log(`TỔNG: ${totalPass} PASS, ${totalFail} FAIL`);
if (totalFail > 0) {
  console.log("KẾT LUẬN: CÒN LỖI — xem các mục FAIL ở trên.");
  process.exit(1);
} else {
  console.log("KẾT LUẬN: TẤT CẢ ĐỀU PASS.");
}
