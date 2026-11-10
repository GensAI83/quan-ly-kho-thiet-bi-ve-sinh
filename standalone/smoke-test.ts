// Standalone smoke test: end-to-end checks over real HTTP.
//
// Run with `bun run smoke` from `standalone/`. Spawns the real server
// (`server/index.ts`) as a child process on a temporary port with a
// temporary SQLite file, waits for `GET /` to answer, runs the checks,
// then kills the server and deletes the temporary database. Exits non-zero
// if any check FAILs.
//
// The checks mirror the fixed bugs (see TEST_RESULTS.md): batch vouchers
// with two lines of the same product at different prices must total
// 300.000đ, a confirmed order with two such lines must total 300.000đ and
// deduct exactly 2 units, and a partial return + full payment must leave
// the order `paid` with 0 remaining debt.

import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const STANDALONE_DIR = resolve(import.meta.dir);
const PORT = 31000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = join(
  tmpdir(),
  `warehouse-smoke-${process.pid}-${Date.now()}.db`,
);
const RUN_ID = Date.now().toString(36);

type CheckResult = { name: string; pass: boolean; detail: string };
const results: CheckResult[] = [];

function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}

async function call(
  action: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function okData(r: { status: number; body: any }): any | null {
  if (r.status !== 200 || !r.body || typeof r.body.data !== "object") return null;
  return r.body.data;
}

async function waitForServer(proc: ReturnType<typeof Bun.spawn>): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) return false;
    try {
      const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // Not up yet.
    }
    await Bun.sleep(250);
  }
  return false;
}

async function startServer(dbPath: string): Promise<ReturnType<typeof Bun.spawn>> {
  const proc = Bun.spawn(["bun", "run", "server/index.ts"], {
    cwd: STANDALONE_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: String(PORT),
      // actions.ts lives outside standalone/ — see server/index.ts header.
      NODE_PATH: join(STANDALONE_DIR, "node_modules"),
    },
  });
  return proc;
}

async function stopServer(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  proc.kill();
  await proc.exited.catch(() => {});
}

function countMigrations(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query("SELECT COUNT(*) AS c FROM __migrations").get() as {
      c: number;
    } | null;
    return row?.c ?? -1;
  } finally {
    db.close();
  }
}

