import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLocalApp } from "../server/src/local-app";
import { createCloudApp } from "../server/src/cloud-app";

const checks = resolve(import.meta.dir, "../../checks");
const origin = "https://warehouse.example";
const password = "a-long-remote-password-741852";
const secret = "separate-session-signing-secret-0123456789abcdef";
const opened: { close(): void }[] = [];
function options(root = mkdtempSync(join(checks, "cloud-test-"))) {
  return { root, publicOrigin: origin, password, sessionSecret: secret,
    publicDir: resolve(import.meta.dir, "../../public"), migrationsDir: resolve(import.meta.dir, "../drizzle") };
}
function fresh(extra: Partial<Parameters<typeof createCloudApp>[0]> = {}) {
  const app = createCloudApp({ ...options(), ...extra }); opened.push(app); return app;
}
afterEach(() => { for (const app of opened.splice(0)) app.close(); });
async function gate(app: ReturnType<typeof fresh>) {
  const response = await app.fetch(new Request(origin + "/cloud/login", { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password }) }));
  expect(response.status).toBe(303);
  return response.headers.get("Set-Cookie")!.split(";")[0]!;
}
async function rpc(app: ReturnType<typeof fresh>, cookie: string, action: string, args: Record<string, unknown> = {}) {
  const response = await app.fetch(new Request(origin + "/actions", { method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ action, args }) }));
  return { response, data: await response.json() as any };
}

test("cloud refuses weak credentials and a non-HTTPS public origin before serving", () => {
  expect(() => fresh({ password: "123456" })).toThrow();
  expect(() => fresh({ sessionSecret: "short" })).toThrow();
  expect(() => fresh({ publicOrigin: "http://warehouse.example" })).toThrow();
});

test("public health reveals no paths, but assets and actions require remote login", async () => {
  const app = fresh();
  const health = await app.fetch(new Request(origin + "/health"));
  expect(await health.json()).toEqual({ app: "quan-ly-kho-online", ok: true });
  expect((await app.fetch(new Request(origin + "/"))).status).toBe(303);
  expect((await app.fetch(new Request(origin + "/actions", { method: "POST", headers: { Origin: origin } }))).status).toBe(401);
  expect((await app.fetch(new Request(origin + "/local/shutdown", { method: "POST" }))).status).toBe(404);
  expect((await app.fetch(new Request(origin + "/cloud/login"))).status).toBe(200);
});

