import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { snapshotWarehouse, transferWarehouse } from "../scripts/cloud-transfer";

test("transfer snapshot includes committed WAL records and never changes the source database", () => {
  const root = mkdtempSync(join(resolve(import.meta.dir, "../../checks"), "transfer-test-"));
  const filename = join(root, "source.sqlite"), source = new Database(filename);
  source.exec("PRAGMA journal_mode=WAL; CREATE TABLE products(id INTEGER PRIMARY KEY, stock INTEGER); INSERT INTO products VALUES (1,17)");
  try {
    const bytes = snapshotWarehouse(filename);
    const copied = join(root, "copy.sqlite"); writeFileSync(copied, bytes);
    const copy = new Database(copied, { readonly: true });
    try {
      expect(copy.query("SELECT stock FROM products WHERE id=1").get()).toEqual({ stock: 17 });
      expect(copy.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(source.query("SELECT stock FROM products WHERE id=1").get()).toEqual({ stock: 17 });
    } finally { copy.close(); }
  } finally { source.close(); }
});

test("transfer refuses to send credentials or warehouse data over HTTP", async () => {
  await expect(transferWarehouse({ sourceDatabase: "missing.sqlite", origin: "http://warehouse.example", password: "private" })).rejects.toThrow("HTTPS");
});

test.skipIf(process.platform !== "win32")("Windows transfer launcher preserves a Unicode password through its real PowerShell pipeline", () => {
  const root = mkdtempSync(join(resolve(import.meta.dir, "../../checks"), "unicode-transfer-"));
  for (const dir of ["windows", "tools", "source/scripts", "temp", "cache/transpiler"]) mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(resolve(import.meta.dir, "../windows/Chuyen-Du-Lieu-Online.ps1"), join(root, "windows", "Chuyen-Du-Lieu-Online.ps1"));
  writeFileSync(join(root, "windows", "Stop-Kho.ps1"), "Write-Output 'Isolated test server stopped'\n");
  copyFileSync(process.execPath, join(root, "tools", "bun.exe"));
  const password = "mật-khẩu-điện-thoại-é-741852";
  writeFileSync(join(root, "source", "scripts", "transfer-cloud-data.ts"), `const data=JSON.parse(await Bun.stdin.text()); process.exit(data.password === ${JSON.stringify(password)} ? 0 : 7);`);
  const driver = join(root, "test-driver.ps1");
  writeFileSync(driver, `$env:PSModulePath=Join-Path $PSHOME 'Modules'\n$global:fixturePassword=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(password).toString("base64")}'))\nfunction Read-Host { param([string]$Prompt,[switch]$AsSecureString) if($AsSecureString){ConvertTo-SecureString $global:fixturePassword -AsPlainText -Force} elseif($Prompt -match 'HTTPS'){'https://warehouse.example'} else {''} }\n& (Join-Path $PSScriptRoot 'windows\\Chuyen-Du-Lieu-Online.ps1')\n`);
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", driver], { env: {
    ...process.env, TEMP: join(root, "temp"), TMP: join(root, "temp"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "cache", "transpiler"),
  }, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
});
