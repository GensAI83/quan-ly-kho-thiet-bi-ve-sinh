// Harness tái hiện 5 lỗi (chạy bằng `bun tests/repro-5-bugs.ts`).
// Không nhúng vào bundle app. Dùng Actions handler trực tiếp + SQLite trong bộ nhớ
// (libsql :memory:), áp migration drizzle/0001 -> 0002 -> 0003 -> 0004 từ file SQL.
// Mỗi nhóm dùng một DB mới để không nhiễm chéo.
// Quy ước: call() trả về kết quả action, hoặc { __thrown: true, error } khi handler ném lỗi.
// "Lỗi" của một thao tác = ok === false hoặc handler ném lỗi có thông báo đúng.

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { readFileSync, existsSync } from "node:fs";
import * as schema from "../server/src/schema";
import { Actions } from "../server/src/actions";

const ROOT = `${import.meta.dir}/..`;
const MIGRATIONS = ["0001_initial.sql", "0002_warehouse_tables.sql", "0003_stock_safety_and_ops.sql", "0004_auth_and_debt_status.sql"];

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
  try {
    return await (Actions as any)[name].handler(env.ctx, args);
  } catch (e) {
    return { __thrown: true, error: e instanceof Error ? e.message : String(e) };
  }
}

function isFail(r: any, msgPart?: string): boolean {
  if (!r) return false;
  // Một số action đọc (vd listStaff) báo lỗi bằng trường error mà không có ok.
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

// ---------- helpers nghiệp vụ ----------
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

async function mkConfirmedOrder(env: Env, token: string, productId: number, qty: number, unitPrice = 100) {
  const r = await call(env, "createOrder", {
    customerName: "Khách Thử", customerPhone: "", customerAddress: "", status: "confirmed", note: "",
    items: [{ productId, quantity: qty, unitPrice }],
    actorToken: token, depositAmount: 0, deliveryPerson: "", deliveryFee: 0,
    expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined,
  });
  if (!isOk(r)) throw new Error(`không tạo được đơn: ${JSON.stringify(r)}`);
  const list = await call(env, "listOrders", { status: "all", search: "", actorToken: token });
  const order = list.orders.find((o: any) => o.id === r.id);
  if (!order) throw new Error("không tìm thấy đơn vừa tạo");
  return order;
}

async function debtOfOrder(env: Env, token: string, orderCode: string) {
  const list = await call(env, "listDebts", { kind: "all", actorToken: token });
  return (list.debts as any[]).find((d) => d.refCode === orderCode && d.kind === "receivable");
}

async function orderOf(env: Env, token: string, orderId: number) {
  const list = await call(env, "listOrders", { status: "all", search: "", actorToken: token });
  return (list.orders as any[]).find((o: any) => o.id === orderId);
}

// ---------- Nhóm 1: vượt quyền ----------
async function group1() {
  const g = group("1 — Vượt quyền (requireAuth + ma trận phân quyền + chống dò PIN)");
  const env = await freshEnv();
  const { adminToken, skToken, slToken } = await seedStaff(env);
  const prodId = await mkProduct(env, adminToken, 10);

  const r1a = await call(env, "createStaff", { name: "Kẻ lạ", role: "admin", pin: "333333" });
  check(g, "1a createStaff admin KHÔNG token phải lỗi", isFail(r1a, "Cần đăng nhập"), JSON.stringify(r1a));

  const r1b = await call(env, "createMovement", {
    productId: prodId, type: "out", quantity: 1, unitCost: 0, reason: "Xuất bán", partner: "", note: "",
    actorToken: slToken, requestKey: "", expectedVersion: undefined,
  });
  check(g, "1b sales tạo phiếu xuất phải lỗi", isFail(r1b, "thủ kho"), JSON.stringify(r1b));

  const r1c = await call(env, "createMovement", {
    productId: prodId, type: "out", quantity: 1, unitCost: 0, reason: "Xuất bán", partner: "", note: "",
    requestKey: "", expectedVersion: undefined,
  });
  check(g, "1c không token tạo phiếu xuất phải lỗi", isFail(r1c, "Cần đăng nhập"), JSON.stringify(r1c));

  const r1d1 = await call(env, "createMovement", {
    productId: prodId, type: "in", quantity: 1, unitCost: 0, reason: "Nhập", partner: "", note: "",
    actorToken: adminToken, requestKey: "", expectedVersion: undefined,
  });
  check(g, "1d-1 admin nhập kho được", isOk(r1d1), JSON.stringify(r1d1));

  const r1d2 = await call(env, "createMovement", {
    productId: prodId, type: "out", quantity: 1, unitCost: 0, reason: "Xuất", partner: "", note: "",
    actorToken: skToken, requestKey: "", expectedVersion: undefined,
  });
  check(g, "1d-2 thủ kho xuất kho được", isOk(r1d2), JSON.stringify(r1d2));

  const r1d3 = await call(env, "createOrder", {
    customerName: "Khách", customerPhone: "", customerAddress: "", status: "pending", note: "",
    items: [{ productId: prodId, quantity: 1, unitPrice: 100 }],
    actorToken: slToken, depositAmount: 0, deliveryPerson: "", deliveryFee: 0,
    expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined,
  });
  check(g, "1d-3 sales tạo đơn được", isOk(r1d3), JSON.stringify(r1d3));

  const r1d4 = await call(env, "deleteProduct", { id: prodId, actorToken: slToken });
  check(g, "1d-4 sales xóa sản phẩm phải lỗi", isFail(r1d4, "quản trị"), JSON.stringify(r1d4));

  const r1d5 = await call(env, "updateProduct", {
    id: prodId, name: "SP Thử", category: "Bồn cầu", brand: "", unit: "cái",
    costPrice: 50, sellPrice: 999, minStock: 1, location: "", notes: "",
    actorToken: slToken, expectedVersion: undefined, priceChangeReason: "thử",
  });
  check(g, "1d-5 sales đổi giá phải lỗi", isFail(r1d5, "quản trị"), JSON.stringify(r1d5));

  const r1d6 = await call(env, "listStaff", { actorToken: slToken });
  check(g, "1d-6 sales xem danh sách nhân viên phải lỗi", isFail(r1d6, "quản trị"), JSON.stringify(r1d6));

  const r1d6b = await call(env, "listStaff", {});
  check(g, "1d-6b không token xem danh sách nhân viên phải lỗi", isFail(r1d6b, "Cần đăng nhập"), JSON.stringify(r1d6b));

  const r1e = await call(env, "getDashboard", { actorToken: "token-sai-khong-ton-tai" });
  check(g, "1e token sai gọi getDashboard phải lỗi hết hạn", isFail(r1e, "hết hạn"), JSON.stringify(r1e));

  const r1f = await call(env, "listProducts", { search: "", category: "", stockFilter: "all" });
  check(g, "1f không token đọc danh sách sản phẩm phải lỗi", isFail(r1f, "Cần đăng nhập"), JSON.stringify(r1f));

  const r1g = await call(env, "createOrder", {
    customerName: "Khách", customerPhone: "", customerAddress: "", status: "pending", note: "",
    items: [{ productId: prodId, quantity: 1, unitPrice: 100 }],
    depositAmount: 0, deliveryPerson: "", deliveryFee: 0,
    expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined,
  });
  check(g, "1g không token tạo đơn phải lỗi", isFail(r1g, "Cần đăng nhập"), JSON.stringify(r1g));

  // Chống dò PIN: DB mới, tài khoản riêng để không khóa admin đang dùng.
  const env2 = await freshEnv();
  const t2 = await seedStaff(env2);
  const lockProbe = await call(env2, "loginStaff", { pin: "222222" });
  check(g, "1h-0 đăng nhập đúng PIN bán hàng được (trước khi dò)", isOk(lockProbe), JSON.stringify(lockProbe));
  for (let i = 0; i < 5; i++) {
    const wrong = await call(env2, "loginStaff", { pin: "999999" });
    if (!isFail(wrong)) check(g, `1h-1 lần sai PIN thứ ${i + 1} phải báo sai`, false, JSON.stringify(wrong));
  }
  const afterLock = await call(env2, "loginStaff", { pin: "222222" });
  check(g, "1h-2 sau 5 lần sai, đăng nhập đúng PIN phải bị khóa", isFail(afterLock, "khóa"), JSON.stringify(afterLock));
  void t2;
}

// ---------- Nhóm 2: kiểm kê làm mất hàng ----------
async function group2() {
  const g = group("2 — Kiểm kê chốt theo delta (không mất hàng nhập/xuất xen giữa)");
  const env = await freshEnv();
  const { adminToken, skToken } = await seedStaff(env);
  const prodId = await mkProduct(env, adminToken, 4);
  const take = await call(env, "createStocktake", { actorToken: skToken, note: "Kiểm kê thử" });
  check(g, "2a tạo đợt kiểm kê", isOk(take), JSON.stringify(take));
  const save = await call(env, "saveStocktakeItem", { actorToken: skToken, stocktakeId: take.id, productId: prodId, countedQty: 9, note: "" });
  check(g, "2b lưu số đếm 9 khi sổ là 4 (diff +5)", isOk(save), JSON.stringify(save));
  const movIn = await call(env, "createMovement", {
    productId: prodId, type: "in", quantity: 5, unitCost: 0, reason: "Nhập", partner: "", note: "",
    actorToken: skToken, requestKey: "", expectedVersion: undefined,
  });
  const stockMid = await stockOf(env, prodId);
  check(g, "2c nhập thêm 5 giữa lúc đếm và chốt (tồn phải là 9)", isOk(movIn) && stockMid === 9, `stock=${stockMid}`);
  const close = await call(env, "closeStocktake", { actorToken: skToken, stocktakeId: take.id });
  const stockFinal = await stockOf(env, prodId);
  check(g, "2d chốt kiểm kê: tồn phải là 14 (4 + diff 5 + nhập 5)", isOk(close) && stockFinal === 14, `stock=${stockFinal}, close=${JSON.stringify(close)}`);
  const movs = await env.db.select().from(schema.movements).where(eq(schema.movements.productId, prodId));
  const adj = movs.filter((m: any) => m.type === "adjust");
  check(g, "2e phiếu điều chỉnh ghi before 9 -> after 14, số lượng 5", adj.length === 1 && adj[0]!.beforeStock === 9 && adj[0]!.afterStock === 14 && adj[0]!.quantity === 5, JSON.stringify(adj));
  const d0 = (close.diffs as any[] | undefined)?.[0];
  check(g, "2f diffs trả về tính theo tồn lúc chốt (systemQty 9, đếm 9)", !!d0 && d0.systemQty === 9 && d0.countedQty === 9, JSON.stringify(close.diffs));
}

// ---------- Nhóm 3: trả hàng rồi hủy đơn ----------
async function group3() {
  const g = group("3 — Trả hàng / hủy đơn không cộng thừa");
  // (i) trả hết 2 rồi hủy -> tồn 10
  {
    const env = await freshEnv();
    const { adminToken, slToken } = await seedStaff(env);
    const prodId = await mkProduct(env, adminToken, 10);
    const order = await mkConfirmedOrder(env, slToken, prodId, 2);
    check(g, "3i-a xác nhận đơn bán 2 (tồn 8)", (await stockOf(env, prodId)) === 8, `stock=${await stockOf(env, prodId)}`);
    const ret1 = await call(env, "createReturn", { actorToken: slToken, orderId: order.id, lines: [{ orderItemId: order.items[0].id, quantity: 1 }], reason: "Trả 1" });
    check(g, "3i-b trả 1 (tồn 9, partially_returned)", isOk(ret1) && (await stockOf(env, prodId)) === 9 && ret1.newStatus === "partially_returned", `stock=${await stockOf(env, prodId)}, ret=${JSON.stringify(ret1)}`);
    const ret2 = await call(env, "createReturn", { actorToken: slToken, orderId: order.id, lines: [{ orderItemId: order.items[0].id, quantity: 1 }], reason: "Trả nốt 1" });
    check(g, "3i-c trả tiếp 1 nữa phải ĐƯỢC (trước sửa: bị chặn)", isOk(ret2) && (await stockOf(env, prodId)) === 10 && ret2.newStatus === "returned", `stock=${await stockOf(env, prodId)}, ret=${JSON.stringify(ret2)}`);
    const cancel = await call(env, "updateOrderStatus", { id: order.id, status: "cancelled", actorToken: slToken });
    const stockFinal = await stockOf(env, prodId);
    check(g, "3i-d trả hết 2 rồi hủy đơn: tồn phải là 10", isOk(cancel) && stockFinal === 10, `stock=${stockFinal}, cancel=${JSON.stringify(cancel)}`);
  }
  // (ii) trả 1 rồi hủy -> tồn 10 (trước sửa: 11)
  {
    const env = await freshEnv();
    const { adminToken, slToken } = await seedStaff(env);
    const prodId = await mkProduct(env, adminToken, 10);
    const order = await mkConfirmedOrder(env, slToken, prodId, 2);
    const ret1 = await call(env, "createReturn", { actorToken: slToken, orderId: order.id, lines: [{ orderItemId: order.items[0].id, quantity: 1 }], reason: "Trả 1" });
    check(g, "3ii-a trả 1 (tồn 9)", isOk(ret1) && (await stockOf(env, prodId)) === 9, `stock=${await stockOf(env, prodId)}`);
    const retOver = await call(env, "createReturn", { actorToken: slToken, orderId: order.id, lines: [{ orderItemId: order.items[0].id, quantity: 2 }], reason: "Trả quá" });
    check(g, "3ii-a2 trả quá số còn trả được (đã trả 1/2, đòi trả 2) phải bị chặn", isFail(retOver, "chỉ còn trả được 1"), `ret=${JSON.stringify(retOver)}`);
    const cancel = await call(env, "updateOrderStatus", { id: order.id, status: "cancelled", actorToken: slToken });
    const stockFinal = await stockOf(env, prodId);
    check(g, "3ii-b trả 1 rồi hủy đơn: tồn phải là 10 (trước sửa: 11)", isOk(cancel) && stockFinal === 10, `stock=${stockFinal}, cancel=${JSON.stringify(cancel)}`);
  }
}

// ---------- Nhóm 4: công nợ ----------
async function group4() {
  const g = group("4 — Công nợ khi hủy đơn / thu nợ");
  // 4a hủy đơn -> công nợ void
  {
    const env = await freshEnv();
    const { adminToken, slToken } = await seedStaff(env);
    const prodId = await mkProduct(env, adminToken, 10);
    const order = await mkConfirmedOrder(env, slToken, prodId, 1);
    const debtBefore = await debtOfOrder(env, slToken, order.orderCode);
    check(g, "4a-a xác nhận đơn sinh công nợ 100 còn dư", !!debtBefore && debtBefore.totalAmount === 100 && debtBefore.remaining === 100 && debtBefore.status === "open", JSON.stringify(debtBefore));
    const cancel = await call(env, "updateOrderStatus", { id: order.id, status: "cancelled", actorToken: slToken });
    const debtAfter = await debtOfOrder(env, slToken, order.orderCode);
    check(g, "4a-b hủy đơn: công nợ còn lại 0 và trạng thái cancelled", isOk(cancel) && !!debtAfter && debtAfter.remaining === 0 && debtAfter.status === "cancelled", JSON.stringify(debtAfter));
  }
  // 4a2 đã thu một phần rồi hủy -> giữ paidAmount, total = paid
  {
    const env = await freshEnv();
    const { adminToken, slToken } = await seedStaff(env);
    const prodId = await mkProduct(env, adminToken, 10);
    const order = await mkConfirmedOrder(env, slToken, prodId, 1);
    const dep = await call(env, "recordDeposit", { actorToken: slToken, orderId: order.id, amount: 40 });
    check(g, "4a2-a cọc 40 trước khi hủy", isOk(dep) && dep.depositAmount === 40, JSON.stringify(dep));
    const cancel = await call(env, "updateOrderStatus", { id: order.id, status: "cancelled", actorToken: slToken });
    const debtAfter = await debtOfOrder(env, slToken, order.orderCode);
    check(g, "4a2-b hủy sau khi đã thu 40: total=40, paid=40, còn 0, cancelled", isOk(cancel) && !!debtAfter && debtAfter.totalAmount === 40 && debtAfter.paidAmount === 40 && debtAfter.remaining === 0 && debtAfter.status === "cancelled", JSON.stringify(debtAfter));
  }
  // 4b thu đủ nợ qua recordDebtPayment -> đơn paid
  {
    const env = await freshEnv();
    const { adminToken, slToken } = await seedStaff(env);
    const prodId = await mkProduct(env, adminToken, 10);
    const order = await mkConfirmedOrder(env, slToken, prodId, 1);
    const debt = await debtOfOrder(env, slToken, order.orderCode);
    const pay = await call(env, "recordDebtPayment", { actorToken: slToken, debtId: debt.id, amount: 100, method: "Tiền mặt", note: "" });
    const orderAfter = await orderOf(env, slToken, order.id);
    check(g, "4b thu 100đ qua recordDebtPayment: đơn paymentStatus phải paid", isOk(pay) && pay.remaining === 0 && orderAfter?.paymentStatus === "paid" && orderAfter?.depositAmount === 100, `pay=${JSON.stringify(pay)}, order=${JSON.stringify(orderAfter)}`);
  }
}

// ---------- Nhóm 5: hooks sau early return (kiểm tra tĩnh) ----------
async function group5() {
  const g = group("5 — Hooks sau early return ở màn hình đăng nhập (kiểm tra tĩnh App.tsx)");
  const src = readFileSync(`${ROOT}/client/src/App.tsx`, "utf8");
  const appStart = src.indexOf("export function App() {");
  if (appStart < 0) {
    check(g, "5a tìm thấy hàm App()", false, "không thấy 'export function App() {'");
    return;
  }
  const firstReturn = src.indexOf("if (!staff)", appStart);
  const secondReturn = src.indexOf("if (needPinChange)", appStart);
  check(g, "5a App() có 2 lần early return (chưa đăng nhập / đổi PIN)", firstReturn > 0 && secondReturn > firstReturn, `first=${firstReturn}, second=${secondReturn}`);
  const hookRe = /\b(useState|useEffect|useMemo|useRef|useCallback|useQuery|useMutation|useQueryClient)\s*\(/g;
  const after: string[] = [];
  const before: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = hookRe.exec(src)) !== null) {
    if (m.index < appStart) continue; // hook của component khác phía trên App
    if (firstReturn > 0 && m.index > firstReturn) after.push(`${m[1]}@${m.index}`);
    else before.push(`${m[1]}@${m.index}`);
  }
  check(g, "5b mọi hook của App() đều nằm TRƯỚC lần early return đầu tiên", after.length === 0, after.length === 0 ? `${before.length} hook đều trước early return` : `hook sau early return: ${after.join(", ")}`);
  const queryKeys = ['["dashboard"]', '["products"', '["products-all"]', '["movements"', '["orders"', '["suppliers"', '["categories"]'];
  const missingEnabled: string[] = [];
  for (const k of queryKeys) {
    const idx = src.indexOf(`queryKey: ${k}`, appStart);
    if (idx < 0) { missingEnabled.push(`${k} (không thấy)`); continue; }
    const window = src.slice(idx, idx + 600);
    if (!window.includes("enabled:")) missingEnabled.push(k);
  }
  check(g, "5c các useQuery dữ liệu có enabled: !!staff && !needPinChange", missingEnabled.length === 0, missingEnabled.length === 0 ? "đủ enabled cho 7 query" : `thiếu enabled: ${missingEnabled.join(", ")}`);
}

