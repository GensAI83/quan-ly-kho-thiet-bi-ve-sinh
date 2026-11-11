import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { url, password, folder } = JSON.parse(input);
const context = await chromium.launchPersistentContext(join(folder, "phone-profile"), {
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  ignoreHTTPSErrors: true, acceptDownloads: true, downloadsPath: join(folder, "downloads"), timeout: 20000,
  args: ["--disk-cache-dir=" + join(folder, "phone-cache"), "--crash-dumps-dir=" + join(folder, "temp"), "--no-first-run"],
});
context.setDefaultTimeout(15000);
const page = context.pages()[0] || await context.newPage();
const errors: string[] = [], external: string[] = [];
page.on("pageerror", e => errors.push(e.message));
await context.route("**/*", route => {
  if (new URL(route.request().url()).origin === url) return route.continue();
  external.push(route.request().url()); return route.abort();
});
try {
  await page.goto(url);
  await page.getByLabel("Mật khẩu truy cập từ xa", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Mở kho", exact: true }).click();
  await page.getByLabel("Mã PIN đăng nhập", { exact: true }).fill("654321");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.getByRole("navigation", { name: "Điều hướng chính" }).waitFor();
  await page.getByRole("button", { name: "Tồn kho", exact: true }).click();
  await page.getByLabel("Thêm sản phẩm mới", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Thêm sản phẩm mới", exact: true });
  await dialog.getByLabel("Mã sản phẩm SKU", { exact: true }).fill("PHONE-003");
  await dialog.getByLabel("Tên sản phẩm", { exact: true }).fill("Sản phẩm điện thoại");
  await dialog.getByLabel("Giá nhập", { exact: true }).fill("100000");
  await dialog.getByLabel("Giá bán", { exact: true }).fill("200000");
  await dialog.getByLabel("Tồn đầu kỳ", { exact: true }).fill("3");
  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("button", { name: "Tồn kho", exact: true }).click();
  await page.getByText("Sản phẩm điện thoại", { exact: true }).waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page.getByLabel("Xuất CSV tồn kho", { exact: true }).click();
  const download = await downloadEvent;
  const downloaded = join(folder, "downloads", download.suggestedFilename());
  await download.saveAs(downloaded);
  assert.ok(readFileSync(downloaded, "utf8").includes("PHONE-003"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, "Phone page overflows by " + overflow);
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(external.length, 0, external.join("\n"));
  const screenshot = join(folder, "phone.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  writeFileSync(join(folder, "phone-result.json"), JSON.stringify({ ok: true, viewport: "390x844", screenshot, downloaded,
    checks: ["HTTPS remote password gate", "existing staff PIN", "phone product creation", "reload persistence", "CSV download", "no horizontal page overflow", "no page errors", "no external requests"] }, null, 2));
  console.log("Phone browser workflow passed.");
} catch (error) {
  await page.screenshot({ path: join(folder, "phone-failure.png"), fullPage: true }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally { await context.close(); }
