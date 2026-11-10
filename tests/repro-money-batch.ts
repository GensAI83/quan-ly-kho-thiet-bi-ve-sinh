// Harness tái hiện lỗi tiền phiếu khi gộp theo sản phẩm (chạy bằng
// `bun tests/repro-money-batch.ts`).
// Không nhúng vào bundle app. Dùng Actions handler trực tiếp + SQLite trong bộ nhớ
// (libsql :memory:), áp migration drizzle/0001 -> 0005 từ file SQL.
// Mỗi nhóm dùng một DB mới để không nhiễm chéo.
// Quy ước: call() trả về kết quả action, hoặc { __thrown: true, error } khi handler ném lỗi.
// Lỗi ghi tiêm bằng cách wrap db để insert thứ N ném lỗi — cùng kỹ thuật với
// tests/repro-4-bugs.ts ("Mô phỏng mất mạng").
//
// Kịch bản người dùng báo: phiếu nhập (hoặc xuất) cùng một sản phẩm trên hai dòng,
// mỗi dòng 1 cái, đơn giá dòng 1 = 100.000đ, dòng 2 = 200.000đ. Tổng đúng =
// 300.000đ, app ghi 200.000đ (phiếu gộp lấy đơn giá dòng đầu: 2 × 100.000đ).

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
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
function throwingBuilder(message: string): any {
  const err = new Error(message);
  let rejected = false;
  const proxy: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") {
        return (_res: any, rej: any) => {
          if (rejected) { rej(err); return; }
          rejected = true;
          rej(err);
        };
      }
      if (prop === Symbol.toPrimitive) return () => message;
      return (..._a: any[]) => proxy;
    },
  });
  return proxy;
}