// ---------- Hồi quy ----------
async function groupReg() {
  const g = group("Hồi quy — tồn không âm, hủy 2 lần, chống gửi trùng");
  const env = await freshEnv();
  const { adminToken, skToken, slToken } = await seedStaff(env);
  const prodId = await mkProduct(env, adminToken, 5);

  const over = await call(env, "createMovement", {
    productId: prodId, type: "out", quantity: 99, unitCost: 0, reason: "Xuất", partner: "", note: "",
    actorToken: skToken, requestKey: "", expectedVersion: undefined,
  });
  check(g, "R1a xuất quá tồn phải lỗi, tồn không đổi (5)", isFail(over) && (await stockOf(env, prodId)) === 5, `stock=${await stockOf(env, prodId)}`);

  const overOrder = await call(env, "createOrder", {
    customerName: "Khách", customerPhone: "", customerAddress: "", status: "confirmed", note: "",
    items: [{ productId: prodId, quantity: 99, unitPrice: 100 }],
    actorToken: slToken, depositAmount: 0, deliveryPerson: "", deliveryFee: 0,
    expectedDelivery: "", reservedUntil: "", requestKey: "", expectedVersions: undefined,
  });
  check(g, "R1b đơn xác nhận vượt tồn phải lỗi, tồn không đổi (5)", isFail(overOrder) && (await stockOf(env, prodId)) === 5, `stock=${await stockOf(env, prodId)}`);

  // Hủy đơn chưa trả hoàn đúng số; hủy 2 lần không hoàn trùng.
  const order = await mkConfirmedOrder(env, slToken, prodId, 2);
  const sAfterConfirm = await stockOf(env, prodId);
  const c1 = await call(env, "updateOrderStatus", { id: order.id, status: "cancelled", actorToken: slToken });
  const sAfterC1 = await stockOf(env, prodId);
  const c2 = await call(env, "updateOrderStatus", { id: order.id, status: "cancelled", actorToken: slToken });
  const sAfterC2 = await stockOf(env, prodId);
  check(g, "R2a hủy đơn chưa trả: tồn 5 -> 3 -> 5", sAfterConfirm === 3 && isOk(c1) && sAfterC1 === 5, `3? ${sAfterConfirm} -> ${sAfterC1}`);
  check(g, "R2b hủy lần 2 không hoàn trùng (vẫn 5)", isOk(c2) && sAfterC2 === 5, `stock=${sAfterC2}`);

  // Gửi trùng requestKey không ghi trùng.
  const movsBefore = (await env.db.select().from(schema.movements).where(eq(schema.movements.productId, prodId))).length;
  const k1 = await call(env, "createMovement", {
    productId: prodId, type: "in", quantity: 1, unitCost: 0, reason: "Nhập", partner: "", note: "",
    actorToken: skToken, requestKey: "rk-trung-1", expectedVersion: undefined,
  });
  const k2 = await call(env, "createMovement", {
    productId: prodId, type: "in", quantity: 1, unitCost: 0, reason: "Nhập", partner: "", note: "",
    actorToken: skToken, requestKey: "rk-trung-1", expectedVersion: undefined,
  });
  const movsAfter = (await env.db.select().from(schema.movements).where(eq(schema.movements.productId, prodId))).length;
  check(g, "R3a gửi trùng requestKey phiếu nhập: chỉ 1 phiếu, cùng refCode", isOk(k1) && isOk(k2) && k1.refCode === k2.refCode && movsAfter === movsBefore + 1, `ref1=${k1.refCode} ref2=${k2.refCode} movs ${movsBefore}->${movsAfter}`);

  const ordersBefore = (await env.db.select().from(schema.orders)).length;
  const o1 = await call(env, "createOrder", {
    customerName: "Khách", customerPhone: "", customerAddress: "", status: "pending", note: "",
    items: [{ productId: prodId, quantity: 1, unitPrice: 100 }],
    actorToken: slToken, depositAmount: 0, deliveryPerson: "", deliveryFee: 0,
    expectedDelivery: "", reservedUntil: "", requestKey: "rk-don-trung-1", expectedVersions: undefined,
  });
  const o2 = await call(env, "createOrder", {
    customerName: "Khách", customerPhone: "", customerAddress: "", status: "pending", note: "",
    items: [{ productId: prodId, quantity: 1, unitPrice: 100 }],
    actorToken: slToken, depositAmount: 0, deliveryPerson: "", deliveryFee: 0,
    expectedDelivery: "", reservedUntil: "", requestKey: "rk-don-trung-1", expectedVersions: undefined,
  });
  const ordersAfter = (await env.db.select().from(schema.orders)).length;
  check(g, "R3b gửi trùng requestKey tạo đơn: chỉ 1 đơn, cùng orderCode", isOk(o1) && isOk(o2) && o1.orderCode === o2.orderCode && ordersAfter === ordersBefore + 1, `code1=${o1.orderCode} code2=${o2.orderCode} orders ${ordersBefore}->${ordersAfter}`);
}

// ---------- main ----------
console.log("=== HARNESS TÁI HIỆN 5 LỖI — quản lý kho thiết bị vệ sinh ===");
console.log(`Ngày chạy: ${new Date().toISOString()}`);
await group1();
await group2();
await group3();
await group4();
await group5();
await groupReg();
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
