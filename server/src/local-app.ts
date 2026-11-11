import { appendFileSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Actions } from "./actions";
import { openLocalDatabase } from "./local-database";

export const APP_ID = "quan-ly-kho-local";
type Options = { root: string; migrationsDir: string; publicDir: string; publicOrigin?: string };

export function createLocalApp(options: Options) {
  const storage = openLocalDatabase(options.root, options.migrationsDir);
  let queue = Promise.resolve();
  let closed = false;
  const context = { db: () => storage.db, invalidateQueries() {} };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  function log(error: unknown) {
    appendFileSync(join(options.root, "logs", "server.log"), `${new Date().toISOString()} ${error instanceof Error ? error.stack : String(error)}\n`);
  }
  async function fetch(request: Request): Promise<Response> {
    if (closed) return json({ error: "Ứng dụng đang tắt." }, 503);
    const url = new URL(request.url);
    const configuredOrigin = options.publicOrigin ? new URL(options.publicOrigin) : undefined;
    if (configuredOrigin ? url.host !== configuredOrigin.host : !["127.0.0.1", "localhost"].includes(url.hostname)) return json({ error: "Nguồn truy cập không được phép." }, 403);
    const origin = request.headers.get("Origin");
    if (origin && origin !== (configuredOrigin?.origin ?? url.origin)) return json({ error: "Nguồn truy cập không được phép." }, 403);
    if (url.pathname === "/health" && request.method === "GET") return json({ app: APP_ID, ok: true });
    if (url.pathname === "/actions" && request.method === "POST") {
      if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return json({ error: "Yêu cầu phải là JSON." }, 415);
      let body: { action?: unknown; args?: unknown };
      try {
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 16 * 1024 * 1024) return json({ error: "Dữ liệu gửi quá lớn." }, 413);
        body = JSON.parse(raw);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body");
      } catch { return json({ error: "Dữ liệu gửi không hợp lệ." }, 400); }
      if (typeof body.action !== "string" || !Object.hasOwn(Actions, body.action)) return json({ error: "Không có thao tác này." }, 404);
      const name = body.action as keyof typeof Actions;
      const action = Actions[name];
      const parsed = action.request.safeParse(body.args ?? {});
      if (!parsed.success) return json({ error: "Dữ liệu chưa hợp lệ. Hãy kiểm tra lại các ô nhập." }, 400);
      const operation = queue.then(async () => {
        storage.sqlite.exec("BEGIN IMMEDIATE");
        try {
          const result = await (action.handler as (ctx: typeof context, args: unknown) => Promise<any>)(context, parsed.data);
          const validated = action.response.parse(result);
          // Wrong PINs deliberately update lockout counters. CSV import deliberately
          // keeps valid rows and reports rejected rows in a partial-success response.
          const failedBusinessWrite = result?.ok === false && name !== "loginStaff" && name !== "importProductsCsv";
          storage.sqlite.exec(failedBusinessWrite ? "ROLLBACK" : "COMMIT");
          return json(validated);
        } catch (error) {
          if (storage.sqlite.inTransaction) storage.sqlite.exec("ROLLBACK");
          const message = error instanceof Error ? error.message : String(error);
          const unauthorized = /Cần đăng nhập|Phiên đăng nhập/.test(message);
          if (!unauthorized) log(error);
          return json({ error: unauthorized ? message : "Không lưu được dữ liệu. Thao tác đã được hoàn lại; hãy thử lại hoặc xem nhật ký ứng dụng." }, unauthorized ? 401 : 500);
        }
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    }
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Không có đường dẫn này." }, 404);
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (path !== "/index.html" && !/^\/assets\/[a-zA-Z0-9._/-]+$/.test(path)) return json({ error: "Không có đường dẫn này." }, 404);
    const publicRoot = resolve(options.publicDir);
    const filename = resolve(publicRoot, "." + path);
    if (!filename.startsWith(publicRoot + sep) || !existsSync(filename)) return json({ error: "Không tìm thấy giao diện. Hãy chạy bản đã đóng gói." }, 404);
    return new Response(request.method === "HEAD" ? null : Bun.file(filename), { headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": ["/index.html", "/assets/theme.css"].includes(path) ? "no-cache" : "public, max-age=31536000, immutable" } });
  }
  return { fetch, sqlite: storage.sqlite, db: storage.db, snapshot: storage.snapshot, idle: () => queue, close() { if (!closed) { storage.close(); closed = true; } } };
}