// ctx mà lần insert thứ `occurrence` vào `table` sẽ ném lỗi (mô phỏng mất mạng khi ghi).
function ctxFailInsert(env: Env, table: any, occurrence: number): any {
  let n = 0;
  const wrappedDb = new Proxy(env.db, {
    get(t: any, prop: string) {
      if (prop === "insert") {
        return (...a: any[]) => {
          if (a[0] === table) {
            n++;
            if (n === occurrence) return throwingBuilder("Mô phỏng mất mạng khi ghi dữ liệu.");
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

// ---------- helpers nghiệp vụ (cùng mẫu với tests/repro-2-bugs-round3.ts) ----------
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

async function repairRows(env: Env) {
  const rows = await env.db.select().from(schema.pendingRestocks);
  return rows.filter((r: any) => r.reason.includes("Bù trừ"));
}

async function repairCount(env: Env): Promise<number> {
  return (await repairRows(env)).length;
}

// Tổng tiền phiếu = Σ quantity × unitCost của các movement khớp điều kiện.
function moneyOf(movs: any[]): number {
  return movs.reduce((s: number, m: any) => s + m.quantity * m.unitCost, 0);
}

// ---------- Nhóm 1: phiếu nhập/xuất batch 2 dòng cùng SP, giá khác nhau ----------
async function group1() {
  const g = group("1 — Phiếu batch 2 dòng cùng SP, giá khác nhau (100.000đ + 200.000đ)");
  const env = await freshEnv();
  const { adminToken, skToken } = await seedStaff(env);

  // 1a. Phiếu NHẬP batch 1×100k + 1×200k.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const repairsBefore = await repairCount(env);
    const batch = await call(env, "createMovementBatch", {
      actorToken: skToken, type: "in",
      lines: [
        { productId: p, quantity: 1, unitCost: 100000, reason: "Nhập kho", partner: "", note: "" },
        { productId: p, quantity: 1, unitCost: 200000, reason: "Nhập kho", partner: "", note: "" },
      ],
      requestKey: "", expectedVersions: undefined,
    });
    const s = await stockOf(env, p);
    const movs = await movementsOf(env, { productId: p, refCode: batch.refCode, type: "in" });
    const repairs = (await repairRows(env)).length - repairsBefore;
    const chain = movs.map((m: any) => `${m.beforeStock}→${m.afterStock}`).join(", ");
    check(g, "1a phiếu nhập batch 1×100k + 1×200k: tổng tiền phiếu == 300.000đ, tồn 10→12, 0 bản ghi sửa chữa, results 1 SP (tồn mới 12)",
      isOk(batch) && moneyOf(movs) === 300000 && s === 12 && repairs === 0
      && movs.length === 2 && chain === "10→11, 11→12" && (batch.results as any[]).length === 1 && (batch.results as any[])[0]?.newStock === 12,
      `batch ok=${isOk(batch)} refCode=${batch.refCode}, tiền phiếu=${moneyOf(movs)} (trước sửa: 200.000đ — phiếu gộp 2×100.000đ), stock=${s}, phiếu=${movs.length} [${chain}], repairs mới=${repairs}, results=${JSON.stringify(batch.results)}`);
  }

  // 1b-out. Phiếu XUẤT batch 1×100k + 1×200k + todayOutValue tăng đúng 300.000đ.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const dashBefore = await call(env, "getDashboard", { actorToken: adminToken });
    const batch = await call(env, "createMovementBatch", {
      actorToken: skToken, type: "out",
      lines: [
        { productId: p, quantity: 1, unitCost: 100000, reason: "Xuất kho", partner: "", note: "" },
        { productId: p, quantity: 1, unitCost: 200000, reason: "Xuất kho", partner: "", note: "" },
      ],
      requestKey: "", expectedVersions: undefined,
    });
    const s = await stockOf(env, p);
    const movs = await movementsOf(env, { productId: p, refCode: batch.refCode, type: "out" });
    const dashAfter = await call(env, "getDashboard", { actorToken: adminToken });
    const outDelta = dashAfter.todayOutValue - dashBefore.todayOutValue;
    check(g, "1b phiếu xuất batch 1×100k + 1×200k: tổng tiền phiếu == 300.000đ, tồn 10→8, todayOutValue tăng đúng 300.000đ",
      isOk(batch) && moneyOf(movs) === 300000 && s === 8 && outDelta === 300000,
      `batch ok=${isOk(batch)}, tiền phiếu=${moneyOf(movs)} (trước sửa: 200.000đ), stock=${s}, todayOutValue ${dashBefore.todayOutValue}→${dashAfter.todayOutValue} (tăng ${outDelta})`);
  }

  // 1b-in. Phiếu NHẬP batch + todayInValue tăng đúng 300.000đ.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const dashBefore = await call(env, "getDashboard", { actorToken: adminToken });
    const batch = await call(env, "createMovementBatch", {
      actorToken: skToken, type: "in",
      lines: [
        { productId: p, quantity: 1, unitCost: 100000, reason: "Nhập kho", partner: "", note: "" },
        { productId: p, quantity: 1, unitCost: 200000, reason: "Nhập kho", partner: "", note: "" },
      ],
      requestKey: "", expectedVersions: undefined,
    });
    const movs = await movementsOf(env, { productId: p, refCode: batch.refCode, type: "in" });
    const dashAfter = await call(env, "getDashboard", { actorToken: adminToken });
    const inDelta = dashAfter.todayInValue - dashBefore.todayInValue;
    check(g, "1b-in phiếu nhập batch 1×100k + 1×200k: todayInValue tăng đúng 300.000đ",
      isOk(batch) && moneyOf(movs) === 300000 && inDelta === 300000,
      `batch ok=${isOk(batch)}, tiền phiếu=${moneyOf(movs)}, todayInValue ${dashBefore.todayInValue}→${dashAfter.todayInValue} (tăng ${inDelta})`);
  }

  // 1c. Cùng SP, CÙNG giá, cùng reason → vẫn đúng 1 phiếu gộp (chốt chặn hồi quy đợt 3).
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const batch = await call(env, "createMovementBatch", {
      actorToken: skToken, type: "in",
      lines: [
        { productId: p, quantity: 2, unitCost: 100000, reason: "Nhập kho", partner: "", note: "" },
        { productId: p, quantity: 1, unitCost: 100000, reason: "Nhập kho", partner: "", note: "" },
      ],
      requestKey: "", expectedVersions: undefined,
    });
    const s = await stockOf(env, p);
    const movs = await movementsOf(env, { productId: p, refCode: batch.refCode, type: "in" });
    const m = movs[0] as any;
    check(g, "1c batch 2×100k + 1×100k cùng giá/cùng reason: vẫn đúng 1 phiếu gộp (số lượng 3, tiền 300.000đ, before 10 → after 13)",
      isOk(batch) && movs.length === 1 && m?.quantity === 3 && moneyOf(movs) === 300000 && m?.beforeStock === 10 && m?.afterStock === 13 && s === 13,
      `batch ok=${isOk(batch)}, phiếu=${movs.length} ${JSON.stringify(movs.map((x: any) => ({ qty: x.quantity, cost: x.unitCost, before: x.beforeStock, after: x.afterStock })))}, stock=${s}`);
  }

  // 1d. Cùng SP, cùng giá nhưng KHÁC reason → cả 2 reason đều còn trong phiếu.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const batch = await call(env, "createMovementBatch", {
      actorToken: skToken, type: "in",
      lines: [
        { productId: p, quantity: 2, unitCost: 100000, reason: "Nhập kho A", partner: "", note: "" },
        { productId: p, quantity: 1, unitCost: 100000, reason: "Nhập kho B", partner: "", note: "" },
      ],
      requestKey: "", expectedVersions: undefined,
    });
    const s = await stockOf(env, p);
    const movs = await movementsOf(env, { productId: p, refCode: batch.refCode, type: "in" });
    const reasons = movs.map((m: any) => m.reason).sort();
    check(g, "1d batch cùng giá nhưng khác reason: 2 phiếu, cả 2 reason đều còn (Nhập kho A + Nhập kho B), tổng tiền 300.000đ, tồn 13",
      isOk(batch) && movs.length === 2 && reasons.includes("Nhập kho A") && reasons.includes("Nhập kho B") && moneyOf(movs) === 300000 && s === 13,
      `batch ok=${isOk(batch)}, phiếu=${movs.length} reasons=${JSON.stringify(reasons)}, tiền=${moneyOf(movs)}, stock=${s}`);
  }
}

