// Harness tái hiện 2 lỗi đợt 3 (chạy bằng `bun tests/repro-2-bugs-round3.ts`).
// Không nhúng vào bundle app. Dùng Actions handler trực tiếp + SQLite trong bộ nhớ
// (libsql :memory:), áp migration drizzle/0001 -> 0005 từ file SQL.
// Mỗi nhóm dùng một DB mới để không nhiễm chéo.
// Quy ước: call() trả về kết quả action, hoặc { __thrown: true, error } khi handler ném lỗi.
// "Lỗi" của một thao tác = ok === false hoặc handler ném lỗi có thông báo đúng.
// Không sửa tests/repro-4-bugs.ts và tests/repro-5-bugs.ts — chạy lại cả hai để đảm bảo không hồi quy.
// Lỗi ghi tiêm bằng cách wrap db để insert thứ N ném lỗi — cùng kỹ thuật với
// tests/repro-4-bugs.ts ("Mô phỏng mất mạng").

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

// ---------- helpers nghiệp vụ (cùng mẫu với tests/repro-4-bugs.ts) ----------
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

// Số bản ghi sửa chữa (Bù trừ) hiện có — dùng để tính delta theo từng case,
// vì các case trong một nhóm dùng chung một DB.
async function repairCount(env: Env): Promise<number> {
  return (await repairRows(env)).length;
}

// ---------- Lỗi 1: công thức "Còn phải thu" ở client ----------
// Đọc đúng công thức client đang dùng trong client/src/App.tsx (tab Đơn hàng,
// dòng tính `remaining`): nếu dòng đó trừ tiền hoàn hàng (chứa "refunded") thì
// tính theo công thức mới, ngược lại tính theo công thức cũ. Đây là kiểm tra
// công thức client — server đã đúng từ đợt 2 (netPayable), chỉ client sai.
function clientRemaining(order: any): { remaining: number; usesRefunded: boolean; detail: string } {
  const src = readFileSync(`${ROOT}/client/src/App.tsx`, "utf8");
  const idx = src.indexOf("const remaining = Math.max(0, o.totalAmount");
  if (idx < 0) return { remaining: -999, usesRefunded: false, detail: "không tìm thấy dòng tính remaining trong App.tsx" };
  const windowText = src.slice(Math.max(0, idx - 300), idx + 120);
  const usesRefunded = windowText.includes("refunded");
  const refunded = (order.items as any[]).reduce((s: number, i: any) => s + (i.returnedQty || 0) * i.unitPrice, 0);
  const remaining = usesRefunded
    ? Math.max(0, order.totalAmount - refunded - order.depositAmount)
    : Math.max(0, order.totalAmount - order.depositAmount);
  return {
    remaining,
    usesRefunded,
    detail: `công thức client ${usesRefunded ? "CÓ trừ tiền hoàn" : "KHÔNG trừ tiền hoàn (cũ)"}: tổng ${order.totalAmount} − hoàn ${refunded} − cọc ${order.depositAmount} = ${remaining}`,
  };
}