async function main(): Promise<number> {
  console.log(`Smoke test standalone — cổng ${PORT}, DB tạm ${DB_PATH}`);

  const proc = await startServer(DB_PATH);
  try {
    if (!(await waitForServer(proc))) {
      check("Khởi động server", false, "server không trả 200 cho GET / trong 15s");
      return 1;
    }
    check("Khởi động server", true, `GET / trả 200 trên cổng ${PORT}`);

    // -- 1. Trang chủ + bundle tĩnh -----------------------------------------
    const home = await fetch(`${BASE}/`);
    const homeText = await home.text();
    check(
      "1a. GET / trả 200 và chứa data-generated-space-root",
      home.status === 200 && homeText.includes("data-generated-space-root"),
      `status ${home.status}, dài ${homeText.length} ký tự`,
    );
    const js = await fetch(`${BASE}/app.js`);
    const jsText = await js.text();
    check(
      "1b. GET /app.js 200 và không rỗng",
      js.status === 200 && jsText.length > 1000,
      `status ${js.status}, dài ${jsText.length} ký tự`,
    );
    const css = await fetch(`${BASE}/app.css`);
    const cssText = await css.text();
    check(
      "1c. GET /app.css 200 và chứa utilities Tailwind",
      css.status === 200 &&
        (cssText.includes(".flex") || cssText.includes(".grid")),
      `status ${css.status}, dài ${cssText.length} ký tự`,
    );

    // -- 2. Đăng nhập + đổi PIN ----------------------------------------------
    const login1 = okData(await call("loginStaff", { pin: "123456" }));
    const token1 = login1?.token as string | undefined;
    check(
      "2a. Đăng nhập PIN 123456 → ok, có token, mustChangePin = 1",
      !!login1?.ok && !!token1 && login1?.staff?.mustChangePin === 1,
      JSON.stringify(login1?.staff ?? login1),
    );
    if (!token1) return 1;
    const changed = okData(
      await call("changePin", { token: token1, oldPin: "123456", newPin: "654321" }),
    );
    check("2b. Đổi PIN sang 654321 → ok", changed?.ok === true, JSON.stringify(changed));
    const login2 = okData(await call("loginStaff", { pin: "654321" }));
    const token = login2?.token as string | undefined;
    check(
      "2c. Đăng nhập PIN mới 654321 được",
      !!login2?.ok && !!token,
      `ok=${login2?.ok}`,
    );
    const loginOld = okData(await call("loginStaff", { pin: "123456" }));
    check(
      "2d. Đăng nhập PIN cũ 123456 không được",
      loginOld?.ok === false,
      `ok=${loginOld?.ok}, error=${loginOld?.error ?? ""}`,
    );
    if (!token) return 1;
    const T = { actorToken: token };

    // -- 3. Tạo sản phẩm ------------------------------------------------------
    const prodName = `SP Smoke ${RUN_ID}`;
    const created = okData(
      await call("createProduct", {
        ...T,
        name: prodName,
        category: "Bồn cầu",
        costPrice: 50,
        sellPrice: 100,
        initialStock: 10,
      }),
    );
    const productId = created?.id as number | undefined;
    check(
      "3. Tạo sản phẩm (giá nhập 50, giá bán 100, tồn đầu 10) → ok",
      created?.ok === true && !!productId,
      `id=${productId}, sku=${created?.sku ?? ""}`,
    );
    if (!productId) return 1;

    // -- 4. Phiếu nhập batch 2 dòng cùng SP, giá khác nhau --------------------
    const dashBefore = okData(await call("getDashboard", T));
    const batch = okData(
      await call("createMovementBatch", {
        ...T,
        type: "in",
        lines: [
          { productId, quantity: 1, unitCost: 100000 },
          { productId, quantity: 1, unitCost: 200000 },
        ],
      }),
    );
    const dashAfter = okData(await call("getDashboard", T));
    const inDelta =
      (dashAfter?.todayInValue ?? -1) - (dashBefore?.todayInValue ?? 0);
    check(
      "4. Phiếu nhập batch 1×100.000đ + 1×200.000đ → todayInValue tăng đúng 300.000đ",
      batch?.ok === true && inDelta === 300000,
      `ok=${batch?.ok}, todayInValue ${dashBefore?.todayInValue} → ${dashAfter?.todayInValue} (tăng ${inDelta})`,
    );

    // -- 5. Đơn confirmed 2 dòng cùng SP, giá khác nhau -----------------------
    const order = okData(
      await call("createOrder", {
        ...T,
        customerName: "Khách smoke",
        status: "confirmed",
        items: [
          { productId, quantity: 1, unitPrice: 100000 },
          { productId, quantity: 1, unitPrice: 200000 },
        ],
      }),
    );
    const orderCode = order?.orderCode as string | undefined;
    const orderId = order?.id as number | undefined;
    check(
      "5a. Tạo đơn confirmed 2 dòng cùng SP → ok, có mã đơn",
      order?.ok === true && !!orderCode,
      `orderCode=${orderCode ?? ""}, error=${order?.error ?? ""}`,
    );
    let orderItemId = 0;
    if (orderId) {
      const orders = okData(await call("listOrders", { ...T, status: "all" }));
      const found = orders?.orders?.find((o: any) => o.id === orderId);
      const movs = okData(
        await call("listMovements", { ...T, type: "out", search: orderCode ?? "" }),
      );
      const outTotal = (movs?.movements ?? [])
        .filter((m: any) => m.refCode === orderCode)
        .reduce((s: number, m: any) => s + m.quantity * m.unitCost, 0);
      const products = okData(await call("listProducts", T));
      const prod = products?.products?.find((p: any) => p.id === productId);
      orderItemId = found?.items?.[0]?.id ?? 0;
      check(
        "5b. Tổng tiền đơn 300.000đ, tồn giảm đúng 2 (12 → 10), tổng tiền phiếu xuất 300.000đ",
        found?.totalAmount === 300000 &&
          prod?.currentStock === 10 &&
          outTotal === 300000,
        `totalAmount=${found?.totalAmount}, stock=${prod?.currentStock}, phiếu xuất=${outTotal}`,
      );
    } else {
      check("5b. Tổng tiền đơn / tồn / phiếu xuất", false, "không tạo được đơn");
    }

    // -- 6. Trả một phần rồi thu đủ --------------------------------------------
    if (orderId && orderItemId) {
      const ret = okData(
        await call("createReturn", {
          ...T,
          orderId,
          lines: [{ orderItemId, quantity: 1 }],
          reason: "Smoke test trả một phần",
        }),
      );
      check("6a. Trả 1 dòng (100.000đ) → ok", ret?.ok === true, JSON.stringify(ret));
      const debts = okData(await call("listDebts", { ...T, kind: "receivable" }));
      const debt = debts?.debts?.find((d: any) => d.refCode === orderCode);
      check(
        "6b. Sau trả một phần, công nợ còn 200.000đ",
        debt?.remaining === 200000,
        `remaining=${debt?.remaining}, total=${debt?.totalAmount}, paid=${debt?.paidAmount}`,
      );
      if (debt) {
        const paid = okData(
          await call("recordDebtPayment", {
            ...T,
            debtId: debt.id,
            amount: 200000,
            method: "Tiền mặt",
          }),
        );
        check(
          "6c. Thu đủ 200.000đ còn lại → ok, remaining 0",
          paid?.ok === true && paid?.remaining === 0,
          `ok=${paid?.ok}, remaining=${paid?.remaining}`,
        );
        const orders2 = okData(await call("listOrders", { ...T, status: "all" }));
        const found2 = orders2?.orders?.find((o: any) => o.id === orderId);
        const debts2 = okData(await call("listDebts", { ...T, kind: "receivable" }));
        const debt2 = debts2?.debts?.find((d: any) => d.refCode === orderCode);
        check(
          "6d. Đơn paid, công nợ còn 0",
          found2?.paymentStatus === "paid" && debt2?.remaining === 0,
          `paymentStatus=${found2?.paymentStatus}, debt remaining=${debt2?.remaining}, status=${debt2?.status}`,
        );
      } else {
        check("6c. Thu đủ phần còn lại", false, "không tìm thấy công nợ của đơn");
        check("6d. Đơn paid, công nợ còn 0", false, "không tìm thấy công nợ của đơn");
      }
    } else {
      check("6a. Trả một phần rồi thu đủ", false, "thiếu orderId/orderItemId");
      check("6b. Công nợ sau trả một phần", false, "thiếu orderId/orderItemId");
      check("6c. Thu đủ phần còn lại", false, "thiếu orderId/orderItemId");
      check("6d. Đơn paid, công nợ còn 0", false, "thiếu orderId/orderItemId");
    }

    // -- 7. Lỗi auth / action không tồn tại / args sai schema ------------------
    const noToken = await call("listProducts", {});
    check(
      '7a. listProducts không token → lỗi chứa "Cần đăng nhập"',
      noToken.status !== 200 &&
        String(noToken.body?.error ?? "").includes("Cần đăng nhập"),
      `status ${noToken.status}, error=${noToken.body?.error ?? ""}`,
    );
    const unknown = await call("khongCoActionNay", {});
    check(
      "7b. Action không tồn tại → 404",
      unknown.status === 404,
      `status ${unknown.status}, error=${unknown.body?.error ?? ""}`,
    );
    const badArgs = await call("loginStaff", {});
    check(
      "7c. POST /actions với args sai schema (loginStaff không pin) → 400",
      badArgs.status === 400,
      `status ${badArgs.status}, error=${badArgs.body?.error ?? ""}`,
    );

    // -- 8. Sao lưu snapshot rồi khôi phục --------------------------------------
    const snap = okData(await call("createBackupSnapshot", T));
    check(
      "8a. Tạo snapshot sao lưu → ok",
      snap?.ok === true && !!snap?.id,
      `id=${snap?.id}, size=${snap?.size}`,
    );
    let afterName = "";
    if (snap?.ok) {
      const after = okData(
        await call("createProduct", {
          ...T,
          name: `SP Sau snapshot ${RUN_ID}`,
          category: "Bồn cầu",
          costPrice: 10,
          sellPrice: 20,
          initialStock: 1,
        }),
      );
      afterName = `SP Sau snapshot ${RUN_ID}`;
      check("8b. Tạo sản phẩm sau snapshot → ok", after?.ok === true, `id=${after?.id}`);
      const restored = okData(
        await call("restoreBackup", { ...T, backupId: snap.id }),
      );
      check("8c. Khôi phục snapshot → ok", restored?.ok === true, JSON.stringify(restored));
      const productsAfter = okData(await call("listProducts", T));
      const names = (productsAfter?.products ?? []).map((p: any) => p.name);
      check(
        "8d. Sau khôi phục: SP trước snapshot còn, SP sau snapshot mất",
        names.includes(prodName) && !names.includes(afterName),
        `có ${names.length} SP; còn SP smoke=${names.includes(prodName)}, còn SP sau snapshot=${names.includes(afterName)}`,
      );
    } else {
      check("8b. Tạo sản phẩm sau snapshot", false, "không tạo được snapshot");
      check("8c. Khôi phục snapshot", false, "không tạo được snapshot");
      check("8d. Dữ liệu về đúng snapshot", false, "không tạo được snapshot");
    }

    // -- 9. Migration idempotent: khởi động lần 2 trên cùng DB -----------------
    const productsBefore = okData(await call("listProducts", T));
    const countBefore = productsBefore?.products?.length ?? -1;
    const migBefore = countMigrations(DB_PATH);
    await stopServer(proc);
    const proc2 = await startServer(DB_PATH);
    try {
      const up2 = await waitForServer(proc2);
      check("9a. Khởi động lần 2 trên cùng DB → server lên", up2, up2 ? "GET / 200" : "không lên trong 15s");
      if (up2) {
        const loginAgain = okData(await call("loginStaff", { pin: "654321" }));
        const tokenAgain = loginAgain?.token as string | undefined;
        const productsAfter2 = tokenAgain
          ? okData(await call("listProducts", { actorToken: tokenAgain }))
          : null;
        const countAfter = productsAfter2?.products?.length ?? -1;
        const migAfter = countMigrations(DB_PATH);
        check(
          "9b. Dữ liệu còn nguyên sau khởi động lần 2 (số SP trước/sau bằng nhau)",
          countBefore >= 0 && countAfter === countBefore,
          `trước=${countBefore}, sau=${countAfter}`,
        );
        check(
          "9c. Bảng __migrations không tăng số dòng (không chạy lại migration cũ)",
          migBefore === 5 && migAfter === 5,
          `trước=${migBefore}, sau=${migAfter}`,
        );
      } else {
        check("9b. Dữ liệu còn nguyên sau khởi động lần 2", false, "server lần 2 không lên");
        check("9c. Bảng __migrations không tăng", false, "server lần 2 không lên");
      }
    } finally {
      await stopServer(proc2);
    }
  } finally {
    // In case the first server is still running (early return paths).
    await stopServer(proc).catch(() => {});
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const p = `${DB_PATH}${suffix}`;
      if (existsSync(p)) rmSync(p, { force: true });
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\nKết quả: ${results.length - failed.length}/${results.length} PASS, ${failed.length} FAIL.`,
  );
  if (failed.length > 0) {
    for (const f of failed) console.log(`  FAIL: ${f.name}`);
    return 1;
  }
  return 0;
}

process.exit(await main());
