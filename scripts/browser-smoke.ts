import { chromium } from "playwright-core";
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const folder = mkdtempSync(join(root, "checks", "browser-"));
const port = 24000 + Math.floor(Math.random() * 10000);
const url = `http://127.0.0.1:${port}`;
mkdirSync(join(folder, "downloads"));
const child = spawn(join(root, "QuanLyKho.exe"), [], { cwd: root, env: { ...process.env, KHO_HOME: folder, KHO_PORT: String(port), KHO_PUBLIC_DIR: join(root, "public"), KHO_MIGRATIONS_DIR: join(root, "migrations"), TEMP: join(root, "temp"), TMP: join(root, "temp") }, windowsHide: true, stdio: "pipe" });
const exited = new Promise<number>(resolve => { child.once("exit", code => resolve(code ?? -1)); });
child.stdout.on("data", () => {}); child.stderr.on("data", chunk => process.stderr.write(chunk));
for (let i = 0; i < 60; i++) { try { if ((await fetch(url + "/health")).ok) break; } catch {} await delay(100); }
const context = await chromium.launchPersistentContext(join(folder, "profile"), {
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true,
  viewport: { width: 1280, height: 960 }, acceptDownloads: true, downloadsPath: join(folder, "downloads"), timeout: 20000,
  args: ["--disk-cache-dir=" + join(folder, "cache"), "--crash-dumps-dir=" + join(root, "temp"), "--no-first-run"],
});
const page = context.pages()[0] || await context.newPage();
context.setDefaultTimeout(15000);
console.log("Browser connected", folder);
const errors: string[] = [], external: string[] = [];
page.on("pageerror", error => errors.push(error.message));
await context.route("**/*", route => {
  if (["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)) return route.continue();
  external.push(route.request().url()); return route.abort();
});
try {
  await page.goto(url);
  await page.getByLabel("Mã PIN đăng nhập", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByLabel("Mã PIN mới", { exact: true }).fill("654321");
  await page.getByLabel("Nhập lại mã PIN mới", { exact: true }).fill("654321");
  await page.locator('form button[type="submit"]').click();
  await page.getByRole("navigation", { name: "Điều hướng chính" }).waitFor();
  console.log("Login and PIN change passed");
  await page.getByLabel("Thêm sản phẩm đầu tiên", { exact: true }).click();
  const productDialog = page.getByRole("dialog", { name: "Thêm sản phẩm mới", exact: true });
  await productDialog.getByLabel("Mã sản phẩm SKU", { exact: true }).fill("BROWSER-TEST");
  await productDialog.getByLabel("Tên sản phẩm", { exact: true }).fill("Sản phẩm thử trình duyệt");
  await productDialog.getByLabel("Giá nhập", { exact: true }).fill("100000");
  await productDialog.getByLabel("Giá bán", { exact: true }).fill("200000");
  await productDialog.getByLabel("Tồn đầu kỳ", { exact: true }).fill("10");
  await productDialog.locator('button[type="submit"]').click();
  await productDialog.waitFor({ state: "hidden" });
  console.log("Product saved");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
    window.dispatchEvent(new Event("offline"));
  });
  await page.getByRole("button", { name: "Tồn kho", exact: true }).click();
  await page.getByLabel("Nhập thêm Sản phẩm thử trình duyệt", { exact: true }).click();
  const receiptDialog = page.getByRole("dialog", { name: "Phiếu nhập / xuất / kiểm kê", exact: true });
  await receiptDialog.getByRole("button", { name: "Nhiều mặt hàng", exact: true }).click();
  await receiptDialog.getByLabel("Số lượng dòng 1", { exact: true }).fill("1");
  await receiptDialog.getByLabel("Đơn giá dòng 1", { exact: true }).fill("100000");
  await receiptDialog.getByRole("button", { name: "+ Thêm dòng hàng", exact: true }).click();
  await receiptDialog.getByLabel("Số lượng dòng 2", { exact: true }).fill("1");
  await receiptDialog.getByLabel("Đơn giá dòng 2", { exact: true }).fill("200000");
  await receiptDialog.locator('button[type="submit"]').click();
  await receiptDialog.waitFor({ state: "hidden" });
  console.log("Mixed-price receipt saved with Internet offline event");
  await page.reload();
  await page.getByRole("button", { name: "Tồn kho", exact: true }).click();
  const products = await page.evaluate(async () => {
    const response = await fetch("/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "listProducts", args: { actorToken: sessionStorage.getItem("staffToken") } }) });
    return await response.json();
  });
  assert.equal(products.products[0].currentStock, 12);
  const downloading = page.waitForEvent("download");
  await page.getByLabel("Xuất CSV tồn kho", { exact: true }).click();
  const download = await downloading;
  const downloadedPath = join(folder, "downloads", download.suggestedFilename());
  await download.saveAs(downloadedPath);
  assert.ok(readFileSync(downloadedPath, "utf8").includes("BROWSER-TEST"));
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(external.length, 0, external.join("\n"));
  await page.screenshot({ path: join(folder, "warehouse.png"), fullPage: true });
  const result = { ok: true, folder, checks: ["login", "mandatory PIN change", "create product", "Internet offline event with local writes", "mixed-price receipt", "reload persistence", "CSV download on D", "no external requests", "no page errors"], stock: 12, downloadedPath, screenshot: join(folder, "warehouse.png") };
  writeFileSync(join(root, "checks", "browser-smoke.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: join(folder, "failure.png"), fullPage: true }).catch(() => {});
  console.error(error, "Browser evidence:", folder);
  process.exitCode = 1;
} finally {
  await context.close();
  const state = JSON.parse(readFileSync(join(folder, "data", "runtime.json"), "utf8"));
  await fetch(url + "/local/shutdown", { method: "POST", headers: { "X-Local-Key": state.token } });
  await exited;
}