// ---------- Nhóm 1: trả một phần rồi thanh toán đủ, màn hình Đơn hàng vẫn báo còn nợ ----------
async function group1() {
  const g = group("1 — Trả một phần rồi thanh toán đủ: Còn phải thu ở client");
  const env = await freshEnv();
  const { adminToken, slToken } = await seedStaff(env);

  // 1a. Đơn 100đ (60đ + 40đ), trả một phần 40đ, thu đủ 60đ còn lại.
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
    const debtRemaining = d ? Math.max(0, d.totalAmount - d.paidAmount) : 0;
    const shown = clientRemaining(o);
    check(g, "1a trả 40đ rồi thu đủ 60đ: client hiển thị Còn phải thu == 0 (công thức cũ cho ra 40đ)",
      isOk(ret) && isOk(dep) && o.paymentStatus === "paid" && debtRemaining === 0 && shown.remaining === 0,
      `ret ok=${isOk(ret)}, dep ok=${isOk(dep)}, paymentStatus=${o.paymentStatus}, công nợ còn=${debtRemaining}, client: ${shown.detail}`);
  }

  // 1b. Trả một phần rồi bấm "Ghi nhận cọc": số tiền gợi ý (remaining) == 60đ.
  {
    const pa = await mkProduct(env, adminToken, 10, 60);
    const pb = await mkProduct(env, adminToken, 10, 40);
    const order = await mkOrder(env, slToken, [
      { productId: pa, quantity: 1, unitPrice: 60 },
      { productId: pb, quantity: 1, unitPrice: 40 },
    ]);
    const itemB = order.items.find((i: any) => i.productId === pb);
    const ret = await call(env, "createReturn", { actorToken: slToken, orderId: order.id, lines: [{ orderItemId: itemB.id, quantity: 1 }], reason: "Trả B" });
    const o = await orderOf(env, slToken, order.id);
    const shown = clientRemaining(o);
    check(g, "1b trả 40đ rồi bấm Ghi nhận cọc: số tiền gợi ý == 60đ (công thức cũ gợi ý 100đ)",
      isOk(ret) && shown.remaining === 60,
      `ret ok=${isOk(ret)}, client: ${shown.detail}`);
  }

  // 1c (kiểm tra tĩnh). Dòng tính remaining trong App.tsx phải trừ tiền hoàn hàng.
  {
    const src = readFileSync(`${ROOT}/client/src/App.tsx`, "utf8");
    const idx = src.indexOf("const remaining = Math.max(0, o.totalAmount");
    const windowText = idx >= 0 ? src.slice(Math.max(0, idx - 300), idx + 120) : "";
    const ok = windowText.includes("refunded") || windowText.includes("returnedQty");
    check(g, "1c kiểm tra tĩnh: dòng tính remaining trong App.tsx trừ tiền hoàn (chứa refunded/returnedQty)",
      ok, ok ? "dòng remaining có trừ tiền hoàn" : `đoạn quanh dòng remaining: ${JSON.stringify(windowText.slice(-200))}`);
  }
}