test("remote cookie is secure and wrong passwords are throttled", async () => {
  const app = fresh();
  const loggedIn = await app.fetch(new Request(origin + "/cloud/login", { method: "POST", headers: { Origin: origin,
    "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password }) }));
  const cookie = loggedIn.headers.get("Set-Cookie")!;
  expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Lax");
  for (let i = 0; i < 10; i++) await app.fetch(new Request(origin + "/cloud/login", { method: "POST", headers: { Origin: origin,
    "Content-Type": "application/x-www-form-urlencoded" }, body: "password=wrong" }));
  const blocked = await app.fetch(new Request(origin + "/cloud/login", { method: "POST", headers: { Origin: origin,
    "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password }) }));
  expect(blocked.status).toBe(429);
});

test("failed passwords from one client cannot lock out a different client", async () => {
  const app = fresh();
  const request = (supplied: string) => new Request(origin + "/cloud/login", { method: "POST", headers: { Origin: origin,
    "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password: supplied }) });
  for (let i = 0; i < 10; i++) await app.fetch(request("wrong"), "198.51.100.10");
  expect((await app.fetch(request(password), "198.51.100.20")).status).toBe(303);
});

test("tampered cookies, unexpected hosts and cross-origin writes cannot access warehouse actions", async () => {
  const app = fresh(), cookie = await gate(app);
  expect((await rpc(app, cookie + "tampered", "loginStaff", { pin: "123456" })).response.status).toBe(401);
  const cross = await app.fetch(new Request(origin + "/actions", { method: "POST", headers: { Cookie: cookie,
    Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ action: "loginStaff", args: { pin: "123456" } }) }));
  expect(cross.status).toBe(403);
  expect((await app.fetch(new Request("https://evil.example/", { headers: { Cookie: cookie } }))).status).toBe(403);
  expect((await rpc(app, cookie, "listProducts")).response.status).toBe(401);
  for (const path of ["/data/warehouse.sqlite", "/source/package.json"]) {
    expect((await app.fetch(new Request(origin + path, { headers: { Cookie: cookie } }))).status).toBe(404);
  }
});

test("TLS proxy HTTP requests still require the configured HTTPS Origin and valid staff PIN", async () => {
  const app = fresh(), cookie = await gate(app);
  const response = await app.fetch(new Request("http://warehouse.example/actions", { method: "POST", headers: {
    Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "loginStaff", args: { pin: "123456" } }) }));
  expect(response.status).toBe(200);
  expect((await response.json() as any).ok).toBe(true);
});

test("cloud RPC retains full stock rollback when a voucher insert fails", async () => {
  const app = fresh(), cookie = await gate(app);
  const login = await rpc(app, cookie, "loginStaff", { pin: "123456" });
  const token = login.data.token;
  const created = await rpc(app, cookie, "createProduct", { actorToken: token, sku: "CLOUD-1", name: "Cloud fixture", category: "Bồn cầu", initialStock: 10 });
  expect(created.data.ok).toBe(true);
  app.sqlite.exec("CREATE TRIGGER fail_cloud_out BEFORE INSERT ON movements WHEN NEW.type='out' BEGIN SELECT RAISE(ABORT, 'cloud write failure'); END;");
  const failed = await rpc(app, cookie, "createMovement", { actorToken: token, productId: created.data.id, type: "out", quantity: 2 });
  expect(failed.data.ok).toBe(false);
  const products = await rpc(app, cookie, "listProducts", { actorToken: token });
  expect(products.data.products[0].currentStock).toBe(10);
  expect(app.sqlite.query("SELECT COUNT(*) AS n FROM movements WHERE type='out'").get()).toEqual({ n: 0 });
});

test("bad import leaves the empty database usable and a nonempty warehouse rejects replacement", async () => {
  const app = fresh(), cookie = await gate(app);
  const invalid = await app.fetch(new Request(origin + "/cloud/import", { method: "POST", headers: {
    Cookie: cookie, Origin: origin, "Content-Type": "application/vnd.sqlite3" }, body: "not a database" }));
  expect(invalid.status).toBe(400);
  const owner = await rpc(app, cookie, "loginStaff", { pin: "123456" });
  expect(owner.data.ok).toBe(true);
  const duplicate = await app.fetch(new Request(origin + "/cloud/import", { method: "POST", headers: {
    Cookie: cookie, Origin: origin, "Content-Type": "application/vnd.sqlite3" }, body: app.sqlite.serialize() }));
  expect(duplicate.status).toBe(409);
  expect((await rpc(app, cookie, "loginStaff", { pin: "123456" })).data.ok).toBe(true);
});

test("consistent SQLite import preserves stock and PIN, revokes old sessions, and survives restart", async () => {
  const sourceOptions = options();
  const source = createLocalApp({ root: sourceOptions.root, publicDir: sourceOptions.publicDir, migrationsDir: sourceOptions.migrationsDir }); opened.push(source);
  const localRpc = async (action: string, args: Record<string, unknown>) => {
    const r = await source.fetch(new Request("http://127.0.0.1:17830/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, args }) }));
    return await r.json() as any;
  };
  const old = await localRpc("loginStaff", { pin: "123456" });
  expect((await localRpc("changePin", { token: old.token, oldPin: "123456", newPin: "654321" })).ok).toBe(true);
  const newLogin = await localRpc("loginStaff", { pin: "654321" });
  expect((await localRpc("createProduct", { actorToken: newLogin.token, sku: "MIGRATED-17", name: "Migrated product", category: "Bồn cầu", initialStock: 17 })).ok).toBe(true);
  const root = options().root, app = fresh({ root }), cookie = await gate(app);
  const imported = await app.fetch(new Request(origin + "/cloud/import", { method: "POST", headers: {
    Cookie: cookie, Origin: origin, "Content-Type": "application/vnd.sqlite3" }, body: source.sqlite.serialize() }));
  expect(imported.status).toBe(200);
  expect(app.sqlite.query("SELECT COUNT(*) AS n FROM staff_sessions").get()).toEqual({ n: 0 });
  expect((await rpc(app, cookie, "listProducts", { actorToken: newLogin.token })).response.status).toBe(401);
  const login = await rpc(app, cookie, "loginStaff", { pin: "654321" });
  expect(login.data.ok).toBe(true);
  expect((await rpc(app, cookie, "listProducts", { actorToken: login.data.token })).data.products[0].currentStock).toBe(17);
  app.close(); opened.splice(opened.indexOf(app), 1);
  const reopened = fresh({ root });
  expect((await rpc(reopened, cookie, "listProducts", { actorToken: login.data.token })).data.products[0].currentStock).toBe(17);
  expect(source.sqlite.query("SELECT COUNT(*) AS n FROM products").get()).toEqual({ n: 1 });
});

test("expired remote sessions and password rotation invalidate access", async () => {
  let time = Date.now();
  const root = options().root, app = fresh({ root, now: () => time }), cookie = await gate(app);
  time += 31 * 24 * 60 * 60 * 1000;
  expect((await rpc(app, cookie, "loginStaff", { pin: "123456" })).response.status).toBe(401);
  app.close(); opened.splice(opened.indexOf(app), 1);
  const changed = fresh({ root, password: "a-different-remote-password-741852" });
  expect((await rpc(changed, cookie, "loginStaff", { pin: "123456" })).response.status).toBe(401);
});

test("an already admitted slow action finishes before import checks whether the warehouse is empty", async () => {
  const app = fresh(), cookie = await gate(app), initialDatabase = app.sqlite.serialize();
  let actionBody!: ReadableStreamDefaultController<Uint8Array>;
  const admitted = app.fetch(new Request(origin + "/actions", { method: "POST", headers: {
    Cookie: cookie, Origin: origin, "Content-Type": "application/json",
  }, body: new ReadableStream<Uint8Array>({ start(controller) { actionBody = controller; } }) }));
  let importBody!: ReadableStreamDefaultController<Uint8Array>;
  const imported = app.fetch(new Request(origin + "/cloud/import", { method: "POST", headers: {
    Cookie: cookie, Origin: origin, "Content-Type": "application/vnd.sqlite3",
  }, body: new ReadableStream<Uint8Array>({ start(controller) { importBody = controller; } }) }));
  // Let the importer reach its first awaited step while the old request body is pending.
  await Bun.sleep(10);
  actionBody.enqueue(new TextEncoder().encode(JSON.stringify({ action: "loginStaff", args: { pin: "123456" } }))); actionBody.close();
  expect((await (await admitted).json() as any).ok).toBe(true);
  importBody.enqueue(initialDatabase); importBody.close();
  expect((await imported).status).toBe(409);
  expect(app.sqlite.query("SELECT COUNT(*) AS n FROM staff").get()).toEqual({ n: 1 });
});
