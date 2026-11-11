import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
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
