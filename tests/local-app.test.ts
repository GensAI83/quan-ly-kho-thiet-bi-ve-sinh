import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLocalApp } from "../server/src/local-app";

const checksRoot = resolve(import.meta.dir, "../../checks");
const opened: ReturnType<typeof createLocalApp>[] = [];
function fresh(root = mkdtempSync(join(checksRoot, "native-test-"))) {
  const app = createLocalApp({ root, migrationsDir: resolve(import.meta.dir, "../drizzle"), publicDir: resolve(import.meta.dir, "../../public") });
  opened.push(app);
  return app;
}
afterEach(() => { while (opened.length) opened.pop()!.close(); });
async function rpc(app: ReturnType<typeof fresh>, action: string, args: Record<string, unknown> = {}) {
  const response = await app.fetch(new Request("http://127.0.0.1:17830/actions", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:17830" }, body: JSON.stringify({ action, args }),
  }));
  return { response, data: await response.json() as any };
}
async function owner(app: ReturnType<typeof fresh>) {
  const { data } = await rpc(app, "loginStaff", { pin: "123456" });
  expect(data.ok).toBe(true);
  return data.token as string;
}
async function product(app: ReturnType<typeof fresh>, token: string, initialStock = 10) {
  const { data } = await rpc(app, "createProduct", { actorToken: token, sku: "LOCAL-001", name: "Sản phẩm local", category: "Bồn cầu", unit: "cái", costPrice: 100000, sellPrice: 150000, initialStock });
  expect(data.ok).toBe(true);
  return data.id as number;
}
async function stock(app: ReturnType<typeof fresh>, token: string) {
  const { data } = await rpc(app, "listProducts", { actorToken: token });
  return data.products[0].currentStock as number;
}

describe("local application boundary", () => {
  test("migrates once and preserves a product after closing and reopening the database", async () => {
    const root = mkdtempSync(join(checksRoot, "persistence-"));
    const app = fresh(root), token = await owner(app);
    await product(app, token);
    app.close(); opened.splice(opened.indexOf(app), 1);
    const reopened = fresh(root);
    expect(await stock(reopened, token)).toBe(10);
  });

  test("records both unit prices while updating stock only once", async () => {
    const app = fresh(), token = await owner(app), id = await product(app, token);
    const { data } = await rpc(app, "createMovementBatch", { actorToken: token, type: "in", lines: [{ productId: id, quantity: 1, unitCost: 100000 }, { productId: id, quantity: 1, unitCost: 200000 }] });
    expect(data.ok).toBe(true);
    expect(await stock(app, token)).toBe(12);
    const dashboard = await rpc(app, "getDashboard", { actorToken: token });
    // Opening stock 10 × 100,000 + this receipt 300,000.
    expect(dashboard.data.todayInValue).toBe(1300000);
  });

  test("a failed voucher insert leaves neither changed stock nor an orphan voucher", async () => {
    const app = fresh(), token = await owner(app), id = await product(app, token);
    app.sqlite.exec("CREATE TRIGGER fail_out BEFORE INSERT ON movements WHEN NEW.type='out' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;");
    const { data } = await rpc(app, "createMovement", { actorToken: token, productId: id, type: "out", quantity: 2 });
    expect(data.ok).toBe(false);
    expect(await stock(app, token)).toBe(10);
    expect(app.sqlite.query("SELECT COUNT(*) AS n FROM movements WHERE type='out'").get()).toEqual({ n: 0 });
  });

  test("failed-login counters survive action failure and lock out a correct PIN after five attempts", async () => {
    const app = fresh(); await owner(app);
    for (let i = 0; i < 5; i++) await rpc(app, "loginStaff", { pin: "000000" });
    const { data } = await rpc(app, "loginStaff", { pin: "123456" });
    expect(data.ok).toBe(false);
    expect(data.error).toContain("khóa");
  });

  test("CSV partial success keeps valid rows even when another row is rejected", async () => {
    const app = fresh(), token = await owner(app);
    const csv = "sku,tên,danh mục,hãng,đơn vị,giá nhập,giá bán,tồn đầu,tồn tối thiểu,vị trí\nCSV-1,Sản phẩm CSV,Bồn cầu,,cái,100,150,2,1,A\nCSV-1,Trùng SKU,Bồn cầu,,cái,100,150,2,1,A";
    const { data } = await rpc(app, "importProductsCsv", { actorToken: token, csv });
    expect(data.ok).toBe(false);
    expect(data.imported).toBe(1);
    expect(data.errors).toHaveLength(1);
    expect(await stock(app, token)).toBe(2);
  });

  test("rejects unauthenticated reads, unknown actions, invalid quantities and cross-origin writes", async () => {
    const app = fresh();
    expect((await rpc(app, "listProducts")).response.status).toBe(401);
    expect((await rpc(app, "constructor")).response.status).toBe(404);
    expect((await rpc(app, "createMovement", { quantity: -1 })).response.status).toBe(400);
    const cross = await app.fetch(new Request("http://127.0.0.1:17830/actions", { method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json" }, body: JSON.stringify({ action: "loginStaff", args: { pin: "123456" } }) }));
    expect(cross.status).toBe(403);
  });

  test("only serves the UI and health, never the database or source tree", async () => {
    const app = fresh();
    expect((await app.fetch(new Request("http://127.0.0.1:17830/health"))).status).toBe(200);
    for (const path of ["/data/warehouse.sqlite", "/source/package.json", "/%2e%2e/data/warehouse.sqlite"])
      expect((await app.fetch(new Request("http://127.0.0.1:17830" + path))).status).toBe(404);
  });
});
