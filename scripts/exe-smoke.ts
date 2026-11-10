import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const dataRoot = mkdtempSync(join(root, "checks", "exe-"));
const port = 24000 + Math.floor(Math.random() * 10000);
const url = `http://127.0.0.1:${port}`;
function start() {
  return Bun.spawn([join(root, "QuanLyKho.exe")], { cwd: root, env: { ...process.env, KHO_HOME: dataRoot, KHO_PORT: String(port), KHO_PUBLIC_DIR: join(root, "public"), KHO_MIGRATIONS_DIR: join(root, "migrations"), TEMP: join(root, "temp"), TMP: join(root, "temp") }, stdout: "pipe", stderr: "pipe" });
}
async function ready() {
  for (let i = 0; i < 60; i++) { try { const response = await fetch(url + "/health"); if (response.ok) return; } catch {} await Bun.sleep(100); }
  throw new Error("Compiled server did not become ready");
}
async function rpc(action: string, args: object = {}) {
  const response = await fetch(url + "/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, args }) });
  assert.equal(response.status, 200);
  return await response.json() as any;
}
async function stop() {
  const state = JSON.parse(readFileSync(join(dataRoot, "data", "runtime.json"), "utf8"));
  await fetch(url + "/local/shutdown", { method: "POST", headers: { "X-Local-Key": state.token } });
}
let child = start();
try {
  await ready();
  const health = await (await fetch(url + "/health")).json() as any;
  assert.equal(health.root, dataRoot);
  const html = await (await fetch(url)).text();
  assert.match(html, /<html lang="vi">/);
  const script = html.match(/src="(\/assets\/[^\"]+\.js)"/)!;
  assert.equal((await fetch(url + script[1])).status, 200);
  const css = await (await fetch(url + "/assets/theme.css")).text();
  assert.match(css, /--accent/);
  assert.ok(!css.includes("fonts.googleapis.com"));
  assert.equal((await fetch(url + "/data/warehouse.sqlite")).status, 404);
  const login = await rpc("loginStaff", { pin: "123456" });
  assert.equal(login.ok, true);
  const token = login.token;
  const created = await rpc("createProduct", { actorToken: token, sku: "EXE-TEST", name: "Kiểm thử file chạy", category: "Bồn cầu", unit: "cái", costPrice: 100000, sellPrice: 200000, initialStock: 10 });
  assert.equal(created.ok, true);
  const receipt = await rpc("createMovementBatch", { actorToken: token, type: "in", lines: [{ productId: created.id, quantity: 1, unitCost: 100000 }, { productId: created.id, quantity: 1, unitCost: 200000 }] });
  assert.equal(receipt.ok, true);
  assert.equal((await rpc("getDashboard", { actorToken: token })).todayInValue, 1300000);
  const order = await rpc("createOrder", { actorToken: token, customerName: "Khách kiểm thử", status: "completed", items: [{ productId: created.id, quantity: 2, unitPrice: 200000 }] });
  assert.equal(order.ok, true);
  const item = (await rpc("listOrders", { actorToken: token })).orders[0].items[0];
  assert.equal((await rpc("createReturn", { actorToken: token, orderId: order.id, lines: [{ orderItemId: item.id, quantity: 1 }] })).ok, true);
  const debt = (await rpc("listDebts", { actorToken: token })).debts[0];
  assert.equal(debt.remaining, 200000);
  assert.equal((await rpc("recordDebtPayment", { actorToken: token, debtId: debt.id, amount: 200000 })).remaining, 0);
  await stop(); assert.equal(await child.exited, 0);
  child = start(); await ready();
  const products = await rpc("listProducts", { actorToken: token });
  assert.equal(products.products[0].currentStock, 11);
  assert.equal((await rpc("listOrders", { actorToken: token })).orders[0].paymentStatus, "paid");
  await stop(); assert.equal(await child.exited, 0);
  const result = { ok: true, dataRoot, checks: ["compiled HTTP server", "offline bundled assets", "private files blocked", "mixed-price money", "sale-return-payment", "restart persistence", "graceful shutdown"] };
  writeFileSync(join(root, "checks", "exe-smoke.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  child.kill();
  console.error(error);
  console.error(await new Response(child.stderr).text());
  process.exitCode = 1;
}
