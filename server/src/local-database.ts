import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { BatchItem } from "drizzle-orm/batch";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import * as schema from "./schema";

export type LocalDb = BunSQLiteDatabase<typeof schema> & { batch: (items: BatchItem<"sqlite">[]) => Promise<unknown[]> };

export function checkedRoot(root: string) {
  if (!isAbsolute(root)) throw new Error("Thư mục ứng dụng phải là đường dẫn tuyệt đối ngoài ổ C.");
  const path = resolve(root);
  if (/^c:[\\/]/i.test(path)) throw new Error("Ứng dụng không lưu dữ liệu trên ổ C. Hãy dùng ổ D hoặc E.");
  return path;
}

export function openLocalDatabase(root: string, migrationsDir: string) {
  root = checkedRoot(root);
  for (const dir of ["data", "backups", "exports", "logs", "temp"]) mkdirSync(join(root, dir), { recursive: true });
  const filename = join(root, "data", "warehouse.sqlite");
  const sqlite = new Database(filename, { create: true, strict: true });
  try {
    sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    sqlite.exec("CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)");
    const files = readdirSync(migrationsDir).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
    if (files.length === 0) throw new Error("Không tìm thấy bộ tạo dữ liệu. Hãy giữ thư mục migrations cạnh ứng dụng.");
    for (const name of files) {
      const contents = readFileSync(join(migrationsDir, name), "utf8");
      const digest = createHash("sha256").update(contents).digest("hex");
      const old = sqlite.query("SELECT sha256 FROM _local_migrations WHERE name = ?").get(name) as { sha256: string } | null;
      if (old) {
        if (old.sha256 !== digest) throw new Error(`File tạo dữ liệu đã bị thay đổi: ${name}. Dữ liệu hiện tại được giữ nguyên.`);
        continue;
      }
      sqlite.transaction(() => {
        sqlite.exec(contents);
        sqlite.query("INSERT INTO _local_migrations VALUES (?, ?, ?)").run(name, digest, new Date().toISOString());
      })();
    }
    const base = drizzle(sqlite, { schema });
    const db: LocalDb = Object.assign(base, {
      async batch(items: BatchItem<"sqlite">[]) {
        return sqlite.transaction(() => items.map(item => (item as unknown as { run: () => unknown }).run()))();
      },
    });
    function snapshot(daily = false) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const target = join(root, "backups", daily ? `warehouse-daily-${stamp.slice(0, 10)}.sqlite` : `warehouse-${stamp}.sqlite`);
      if (!existsSync(target)) writeFileSync(target, sqlite.serialize(), { flag: "wx" });
      return target;
    }
    snapshot(true);
    let closed = false;
    return { db, sqlite, filename, snapshot, close() { if (!closed) { snapshot(); sqlite.close(); closed = true; } } };
  } catch (error) { sqlite.close(); throw error; }
}