// ---------- Nhóm 2: đơn hàng (tạo đơn / xác nhận / trả hàng) ----------
async function group2() {
  const g = group("2 — Đơn hàng 2 dòng cùng SP, giá khác nhau (100.000đ + 200.000đ)");
  const env = await freshEnv();
  const { adminToken, slToken } = await seedStaff(env);

  // 2a. Tạo đơn confirmed 2 dòng cùng SP.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [
      { productId: p, quantity: 1, unitPrice: 100000 },
      { productId: p, quantity: 1, unitPrice: 200000 },
    ]);
    const s = await stockOf(env, p);
    const outs = await movementsOf(env, { productId: p, refCode: order.orderCode, type: "out" });
    check(g, "2a tạo đơn confirmed 2 dòng cùng SP: tổng tiền đơn == 300.000đ, tổng tiền phiếu xuất == 300.000đ, tồn 10→8",
      order.totalAmount === 300000 && moneyOf(outs) === 300000 && s === 8 && outs.length === 2,
      `totalAmount=${order.totalAmount}, tiền phiếu xuất=${moneyOf(outs)} (trước sửa: 200.000đ), stock=${s}, phiếu xuất=${outs.length} ${JSON.stringify(outs.map((x: any) => ({ qty: x.quantity, cost: x.unitCost, before: x.beforeStock, after: x.afterStock })))}`);
  }

  // 2b. Xác nhận đơn pending 2 dòng cùng SP giá khác nhau.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [
      { productId: p, quantity: 1, unitPrice: 100000 },
      { productId: p, quantity: 1, unitPrice: 200000 },
    ], { status: "pending" });
    const conf = await call(env, "updateOrderStatus", { id: order.id, status: "confirmed", actorToken: slToken });
    const s = await stockOf(env, p);
    const o = await orderOf(env, slToken, order.id);
    const outs = await movementsOf(env, { productId: p, refCode: order.orderCode, type: "out" });
    check(g, "2b xác nhận đơn pending 2 dòng cùng SP: tổng tiền phiếu xuất == 300.000đ, tồn 10→8, đơn confirmed",
      isOk(conf) && moneyOf(outs) === 300000 && s === 8 && o.status === "confirmed",
      `conf ok=${isOk(conf)}, tiền phiếu xuất=${moneyOf(outs)} (trước sửa: 200.000đ), stock=${s}, status=${o.status}, phiếu xuất=${outs.length}`);
  }

  // 2c-1. Trả hết 2 dòng (2 orderItem) cùng SP giá khác nhau.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [
      { productId: p, quantity: 1, unitPrice: 100000 },
      { productId: p, quantity: 1, unitPrice: 200000 },
    ]);
    const item100 = order.items.find((i: any) => i.unitPrice === 100000);
    const item200 = order.items.find((i: any) => i.unitPrice === 200000);
    const ret = await call(env, "createReturn", {
      actorToken: slToken, orderId: order.id,
      lines: [
        { orderItemId: item100.id, quantity: 1 },
        { orderItemId: item200.id, quantity: 1 },
      ],
      reason: "Trả thử",
    });
    const s = await stockOf(env, p);
    const ins = await movementsOf(env, { productId: p, refCode: order.orderCode, type: "in" });
    const debts = await debtsOfOrder(env, order.orderCode);
    const d = debts.find((x: any) => x.status !== "cancelled");
    const debtRemaining = d ? Math.max(0, d.totalAmount - d.paidAmount) : 0;
    check(g, "2c-1 trả hết 2 dòng cùng SP giá khác nhau: tổng tiền phiếu nhập trả == 300.000đ, tồn về 10, refund 300.000đ → công nợ còn 0",
      isOk(ret) && moneyOf(ins) === 300000 && s === 10 && debtRemaining === 0,
      `ret ok=${isOk(ret)}, tiền phiếu nhập trả=${moneyOf(ins)} (trước sửa: 200.000đ), stock=${s}, công nợ còn=${debtRemaining}, phiếu nhập=${ins.length}`);
  }

  // 2c-2. Trả một phần: chỉ trả dòng 100.000đ → phiếu nhập trả 100.000đ, công nợ còn 200.000đ.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [
      { productId: p, quantity: 1, unitPrice: 100000 },
      { productId: p, quantity: 1, unitPrice: 200000 },
    ]);
    const item100 = order.items.find((i: any) => i.unitPrice === 100000);
    const ret = await call(env, "createReturn", {
      actorToken: slToken, orderId: order.id,
      lines: [{ orderItemId: item100.id, quantity: 1 }],
      reason: "Trả thử",
    });
    const s = await stockOf(env, p);
    const ins = await movementsOf(env, { productId: p, refCode: order.orderCode, type: "in" });
    const debts = await debtsOfOrder(env, order.orderCode);
    const d = debts.find((x: any) => x.status !== "cancelled");
    const debtRemaining = d ? Math.max(0, d.totalAmount - d.paidAmount) : 0;
    check(g, "2c-2 trả một phần dòng 100.000đ: tiền phiếu nhập trả == 100.000đ, tồn 9, công nợ còn 200.000đ (không hồi quy đợt 2/3)",
      isOk(ret) && moneyOf(ins) === 100000 && s === 9 && debtRemaining === 200000,
      `ret ok=${isOk(ret)}, tiền phiếu nhập trả=${moneyOf(ins)}, stock=${s}, công nợ còn=${debtRemaining}`);
  }
}

