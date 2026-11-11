import { existsSync, readdirSync, statfsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { checkedRoot } from "./local-database";

type Policy = { maxFiles?: number; maxBytes?: number; minKeep?: number; reservedFreeBytes?: number };
// Only our automatic names qualify. Manual and before-import copies are retained.
const automaticName = /^warehouse-(?:daily-\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sqlite$/;

export function pruneCloudBackups(root: string, policy: Policy = {}) {
  root = checkedRoot(root);
  const directory = join(root, "backups");
  if (!existsSync(directory)) return;
  const maxFiles = policy.maxFiles ?? 48, maxBytes = policy.maxBytes ?? 128 * 1024 * 1024, minKeep = policy.minKeep ?? 2;
  const files = readdirSync(directory).filter(name => automaticName.test(name)).map(name => {
    const path = join(directory, name), stat = statSync(path);
    return { path, bytes: stat.size, time: stat.mtimeMs };
  }).sort((a, b) => b.time - a.time || b.path.localeCompare(a.path));
  let total = files.reduce((sum, file) => sum + file.bytes, 0);
  function freeBytes() {
    if (!policy.reservedFreeBytes) return Number.POSITIVE_INFINITY;
    try { const stat = statfsSync(directory); return Number(stat.bavail) * Number(stat.bsize); }
    catch (error) {
      if (["ENOSYS", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code || "")) return Number.POSITIVE_INFINITY;
      throw error;
    }
  }
  while (files.length > minKeep && (files.length > maxFiles || total > maxBytes || freeBytes() < (policy.reservedFreeBytes ?? 0))) {
    const oldest = files.pop()!;
    unlinkSync(oldest.path); total -= oldest.bytes;
  }
  if (freeBytes() < (policy.reservedFreeBytes ?? 0)) throw new Error("Ổ lưu trữ chưa đủ chỗ cho bản sao an toàn. Cần tăng dung lượng hoặc chuyển bản sao cũ ra ngoài server.");
}
