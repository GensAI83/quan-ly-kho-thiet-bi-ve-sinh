import { Database } from "bun:sqlite";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLocalApp } from "./local-app";
import { checkedRoot } from "./local-database";
import { pruneCloudBackups } from "./cloud-backups";

type Options = {
  root: string; migrationsDir: string; publicDir: string;
  publicOrigin: string; password: string; sessionSecret: string; now?: () => number;
};
const COOKIE = "__Host-kho_remote";
const MAX_IMPORT = 64 * 1024 * 1024;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const digest = (value: string) => createHash("sha256").update(value).digest();

export function createCloudApp(options: Options) {
  const publicUrl = new URL(options.publicOrigin);
  if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== "/") {
    throw new Error("KHO_PUBLIC_URL phải là địa chỉ HTTPS gốc của ứng dụng.");
  }
  if (options.password.length < 16) throw new Error("KHO_ACCESS_PASSWORD phải có ít nhất 16 ký tự, không có mật khẩu mặc định.");
  if (options.sessionSecret.length < 32) throw new Error("KHO_SESSION_SECRET phải có ít nhất 32 ký tự.");
  const root = checkedRoot(options.root), origin = publicUrl.origin, now = options.now ?? Date.now;
  const signingKey = createHmac("sha256", options.sessionSecret).update(options.password).digest();
  const passwordHash = digest(options.password);
  pruneCloudBackups(root);
  let local = createLocalApp({ ...options, root, publicOrigin: origin });
  let closed = false, importing = false;
  let importOperation: Promise<Response> | undefined;
  const admittedActions = new Set<Promise<Response>>();
  const failuresByClient = new Map<string, number[]>();
  function backupPolicy(reserve = false) {
    const pages = local.sqlite.query("PRAGMA page_count").get() as { page_count: number };
    const pageSize = local.sqlite.query("PRAGMA page_size").get() as { page_size: number };
    const bytes = pages.page_count * pageSize.page_size;
    return { maxFiles: reserve ? 47 : 48, maxBytes: Math.max(128 * 1024 * 1024, bytes * 3) - (reserve ? bytes : 0),
      minKeep: 2, reservedFreeBytes: reserve ? bytes + 16 * 1024 * 1024 : 0 };
  }
  const json = (data: unknown, status = 200) => Response.json(data, { status });
  const sign = (data: string) => createHmac("sha256", signingKey).update(data).digest("base64url");
  function validCookie(request: Request) {
    const cookie = request.headers.get("Cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
    if (!cookie || cookie.length > 1024) return false;
    const [payload, signature, extra] = cookie.split(".");
    if (!payload || !signature || extra) return false;
    const expected = Buffer.from(sign(payload)), actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return typeof data.expires === "number" && data.expires > now() && data.expires <= now() + SESSION_MS;
    } catch { return false; }
  }
  function sessionCookie() {
    const payload = Buffer.from(JSON.stringify({ expires: now() + SESSION_MS, nonce: randomBytes(16).toString("hex") })).toString("base64url");
    return `${COOKIE}=${payload}.${sign(payload)}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; Secure; SameSite=Lax`;
  }
  function loginPage(error = "") {
    return new Response(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quản lý kho — truy cập từ xa</title><style>body{font-family:Segoe UI,Arial,sans-serif;background:#f2f6f3;color:#143329;margin:0;padding:24px;display:grid;min-height:90vh;place-items:center}main{width:100%;max-width:380px;box-sizing:border-box;background:white;padding:28px;border-radius:24px;border:1px solid #d5e1d8}h1{font-size:24px}p{line-height:1.6;color:#52665b}label{display:block;font-weight:600;margin-top:22px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;border-radius:12px;margin-top:10px}input{border:1px solid #b6cabe}button{background:#176849;color:white;border:0;font-weight:700;cursor:pointer}.error{color:#a11d2c}</style><main><h1>Quản lý kho</h1><p>Nhập mật khẩu truy cập từ xa. Sau đó đăng nhập bằng mã PIN nhân viên như trên máy tính.</p>${error ? `<p class="error" role="alert">${error}</p>` : ""}<form action="/cloud/login" method="post"><label for="password">Mật khẩu truy cập từ xa</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button type="submit">Mở kho</button></form></main></html>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" }, status: error ? 401 : 200,
    });
  }
  function secured(response: Response) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    // Keep the same-origin form POST's Origin; no-referrer makes Chromium send null.
    headers.set("Referrer-Policy", "same-origin");
    headers.set("Strict-Transport-Security", "max-age=31536000");
    headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  function emptyWarehouse() {
    // Migrations seed ten category labels. Any app edit requires a staff row,
    // which still makes this guard reject an already initialized warehouse.
    const tables = local.sqlite.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_local_migrations','categories')").all() as { name: string }[];
    return tables.every(({ name }) => (local.sqlite.query(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).get() as { n: number }).n === 0);
  }
  async function importDatabase(request: Request) {
    await Promise.allSettled([...admittedActions]);
    await local.idle();
    if (!emptyWarehouse()) return json({ error: "Kho online đã có dữ liệu. Không ghi đè; chỉ được chuyển dữ liệu vào kho online mới, trước lần đăng nhập PIN đầu tiên." }, 409);
    if (request.headers.get("Content-Type") !== "application/vnd.sqlite3") return json({ error: "Cần một bản sao SQLite hợp lệ." }, 415);
    const input = new Uint8Array(await request.arrayBuffer());
    if (input.byteLength > MAX_IMPORT) return json({ error: "Bản chuyển dữ liệu vượt quá 64 MB." }, 413);
    if (Buffer.from(input.subarray(0, 16)).toString() !== "SQLite format 3\0") return json({ error: "File không phải cơ sở dữ liệu SQLite." }, 400);
    mkdirSync(join(root, "temp"), { recursive: true });
    const stageDir = mkdtempSync(join(root, "temp", "import-")), stageFile = join(stageDir, "warehouse.sqlite");
    let incoming: Database | undefined;
    try {
      writeFileSync(stageFile, input, { flag: "wx" });
      incoming = new Database(stageFile, { strict: true });
      const integrity = incoming.query("PRAGMA integrity_check").get() as { integrity_check: string };
      if (integrity.integrity_check !== "ok") throw new Error("integrity");
      for (const name of readdirSync(options.migrationsDir).filter(name => /^\d+_.*\.sql$/.test(name)).sort()) {
        const saved = incoming.query("SELECT sha256 FROM _local_migrations WHERE name=?").get(name) as { sha256: string } | null;
        const expected = createHash("sha256").update(readFileSync(join(options.migrationsDir, name))).digest("hex");
        if (saved?.sha256 !== expected) throw new Error("migration mismatch");
      }
      // Revoking sessions affects only this staged copy, never the source DB.
      incoming.exec("DELETE FROM staff_sessions; PRAGMA wal_checkpoint(TRUNCATE)");
      incoming.close(); incoming = undefined;
    } catch {
      incoming?.close();
      for (const suffix of ["", "-wal", "-shm"]) if (existsSync(stageFile + suffix)) unlinkSync(stageFile + suffix);
      rmdirSync(stageDir);
      return json({ error: "Bản chuyển dữ liệu bị hỏng hoặc không cùng phiên bản. Dữ liệu hiện tại được giữ nguyên." }, 400);
    }
    // A second guard protects activation if admission rules are changed later.
    if (!emptyWarehouse()) {
      for (const suffix of ["", "-wal", "-shm"]) if (existsSync(stageFile + suffix)) unlinkSync(stageFile + suffix);
      rmdirSync(stageDir);
      return json({ error: "Kho online vừa có dữ liệu. Không ghi đè; hãy kiểm tra lại trước khi chuyển." }, 409);
    }
    const filename = join(root, "data", "warehouse.sqlite");
    const oldFile = join(root, "backups", `warehouse-before-import-${randomBytes(12).toString("hex")}.sqlite`);
    local.close();
    let movedOriginal = false;
    try {
      renameSync(filename, oldFile); movedOriginal = true;
      renameSync(stageFile, filename);
      local = createLocalApp({ ...options, root, publicOrigin: origin });
      return json({ ok: true, message: "Đã chuyển dữ liệu. Hãy đăng nhập bằng PIN hiện tại; các phiên cũ đã được thu hồi." });
    } catch (error) {
      if (movedOriginal) {
        for (const suffix of ["", "-wal", "-shm"]) if (existsSync(filename + suffix)) unlinkSync(filename + suffix);
        renameSync(oldFile, filename);
      }
      local = createLocalApp({ ...options, root, publicOrigin: origin });
      throw error;
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) if (existsSync(stageFile + suffix)) unlinkSync(stageFile + suffix);
      rmdirSync(stageDir);
    }
  }
  async function handle(request: Request, clientAddress: string): Promise<Response> {
    const url = new URL(request.url), path = url.pathname;
    if (closed) return json({ error: "Ứng dụng đang tắt." }, 503);
    if (path === "/health" && request.method === "GET") return json({ app: "quan-ly-kho-online", ok: true });
    if (url.host !== publicUrl.host) return json({ error: "Địa chỉ truy cập không hợp lệ." }, 403);
    if (path.startsWith("/local/")) return json({ error: "Không có đường dẫn này." }, 404);
    if (!["GET", "HEAD"].includes(request.method) && request.headers.get("Origin") !== origin) return json({ error: "Nguồn truy cập không được phép." }, 403);
    if (path === "/cloud/login") {
      if (request.method === "GET") return loginPage();
      if (request.method !== "POST") return json({ error: "Phương thức không hợp lệ." }, 405);
      if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) return json({ error: "Dữ liệu đăng nhập không hợp lệ." }, 415);
      const raw = await request.text();
      if (raw.length > 4096) return json({ error: "Dữ liệu đăng nhập quá lớn." }, 413);
      // Read and mutate the current bucket in one synchronous section after the
      // awaited body, so simultaneous requests cannot update detached arrays.
      const key = clientAddress.slice(0, 128);
      if (!failuresByClient.has(key) && failuresByClient.size >= 4096) failuresByClient.delete(failuresByClient.keys().next().value!);
      const failures = (failuresByClient.get(key) ?? []).filter(at => at > now() - 60000);
      failuresByClient.set(key, failures);
      if (failures.length >= 10) return new Response("Bạn đã thử quá nhiều lần. Vui lòng đợi một phút.", { status: 429, headers: { "Retry-After": "60" } });
      const supplied = new URLSearchParams(raw).get("password") ?? "";
      if (!timingSafeEqual(digest(supplied), passwordHash)) { failures.push(now()); return loginPage("Mật khẩu không đúng."); }
      failuresByClient.delete(key);
      return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": sessionCookie() } });
    }
    if (!validCookie(request)) {
      return path === "/actions" || path === "/cloud/import" ? json({ error: "Phiên truy cập từ xa chưa có hoặc đã hết hạn. Tải lại trang để đăng nhập." }, 401)
        : new Response(null, { status: 303, headers: { Location: "/cloud/login" } });
    }
    if (path === "/cloud/logout" && request.method === "POST") return new Response(null, { status: 303, headers: {
      Location: "/cloud/login", "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    } });
    if (importing) return json({ error: "Đang chuyển dữ liệu, vui lòng đợi." }, 503);
    if (path === "/cloud/import" && request.method === "POST") {
      importing = true;
      importOperation = importDatabase(request);
      try { return await importOperation; } finally { importing = false; importOperation = undefined; }
    }
    const operation = local.fetch(request);
    admittedActions.add(operation);
    try { return await operation; } finally { admittedActions.delete(operation); }
  }
  return {
    async fetch(request: Request, clientAddress = "unknown") { return secured(await handle(request, clientAddress)); },
    get sqlite() { return local.sqlite; },
    async idle() { if (importOperation) await importOperation; await Promise.allSettled([...admittedActions]); await local.idle(); },
    async backup() {
      if (importOperation) await importOperation;
      await Promise.allSettled([...admittedActions]); await local.idle();
      if (closed) return;
      pruneCloudBackups(root, backupPolicy(true));
      const path = local.snapshot(); pruneCloudBackups(root, backupPolicy()); return path;
    },
    close() {
      if (!closed) {
        const policy = backupPolicy();
        pruneCloudBackups(root, backupPolicy(true)); local.close(); closed = true; pruneCloudBackups(root, policy);
      }
    },
  };
}
