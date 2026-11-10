import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { APP_ID, createLocalApp } from "./local-app";
import { checkedRoot } from "./local-database";

const root = checkedRoot(process.env.KHO_HOME || dirname(process.execPath));
const settingsFile = join(root, "cau-hinh.json");
const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
const port = Number(process.env.KHO_PORT || settings.port || 17830);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Cổng ứng dụng không hợp lệ.");
const app = createLocalApp({ root, migrationsDir: process.env.KHO_MIGRATIONS_DIR || join(root, "migrations"), publicDir: process.env.KHO_PUBLIC_DIR || join(root, "public") });
const token = randomBytes(32).toString("hex");
const stateFile = join(root, "data", "runtime.json");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.idle();
  app.close();
  if (existsSync(stateFile)) unlinkSync(stateFile);
  await server.stop(false);
}
const server = Bun.serve({
  hostname: "127.0.0.1", port, maxRequestBodySize: 16 * 1024 * 1024,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/local/shutdown") {
      if (request.method !== "POST" || url.hostname !== "127.0.0.1" || request.headers.get("X-Local-Key") !== token) return new Response("Forbidden", { status: 403 });
      setTimeout(() => { void stop(); }, 100);
      return Response.json({ ok: true });
    }
    if (stopping) return new Response("Stopping", { status: 503 });
    const response = await app.fetch(request);
    if (url.pathname === "/health" && response.ok) return Response.json({ app: APP_ID, ok: true, root: resolve(root) });
    return response;
  },
  error(error) {
    appendFileSync(join(root, "logs", "server.log"), `${new Date().toISOString()} ${error.stack || error.message}\n`);
    return Response.json({ error: "Ứng dụng gặp lỗi. Dữ liệu đã lưu vẫn được giữ nguyên." }, { status: 500 });
  },
});
writeFileSync(stateFile, JSON.stringify({ app: APP_ID, pid: process.pid, port, token, root }, null, 2));
process.on("SIGINT", () => { void stop(); });
process.on("SIGTERM", () => { void stop(); });
console.log(`Quan ly kho: http://127.0.0.1:${port} | Data: ${app.sqlite.filename}`);
