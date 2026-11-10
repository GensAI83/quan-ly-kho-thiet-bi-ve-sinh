// Standalone server: Bun.serve + SQLite file, no Muse host.
//
// Serves the built client (`standalone/dist/`) and dispatches
// `POST /actions` to the SAME `Actions` handlers the Muse build uses
// (`../../server/src/actions`). The only differences from the Muse runtime:
//   - the database is a local SQLite file (`standalone/data/warehouse.db`
//     by default, overridable with `DB_PATH`);
//   - `ctx.invalidateQueries()` is a no-op — there is no cross-client
//     broadcast; the client already invalidates its own React Query cache
//     in each mutation's `onSuccess`;
//   - argument validation happens here, against each action's zod
//     `request` schema, before the handler runs.
//
// IMPORTANT — module resolution: `server/src/actions.ts` imports
// `@hatch/space-sdk` (and `drizzle-orm`). Those files live OUTSIDE
// `standalone/`, so Bun's normal node_modules walk-up from them does NOT
// find `standalone/node_modules` — on a Windows machine where only
// `standalone/` was installed, the import would fail. The `start` script
// therefore runs with `NODE_PATH=./node_modules`, which Bun honours as a
// fallback search path for bare specifiers (verified: without it the
// server fails with "Cannot find module '@hatch/space-sdk'"; with it the
// shim in `standalone/node_modules/@hatch/space-sdk` is used). The smoke
// test sets the same variable (absolute path) when it spawns the server.

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as schema from "../../server/src/schema";
import { Actions } from "../../server/src/actions";

const STANDALONE_DIR = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(STANDALONE_DIR, "..");
const DIST_DIR = join(STANDALONE_DIR, "dist");

const PORT = Number(process.env.PORT ?? "3000") || 3000;
const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : join(STANDALONE_DIR, "data", "warehouse.db");

// Migration files in `drizzle/meta/_journal.json` order.
const MIGRATIONS = [
  "0001_initial.sql",
  "0002_warehouse_tables.sql",
  "0003_stock_safety_and_ops.sql",
  "0004_auth_and_debt_status.sql",
  "0005_debt_unique_active.sql",
];

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

// --- Database ---------------------------------------------------------------

mkdirSync(dirname(DB_PATH), { recursive: true });
// @libsql/client `file:` URLs: normalise Windows backslashes to slashes.
const dbUrl = `file:${DB_PATH.replace(/\\/g, "/")}`;
const client = createClient({ url: dbUrl });
const db = drizzle(client, { schema });

async function runMigrations(): Promise<{ appliedNow: number; total: number }> {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY)",
  );
  const existing = await client.execute("SELECT name FROM __migrations");
  const done = new Set(existing.rows.map((r) => String(r.name)));
  let appliedNow = 0;
  for (const file of MIGRATIONS) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(REPO_ROOT, "drizzle", file), "utf8");
    // Same approach as the test harnesses: one executeMultiple per file.
    // Migration 0005 uses ROW_NUMBER() and a conditional unique index —
    // both run fine on a libsql file database.
    await client.executeMultiple(sql);
    await client.execute({
      sql: "INSERT INTO __migrations (name) VALUES (?)",
      args: [file],
    });
    done.add(file);
    appliedNow++;
  }
  return { appliedNow, total: done.size };
}

// The ctx the action handlers expect: the portable fields (`slug`,
// `invocationId`, `spaceDir`, `db`) plus `invalidateQueries`, which is a
// no-op here (see the header comment — there is no cross-client broadcast
// in standalone mode; the client already invalidates its own React Query
// cache in each mutation's `onSuccess`).
function makeCtx() {
  return {
    slug: "quan-ly-kho-thiet-bi-ve-sinh",
    invocationId:
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `standalone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    spaceDir: REPO_ROOT,
    db: () => db,
    invalidateQueries: () => {},
  };
}
type Ctx = ReturnType<typeof makeCtx>;

// --- Action dispatch ----------------------------------------------------------

async function handleActions(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Dữ liệu gửi lên không phải JSON hợp lệ.", 400);
  }
  const { action, args } = (body ?? {}) as {
    action?: unknown;
    args?: unknown;
  };
  if (typeof action !== "string" || action.length === 0) {
    return jsonError("Thiếu tên action.", 400);
  }
  const def = (Actions as Record<string, unknown>)[action] as
    | {
        request: {
          safeParse: (
            value: unknown,
          ) =>
            | { success: true; data: Record<string, unknown> }
            | {
                success: false;
                error: {
                  issues: { path: (string | number)[]; message: string }[];
                };
              };
        };
        handler: (
          ctx: Ctx,
          args: Record<string, unknown>,
        ) => Promise<unknown>;
      }
    | undefined;
  if (!def) {
    return jsonError(`Không tìm thấy action "${action}".`, 404);
  }
  const parsedArgs = args ?? {};
  const validation = def.request.safeParse(parsedArgs);
  if (!validation.success) {
    const first = validation.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.join(".")}: ` : "";
    const detail = first ? `${where}${first.message}` : "dữ liệu không hợp lệ";
    return jsonError(
      `Dữ liệu gửi lên không hợp lệ cho ${action}: ${detail}.`,
      400,
    );
  }
  try {
    const result = await def.handler(makeCtx(), validation.data);
    return Response.json({ data: result });
  } catch (e) {
    // Never leak a stack trace to the client.
    const message = e instanceof Error ? e.message : String(e);
    return jsonError(message || "Lỗi máy chủ.", 500);
  }
}

// --- Static files -------------------------------------------------------------

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(join(DIST_DIR, rel));
  if (!filePath.startsWith(DIST_DIR + "/") && filePath !== DIST_DIR) {
    return jsonError("Không tìm thấy.", 404);
  }
  if (!existsSync(filePath) || !filePath.startsWith(DIST_DIR)) {
    return jsonError("Không tìm thấy.", 404);
  }
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return jsonError("Không tìm thấy.", 404);
  }
  return new Response(file, {
    headers: { "content-type": contentTypeFor(filePath) },
  });
}

// --- Boot ---------------------------------------------------------------------

const { appliedNow, total } = await runMigrations();

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/actions") {
      if (req.method !== "POST") {
        return jsonError("Chỉ hỗ trợ POST /actions.", 405);
      }
      return handleActions(req);
    }
    if (req.method !== "GET") {
      return jsonError("Không tìm thấy.", 404);
    }
    return serveStatic(url.pathname);
  },
});

console.log(`Quản lý kho thiết bị vệ sinh (standalone) đang chạy tại http://127.0.0.1:${server.port}`);
console.log(`Cơ sở dữ liệu: ${DB_PATH}`);
console.log(
  `Migration: đã áp ${appliedNow} file trong lần chạy này, tổng ${total}/${MIGRATIONS.length} file đã áp.`,
);
if (!existsSync(join(DIST_DIR, "app.js"))) {
  console.log(
    "Lưu ý: chưa có client đã build (standalone/dist/app.js). Chạy `bun run build` trước rồi khởi động lại server.",
  );
}