// ---------- Nhóm 2: đơn nhiều dòng cùng sản phẩm vẫn hoàn tồn thiếu khi gặp lỗi ----------
async function group2() {
  const g = group("2 — Nhiều dòng cùng sản phẩm: hoàn tồn khi gặp lỗi");
  const env = await freshEnv();
  const { adminToken, skToken, slToken } = await seedStaff(env);

  // 2a. Đơn confirmed 2 dòng cùng SP (×2 và ×1), tồn 10, tiêm lỗi ghi sau khi trừ tồn.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const repairsBefore = await repairCount(env);
    const failing = ctxFailInsert(env, schema.movements, 1);
    const ord = await callCtx(failing, "createOrder", {
      customerName: "Khách Thử", customerPhone: "", customerAddress: "", status: "confirmed", note: "",
      items: [{ productId: p, quantity: 2, unitPrice: 100 }, { productId: p, quantity: 1, unitPrice: 100 }],
      actorToken: slToken, depositAmount: 0, deliveryPerson: "", deliveryFee: 0,
      expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined,
    });
    const s = await stockOf(env, p);
    const orders = await env.db.select().from(schema.orders);
    const outs = await movementsOf(env, { productId: p, type: "out" });
    const repairs = (await repairRows(env)).length - repairsBefore;
    check(g, "2a tạo đơn 2 dòng cùng SP + lỗi ghi: đơn thất bại, tồn về đúng 10, 0 phiếu xuất, 0 đơn, 0 bản ghi sửa chữa",
      ord.ok === false && s === 10 && orders.length === 0 && outs.length === 0 && repairs === 0,
      `ord=${JSON.stringify(ord)}, stock=${s} (trước sửa kẹt ở 8), orders=${orders.length}, out=${outs.length}, repairs mới=${repairs}`);
  }

  // 2b. Cùng kịch bản nhưng đơn thành công: tồn 7, đúng 1 phiếu xuất, đơn đủ 2 dòng.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [
      { productId: p, quantity: 2, unitPrice: 100 },
      { productId: p, quantity: 1, unitPrice: 100 },
    ]);
    const s = await stockOf(env, p);
    const outs = await movementsOf(env, { productId: p, type: "out" });
    const m = outs[0] as any;
    check(g, "2b tạo đơn 2 dòng cùng SP thành công: tồn 7, đúng 1 phiếu xuất (số lượng 3, before 10 → after 7), đơn đủ 2 dòng",
      s === 7 && outs.length === 1 && m?.quantity === 3 && m?.beforeStock === 10 && m?.afterStock === 7 && order.items.length === 2,
      `stock=${s}, out movements=${outs.length} ${JSON.stringify(outs.map((x: any) => ({ qty: x.quantity, before: x.beforeStock, after: x.afterStock })))}, order lines=${order.items.length}`);
  }

  // 2c. Xác nhận đơn pending có 2 dòng cùng SP + tiêm lỗi ghi.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [
      { productId: p, quantity: 2, unitPrice: 100 },
      { productId: p, quantity: 1, unitPrice: 100 },
    ], { status: "pending" });
    const repairsBefore = await repairCount(env);
    const failing = ctxFailInsert(env, schema.movements, 1);
    const conf = await callCtx(failing, "updateOrderStatus", { id: order.id, status: "confirmed", actorToken: slToken });
    const s = await stockOf(env, p);
    const o = await orderOf(env, slToken, order.id);
    const outs = await movementsOf(env, { productId: p, type: "out" });
    const repairs = (await repairRows(env)).length - repairsBefore;
    check(g, "2c xác nhận đơn pending 2 dòng cùng SP + lỗi ghi: tồn về đúng 10, đơn vẫn pending, 0 phiếu xuất, 0 bản ghi sửa chữa",
      conf.ok === false && s === 10 && o.status === "pending" && outs.length === 0 && repairs === 0,
      `conf=${JSON.stringify(conf)}, stock=${s} (trước sửa kẹt ở 8), status=${o.status}, out=${outs.length}, repairs mới=${repairs}`);
  }

  // 2d-1. createMovementBatch 2 dòng cùng SP + tiêm lỗi ghi.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const repairsBefore = await repairCount(env);
    const failing = ctxFailInsert(env, schema.movements, 1);
    const batch = await callCtx(failing, "createMovementBatch", {
      actorToken: skToken, type: "out",
      lines: [
        { productId: p, quantity: 2, unitCost: 0, reason: "Xuất", partner: "", note: "" },
        { productId: p, quantity: 1, unitCost: 0, reason: "Xuất", partner: "", note: "" },
      ],
      requestKey: "", expectedVersions: undefined,
    });
    const s = await stockOf(env, p);
    const outs = await movementsOf(env, { productId: p, type: "out" });
    const repairs = (await repairRows(env)).length - repairsBefore;
    check(g, "2d-1 phiếu batch 2 dòng cùng SP + lỗi ghi: tồn về đúng 10, 0 phiếu xuất, 0 bản ghi sửa chữa",
      batch.ok === false && s === 10 && outs.length === 0 && repairs === 0,
      `batch=${JSON.stringify(batch)}, stock=${s} (trước sửa kẹt ở 8), out=${outs.length}, repairs mới=${repairs}`);
  }

  // 2d-2. createMovementBatch 2 dòng cùng SP thành công: 1 phiếu gộp, results theo SP.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const batch = await call(env, "createMovementBatch", {
      actorToken: skToken, type: "out",
      lines: [
        { productId: p, quantity: 2, unitCost: 0, reason: "Xuất", partner: "", note: "" },
        { productId: p, quantity: 1, unitCost: 0, reason: "Xuất", partner: "", note: "" },
      ],
      requestKey: "", expectedVersions: undefined,
    });
    const s = await stockOf(env, p);
    const outs = await movementsOf(env, { productId: p, type: "out" });
    const m = outs[0] as any;
    check(g, "2d-2 phiếu batch 2 dòng cùng SP thành công: tồn 7, đúng 1 phiếu (số lượng 3, before 10 → after 7), results 1 SP",
      isOk(batch) && s === 7 && outs.length === 1 && m?.quantity === 3 && m?.beforeStock === 10 && m?.afterStock === 7 && (batch.results as any[]).length === 1,
      `batch ok=${isOk(batch)} results=${JSON.stringify(batch.results)}, stock=${s}, out=${outs.length}`);
  }

  // 2d-3. createReturn 2 dòng cùng SP + tiêm lỗi ghi.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [
      { productId: p, quantity: 2, unitPrice: 100 },
      { productId: p, quantity: 1, unitPrice: 100 },
    ]);
    const sBefore = await stockOf(env, p); // 7 sau khi bán 3
    const repairsBefore = await repairCount(env);
    const failing = ctxFailInsert(env, schema.movements, 1);
    const ret = await callCtx(failing, "createReturn", {
      actorToken: slToken, orderId: order.id,
      lines: [
        { orderItemId: order.items[0].id, quantity: 1 },
        { orderItemId: order.items[1].id, quantity: 1 },
      ],
      reason: "Trả thử",
    });
    const s = await stockOf(env, p);
    const items = await env.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
    const returnedTotal = items.reduce((t: number, i: any) => t + i.returnedQty, 0);
    const ins = await movementsOf(env, { refCode: order.orderCode, type: "in" });
    const repairs = (await repairRows(env)).length - repairsBefore;
    // Trước sửa, createReturn 2 dòng cùng SP lỗi ngay ở lần áp thứ 2 (xung đột
    // version do 2 đối tượng sản phẩm cùng version cũ) nên không tới được bước
    // ghi phiếu đã tiêm lỗi; vì vậy kiểm tra thêm lỗi phải đúng là lỗi ghi đã tiêm.
    check(g, "2d-3 trả hàng 2 dòng cùng SP + lỗi ghi: lỗi đúng là lỗi ghi đã tiêm, tồn về đúng 7, đã trả vẫn 0, 0 phiếu nhập trả, 0 bản ghi sửa chữa",
      ret.ok === false && String(ret.error ?? "").includes("Mô phỏng mất mạng") && s === sBefore && sBefore === 7 && returnedTotal === 0 && ins.length === 0 && repairs === 0,
      `ret=${JSON.stringify(ret)}, stock=${s} (trước thao tác ${sBefore}; trước sửa lỗi xung đột version ở lần áp thứ 2), returnedQty tổng=${returnedTotal}, in=${ins.length}, repairs mới=${repairs}`);
  }

  // 2d-4. createReturn 2 dòng cùng SP thành công: tồn 9, đúng 1 phiếu nhập gộp, mỗi dòng đã trả đúng.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [
      { productId: p, quantity: 2, unitPrice: 100 },
      { productId: p, quantity: 1, unitPrice: 100 },
    ]);
    const ret = await call(env, "createReturn", {
      actorToken: slToken, orderId: order.id,
      lines: [
        { orderItemId: order.items[0].id, quantity: 1 },
        { orderItemId: order.items[1].id, quantity: 1 },
      ],
      reason: "Trả thử",
    });
    const s = await stockOf(env, p);
    const items = await env.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
    const ins = await movementsOf(env, { refCode: order.orderCode, type: "in" });
    const m = ins[0] as any;
    check(g, "2d-4 trả hàng 2 dòng cùng SP thành công: tồn 9, đúng 1 phiếu nhập (số lượng 2, before 7 → after 9), mỗi dòng đã trả 1",
      isOk(ret) && s === 9 && ins.length === 1 && m?.quantity === 2 && m?.beforeStock === 7 && m?.afterStock === 9
      && items.every((i: any) => i.returnedQty === 1),
      `ret ok=${isOk(ret)} ${JSON.stringify(ret)}, stock=${s}, in=${ins.length} ${JSON.stringify(ins.map((x: any) => ({ qty: x.quantity, before: x.beforeStock, after: x.afterStock })))}, returnedQty=${JSON.stringify(items.map((i: any) => i.returnedQty))} (trước sửa: trả hàng 2 dòng cùng SP lỗi xung đột version ngay ở lần áp thứ 2)`);
  }

  // 2e. Hồi quy: người khác chen ngang đổi tồn giữa lúc áp và lúc bù -> bù thất bại
  // đúng như thiết kế (guard version), có bản ghi sửa chữa với fixQty đúng tuyệt đối.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const repairsBefore = await repairCount(env);
    const failing = ctxFailInsert(env, schema.movements, 1, { bumpProductId: p });
    const ord = await callCtx(failing, "createOrder", {
      customerName: "Khách Thử", customerPhone: "", customerAddress: "", status: "confirmed", note: "",
      items: [{ productId: p, quantity: 2, unitPrice: 100 }, { productId: p, quantity: 1, unitPrice: 100 }],
      actorToken: slToken, depositAmount: 0, deliveryPerson: "", deliveryFee: 0,
      expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined,
    });
    const s = await stockOf(env, p);
    const repairs = await repairRows(env);
    const newRepairs = repairs.slice(repairsBefore);
    // Lần áp duy nhất sau khi gộp: 10 -> 7, fixQty = 10 - 7 = 3 (tuyệt đối).
    // Trước sửa có 2 lần áp (10->8, 8->7) nên ghi 2 bản sửa chữa với fixQty 2 và 1.
    check(g, "2e chen ngang đổi tồn giữa áp và bù: đơn lỗi nêu rõ đối chiếu, đúng 1 bản ghi sửa chữa mới, fixQty == 3, tồn giữ nguyên 7 (không ghi đè)",
      ord.ok === false && String(ord.error ?? "").includes("đối chiếu") && newRepairs.length === 1 && (newRepairs[0] as any).quantity === 3 && s === 7,
      `ord=${JSON.stringify(ord)}, stock=${s}, repairs mới=${newRepairs.length} ${JSON.stringify(newRepairs.map((r: any) => r.quantity))} (trước sửa: 2 bản mới, fixQty 2 và 1)`);
  }

  // 2f (thêm ngoài danh sách 5 chỗ — cùng mẫu lỗi). Huỷ giữ đơn reserved
  // có 2 dòng cùng SP: hoàn đúng tồn + reservedQty về 0, 1 phiếu hoàn gộp.
  {
    const p = await mkProduct(env, adminToken, 10, 100);
    const order = await mkOrder(env, slToken, [
      { productId: p, quantity: 2, unitPrice: 100 },
      { productId: p, quantity: 1, unitPrice: 100 },
    ], { status: "reserved" });
    const sHeld = await stockOf(env, p); // 7 sau khi giữ 3
    const rel = await call(env, "releaseReservation", { actorToken: slToken, orderId: order.id });
    const s = await stockOf(env, p);
    const prod = (await env.db.select().from(schema.products).where(eq(schema.products.id, p)))[0];
    const ins = await movementsOf(env, { refCode: order.orderCode, type: "in" });
    const m = ins[0] as any;
    const o = await orderOf(env, slToken, order.id);
    check(g, "2f huỷ giữ đơn reserved 2 dòng cùng SP: tồn về 10, reservedQty 0, đúng 1 phiếu hoàn (số lượng 3, before 7 → after 10), đơn đã huỷ",
      isOk(rel) && sHeld === 7 && s === 10 && prod.reservedQty === 0 && ins.length === 1 && m?.quantity === 3 && m?.beforeStock === 7 && m?.afterStock === 10 && o.status === "cancelled",
      `rel ok=${isOk(rel)} ${JSON.stringify(rel)}, stock lúc giữ=${sHeld}, stock sau=${s}, reservedQty=${prod.reservedQty}, in=${ins.length} ${JSON.stringify(ins.map((x: any) => ({ qty: x.quantity, before: x.beforeStock, after: x.afterStock })))}, status=${o.status} (trước sửa: huỷ giữ 2 dòng cùng SP lỗi xung đột version ở lần áp thứ 2)`);
  }
}

// ---------- main ----------
console.log("=== HARNESS TÁI HIỆN 2 LỖI ĐỢT 3 — quản lý kho thiết bị vệ sinh ===");
console.log(`Ngày chạy: ${new Date().toISOString()}`);
await group1();
await group2();
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
