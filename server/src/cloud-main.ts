import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { isIP } from "node:net";
import { createCloudApp } from "./cloud-app";

const root = process.env.KHO_DATA_DIR;
if (!root) throw new Error("Cần KHO_DATA_DIR trỏ tới thư mục trên ổ lưu trữ lâu dài của máy chủ.");
const publicOrigin = process.env.KHO_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "";
const port = Number(process.env.PORT || 10000);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT không hợp lệ.");
const app = createCloudApp({ root, publicOrigin, password: process.env.KHO_ACCESS_PASSWORD || "", sessionSecret: process.env.KHO_SESSION_SECRET || "",
  migrationsDir: process.env.KHO_MIGRATIONS_DIR || join(import.meta.dir, "migrations"), publicDir: process.env.KHO_PUBLIC_DIR || join(import.meta.dir, "public") });
let stopping = false;
const backupTimer = setInterval(() => { void app.backup().catch(error => {
  appendFileSync(join(root, "logs", "server.log"), `${new Date().toISOString()} Backup failed: ${String(error)}\n`);
  console.error("Automatic backup failed; check persistent storage.");
}); }, 60 * 60 * 1000);
backupTimer.unref();
const server = Bun.serve({ hostname: "0.0.0.0", port, maxRequestBodySize: 64 * 1024 * 1024,
  fetch(request, runtime) {
    // Render's edge sets X-Forwarded-For. Other hosts use the actual socket peer;
    // do not trust arbitrary forwarded headers on an exposed standalone server.
    const forwarded = process.env.RENDER === "true" ? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() : undefined;
    const clientAddress = forwarded && isIP(forwarded) ? forwarded : runtime.requestIP(request)?.address ?? "unknown";
    return stopping ? Response.json({ error: "Ứng dụng đang khởi động lại." }, { status: 503 }) : app.fetch(request, clientAddress);
  },
  error(error) {
    appendFileSync(join(root, "logs", "server.log"), `${new Date().toISOString()} ${error.stack || error.message}\n`);
    return Response.json({ error: "Ứng dụng gặp lỗi. Hãy kiểm tra kết quả trước khi gửi lại thao tác." }, { status: 500 });
  },
});
async function stop() {
  if (stopping) return;
  stopping = true; clearInterval(backupTimer);
  await app.idle(); app.close(); await server.stop(false);
}
process.on("SIGTERM", () => { void stop(); });
process.on("SIGINT", () => { void stop(); });
console.log(`Warehouse online ready on port ${port}; HTTPS origin ${publicOrigin}`);
