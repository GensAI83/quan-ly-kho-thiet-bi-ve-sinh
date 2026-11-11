import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLocalApp } from "../server/src/local-app";

const source = resolve(import.meta.dir, ".."), root = resolve(source, "..");
const folder = mkdtempSync(join(root, "checks", "cloud-smoke-"));
for (const dir of ["downloads", "temp"]) mkdirSync(join(folder, dir));
const certFile = join(folder, "test-cert.pem"), keyFile = join(folder, "test-key.pem");
const certCommand = Bun.spawnSync(["C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { env: process.env, stdout: "pipe", stderr: "pipe" });
assert.equal(certCommand.exitCode, 0, new TextDecoder().decode(certCommand.stderr));
const cert = readFileSync(certFile, "utf8"), key = readFileSync(keyFile, "utf8");
const localRoot = join(folder, "local-fixture");
const local = createLocalApp({ root: localRoot, migrationsDir: join(source, "drizzle"), publicDir: join(root, "public") });
async function localRpc(action: string, args: Record<string, unknown>) {
  const r = await local.fetch(new Request("http://127.0.0.1:17830/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, args }) }));
  return await r.json() as any;
}
const initial = await localRpc("loginStaff", { pin: "123456" });
assert.ok((await localRpc("changePin", { token: initial.token, oldPin: "123456", newPin: "654321" })).ok);
const staff = await localRpc("loginStaff", { pin: "654321" });
assert.ok((await localRpc("createProduct", { actorToken: staff.token, sku: "MIGRATED-17", name: "Thiết bị chuyển lên online", category: "Bồn cầu", initialStock: 17 })).ok);
local.close();

const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reserved") });
const backendPort = reservation.port!; await reservation.stop(true);
const backend = `http://127.0.0.1:${backendPort}`;
let url = "";
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, tls: { cert, key }, async fetch(request) {
  const path = new URL(request.url), headers = new Headers(request.headers);
  appendFileSync(join(folder, "proxy-requests.jsonl"), JSON.stringify({ method: request.method, path: path.pathname, origin: headers.get("Origin"), host: headers.get("Host") }) + "\n");
  headers.set("Host", new URL(url).host); headers.delete("connection");
  return fetch(backend + path.pathname + path.search, { method: request.method, headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(), redirect: "manual" });
} });
url = `https://127.0.0.1:${proxy.port}`;
const password = "cloud-smoke-only-password-741852";
const environment = { ...process.env, KHO_DATA_DIR: join(folder, "online-data"), KHO_PUBLIC_URL: url, KHO_ACCESS_PASSWORD: password,
  KHO_SESSION_SECRET: "cloud-smoke-only-signing-secret-0123456789abcdef", PORT: String(backendPort), NODE_EXTRA_CA_CERTS: certFile };
let child: ReturnType<typeof Bun.spawn> | undefined;
async function start() {
  child = Bun.spawn([process.execPath, join(source, "dist", "cloud", "server.js")], { cwd: folder, env: environment,
    stdout: Bun.file(join(folder, "server-stdout.log")), stderr: Bun.file(join(folder, "server-stderr.log")) });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("Cloud server exited: " + readFileSync(join(folder, "server-stderr.log"), "utf8"));
    try { if ((await fetch(backend + "/health")).ok) return; } catch {}
    await Bun.sleep(100);
  }
  throw new Error("Cloud server did not become ready.");
}
async function stop() { if (child && child.exitCode === null) { child.kill(); await child.exited; } }
const https = (path: string, init: RequestInit = {}) => fetch(url + path, { ...init, tls: { ca: cert } });
try {
  await start();
  assert.deepEqual(await (await https("/health")).json(), { app: "quan-ly-kho-online", ok: true });
  const transfer = Bun.spawn([process.execPath, join(source, "scripts", "transfer-cloud-data.ts")], { cwd: source, env: environment, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  transfer.stdin.write(JSON.stringify({ sourceDatabase: join(localRoot, "data", "warehouse.sqlite"), origin: url, password })); transfer.stdin.end();
  const transferCode = await transfer.exited;
  assert.equal(transferCode, 0, await new Response(transfer.stderr).text());
  const browser = Bun.spawn(["node.exe", "--experimental-strip-types", join(source, "scripts", "cloud-browser-smoke.ts")], { cwd: source, env: environment, stdin: "pipe", stdout: "inherit", stderr: "inherit" });
  browser.stdin.write(JSON.stringify({ url, password, folder })); browser.stdin.end();
  assert.equal(await browser.exited, 0, "Phone browser check failed; evidence under " + folder);
  const login = await https("/cloud/login", { method: "POST", redirect: "manual", headers: { Origin: url, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password }) });
  const cookie = login.headers.getSetCookie().find(s => s.startsWith("__Host-kho_remote="))!.split(";")[0]!;
  const rpc = async (action: string, args: Record<string, unknown>) => {
    const r = await https("/actions", { method: "POST", headers: { Origin: url, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action, args }) });
    return await r.json() as any;
  };
  const loggedIn = await rpc("loginStaff", { pin: "654321" }); assert.ok(loggedIn.ok);
  await stop(); await start();
  const products = await rpc("listProducts", { actorToken: loggedIn.token });
  assert.equal(products.products.find((p: any) => p.sku === "MIGRATED-17").currentStock, 17);
  assert.equal(products.products.find((p: any) => p.sku === "PHONE-003").currentStock, 3);
  const phone = JSON.parse(readFileSync(join(folder, "phone-result.json"), "utf8"));
  const result = { ok: true, folder, checks: ["built cloud server", "real HTTPS reverse proxy", "actual transfer CLI", "old PIN retained", "phone browser writes", "restart persistence"], phone,
    limitations: ["Local TLS/browser simulation; a real hosting deployment and 4G device test are pending hosting account.", "Docker image execution is pending an available Docker/hosting runtime."] };
  writeFileSync(join(root, "checks", "cloud-smoke.json"), JSON.stringify(result, null, 2));
  console.log("Cloud HTTPS, migration, phone browser and restart checks passed.", folder);
} finally { await stop(); await proxy.stop(true); }