// ---------- Nhóm 3: hồi quy đợt 3 + các nơi tiêu thụ movements ----------
async function group3() {
  const g = group("3 — Hồi quy đợt 3 + nơi tiêu thụ movements (đối chiếu, xoá phiếu)");
  const env = await freshEnv();
  const { adminToken, skToken, slToken } = await seedStaff(env);

  // 2d. Batch 2 dòng cùng SP + tiêm lỗi ghi.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const repairsBefore = await repairCount(env);
    const failing = ctxFailInsert(env, schema.movements, 1);
    const batch = await callCtx(failing, "createMovementBatch", {
      actorToken: skToken, type: "out",
      lines: [
        { productId: p, quantity: 1, unitCost: 100000, reason: "Xuất", partner: "", note: "" },
        { productId: p, quantity: 1, unitCost: 200000, reason: "Xuất", partner: "", note: "" },
      ],
      requestKey: "", expectedVersions: undefined,
    });
    const s = await stockOf(env, p);
    const outs = await movementsOf(env, { productId: p, type: "out" });
    const repairs = (await repairRows(env)).length - repairsBefore;
    check(g, "2d batch 2 dòng cùng SP + lỗi ghi: thao tác thất bại, tồn về đúng 10, 0 phiếu, 0 bản ghi sửa chữa",
      batch.ok === false && s === 10 && outs.length === 0 && repairs === 0,
      `batch=${JSON.stringify(batch)}, stock=${s}, out=${outs.length}, repairs mới=${repairs}`);
  }

  // 3a. Đối chiếu tồn kho sau phiếu tách giá: không lệch (tách phiếu không đổi tổng số lượng).
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const batch = await call(env, "createMovementBatch", {
      actorToken: skToken, type: "in",
      lines: [
        { productId: p, quantity: 1, unitCost: 100000, reason: "Nhập kho", partner: "", note: "" },
        { productId: p, quantity: 1, unitCost: 200000, reason: "Nhập kho", partner: "", note: "" },
      ],
      requestKey: "", expectedVersions: undefined,
    });
    const rec = await call(env, "reconcileStock", { actorToken: adminToken, apply: false });
    const s = await stockOf(env, p);
    check(g, "3a đối chiếu tồn sau phiếu nhập tách giá: không lệch (diffs rỗng), tồn 12",
      isOk(batch) && isOk(rec) && (rec.diffs as any[]).length === 0 && s === 12,
      `batch ok=${isOk(batch)}, diffs=${JSON.stringify(rec.diffs)}, stock=${s}`);
  }

  // 3b. Xoá phiếu theo chuỗi nối nhau: xoá phiếu cuối (11→12) rồi xoá phiếu trước (10→11) → tồn về 10.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const batch = await call(env, "createMovementBatch", {
      actorToken: skToken, type: "in",
      lines: [
        { productId: p, quantity: 1, unitCost: 100000, reason: "Nhập kho", partner: "", note: "" },
        { productId: p, quantity: 1, unitCost: 200000, reason: "Nhập kho", partner: "", note: "" },
      ],
      requestKey: "", expectedVersions: undefined,
    });
    const movs = (await movementsOf(env, { productId: p, refCode: batch.refCode, type: "in" })).sort((a: any, b: any) => a.id - b.id);
    const latest = movs[movs.length - 1];
    const first = movs[0];
    const del1 = await call(env, "deleteMovement", { id: latest.id, actorToken: skToken });
    const s1 = await stockOf(env, p);
    const del2 = await call(env, "deleteMovement", { id: first.id, actorToken: skToken });
    const s2 = await stockOf(env, p);
    const remaining = await movementsOf(env, { productId: p, refCode: batch.refCode, type: "in" });
    check(g, "3b xoá phiếu tách giá theo chuỗi: xoá phiếu cuối 11→12 → tồn 11, xoá phiếu trước 10→11 → tồn 10, 0 phiếu còn lại",
      isOk(batch) && movs.length === 2 && isOk(del1) && s1 === 11 && isOk(del2) && s2 === 10 && remaining.length === 0,
      `del cuối ok=${isOk(del1)} stock=${s1}, del trước ok=${isOk(del2)} stock=${s2}, phiếu còn lại=${remaining.length}`);
  }

  // 3c. Huỷ đơn confirmed 2 dòng cùng SP giá khác nhau → phiếu hoàn tách giá.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [
      { productId: p, quantity: 1, unitPrice: 100000 },
      { productId: p, quantity: 1, unitPrice: 200000 },
    ]);
    const sHeld = await stockOf(env, p); // 8 sau khi xác nhận
    const cancel = await call(env, "updateOrderStatus", { id: order.id, status: "cancelled", actorToken: slToken });
    const s = await stockOf(env, p);
    const o = await orderOf(env, slToken, order.id);
    const ins = await movementsOf(env, { productId: p, refCode: order.orderCode, type: "in" });
    check(g, "3c huỷ đơn confirmed 2 dòng cùng SP giá khác nhau: tổng tiền phiếu hoàn == 300.000đ, tồn về 10, đơn cancelled",
      isOk(cancel) && sHeld === 8 && moneyOf(ins) === 300000 && s === 10 && o.status === "cancelled" && ins.length === 2,
      `cancel ok=${isOk(cancel)}, stock lúc xác nhận=${sHeld}, tiền phiếu hoàn=${moneyOf(ins)}, stock=${s}, status=${o.status}, phiếu hoàn=${ins.length} ${JSON.stringify(ins.map((x: any) => ({ qty: x.quantity, cost: x.unitCost, before: x.beforeStock, after: x.afterStock })))}`);
  }

  // 3d. Huỷ giữ đơn reserved 2 dòng cùng SP giá khác nhau → phiếu hoàn tách giá.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [
      { productId: p, quantity: 1, unitPrice: 100000 },
      { productId: p, quantity: 1, unitPrice: 200000 },
    ], { status: "reserved" });
    const sHeld = await stockOf(env, p); // 8 sau khi giữ 2
    const rel = await call(env, "releaseReservation", { actorToken: slToken, orderId: order.id });
    const s = await stockOf(env, p);
    const prod = (await env.db.select().from(schema.products).where(eq(schema.products.id, p)))[0];
    const ins = await movementsOf(env, { productId: p, refCode: order.orderCode, type: "in" });
    const o = await orderOf(env, slToken, order.id);
    check(g, "3d huỷ giữ đơn reserved 2 dòng cùng SP giá khác nhau: tổng tiền phiếu hoàn == 300.000đ, tồn về 10, reservedQty 0, đơn cancelled",
      isOk(rel) && sHeld === 8 && moneyOf(ins) === 300000 && s === 10 && prod.reservedQty === 0 && o.status === "cancelled" && ins.length === 2,
      `rel ok=${isOk(rel)}, stock lúc giữ=${sHeld}, tiền phiếu hoàn=${moneyOf(ins)}, stock=${s}, reservedQty=${prod.reservedQty}, status=${o.status}, phiếu hoàn=${ins.length}`);
  }
}

// ---------- main ----------
console.log("=== HARNESS TÁI HIỆN LỖI TIỀN PHIẾU (GỘP THEO SP) — quản lý kho thiết bị vệ sinh ===");
console.log(`Ngày chạy: ${new Date().toISOString()}`);
await group1();
await group2();
await group3();
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
