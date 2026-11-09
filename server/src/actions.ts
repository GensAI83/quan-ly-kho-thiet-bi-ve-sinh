import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { desc, eq, sql } from "drizzle-orm";
import * as schema from "./schema";

function genSku(category: string, idSeed: number) {
  const prefixMap: Record<string, string> = {
    "Bồn cầu": "BC",
    "Lavabo & Chậu rửa": "LV",
    "Vòi lavabo": "VL",
    "Sen tắm & Vòi sen": "ST",
    "Bồn tắm": "BT",
    "Xả & Phụ kiện bồn cầu": "PK",
    "Gương & Tủ lavabo": "GR",
    "Phụ kiện phòng tắm": "PK",
    "Bình nóng lạnh": "NL",
  };
  const prefix = prefixMap[category] ?? "SP";
  return `${prefix}-${String(idSeed).padStart(4, "0")}`;
}
function genOrderCode() {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `DH${ymd}-${rand}`;
}
function genRefCode(type: string) {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return type === "in" ? `PN${ymd}-${rand}` : type === "out" ? `PX${ymd}-${rand}` : `KK${ymd}-${rand}`;
}

const productShape = z.object({
  id: z.number(), sku: z.string(), name: z.string(), category: z.string(), brand: z.string(),
  unit: z.string(), costPrice: z.number(), sellPrice: z.number(), currentStock: z.number(),
  minStock: z.number(), location: z.string(), notes: z.string(),
  createdAt: z.string(), updatedAt: z.string(),
});
const movementShape = z.object({
  id: z.number(), productId: z.number(), productSku: z.string(), productName: z.string(),
  type: z.string(), quantity: z.number(), beforeStock: z.number(), afterStock: z.number(),
  unitCost: z.number(), reason: z.string(), refCode: z.string(), partner: z.string(), note: z.string(), createdAt: z.string(),
});
const supplierShape = z.object({
  id: z.number(), name: z.string(), contactPerson: z.string(), phone: z.string(), email: z.string(), address: z.string(), notes: z.string(), createdAt: z.string(),
});
const orderItemShape = z.object({
  id: z.number(), orderId: z.number(), productId: z.number(), productSku: z.string(), productName: z.string(), quantity: z.number(), unitPrice: z.number(), lineTotal: z.number(),
});
const orderShape = z.object({
  id: z.number(), orderCode: z.string(), customerName: z.string(), customerPhone: z.string(), customerAddress: z.string(),
  status: z.string(), totalAmount: z.number(), note: z.string(), stockDeducted: z.number(), createdAt: z.string(), updatedAt: z.string(),
  items: z.array(orderItemShape),
});

function toProduct(r: typeof schema.products.$inferSelect) {
  return { id: r.id, sku: r.sku, name: r.name, category: r.category, brand: r.brand, unit: r.unit, costPrice: r.costPrice, sellPrice: r.sellPrice, currentStock: r.currentStock, minStock: r.minStock, location: r.location, notes: r.notes, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}
function toMovement(r: typeof schema.movements.$inferSelect) {
  return { id: r.id, productId: r.productId, productSku: r.productSku, productName: r.productName, type: r.type, quantity: r.quantity, beforeStock: r.beforeStock, afterStock: r.afterStock, unitCost: r.unitCost, reason: r.reason, refCode: r.refCode, partner: r.partner, note: r.note, createdAt: r.createdAt.toISOString() };
}
function toSupplier(r: typeof schema.suppliers.$inferSelect) {
  return { id: r.id, name: r.name, contactPerson: r.contactPerson, phone: r.phone, email: r.email, address: r.address, notes: r.notes, createdAt: r.createdAt.toISOString() };
}

export const Actions = {
  getDashboard: defineAction({
    description: "Lấy tổng quan kho: giá trị tồn, số SKU, cảnh báo sắp hết, nhập/xuất hôm nay, đơn chờ xử lý.",
    request: z.object({}),
    response: z.object({
      totalSkus: z.number(), totalUnits: z.number(), inventoryValueCost: z.number(), inventoryValueSell: z.number(),
      lowStockCount: z.number(), outOfStockCount: z.number(),
      todayInQty: z.number(), todayOutQty: z.number(), todayInValue: z.number(), todayOutValue: z.number(),
      pendingOrders: z.number(), totalOrders: z.number(),
      lowStockProducts: z.array(productShape),
      recentMovements: z.array(movementShape),
      chart7Days: z.array(z.object({ date: z.string(), label: z.string(), inQty: z.number(), outQty: z.number() })),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const products = await db.select().from(schema.products);
      const movements = await db.select().from(schema.movements).orderBy(desc(schema.movements.id));
      const orders = await db.select().from(schema.orders);
      const totalSkus = products.length;
      const totalUnits = products.reduce((s, p) => s + p.currentStock, 0);
      const inventoryValueCost = products.reduce((s, p) => s + p.currentStock * p.costPrice, 0);
      const inventoryValueSell = products.reduce((s, p) => s + p.currentStock * p.sellPrice, 0);
      const lowStockProducts = products.filter(p => p.currentStock > 0 && p.currentStock <= p.minStock).sort((a, b) => a.currentStock - b.currentStock).map(toProduct);
      const outOfStockCount = products.filter(p => p.currentStock === 0).length;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayMovs = movements.filter(m => m.createdAt >= today);
      const todayInQty = todayMovs.filter(m => m.type === "in").reduce((s, m) => s + m.quantity, 0);
      const todayOutQty = todayMovs.filter(m => m.type === "out").reduce((s, m) => s + m.quantity, 0);
      const todayInValue = todayMovs.filter(m => m.type === "in").reduce((s, m) => s + m.quantity * m.unitCost, 0);
      const todayOutValue = todayMovs.filter(m => m.type === "out").reduce((s, m) => s + m.quantity * m.unitCost, 0);
      // chart 7 days
      const chart7Days: { date: string; label: string; inQty: number; outQty: number }[] = [];
      const allMovs = movements;
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
        const next = new Date(d); next.setDate(next.getDate() + 1);
        const dayMovs = allMovs.filter(m => m.createdAt >= d && m.createdAt < next);
        chart7Days.push({
          date: d.toISOString(),
          label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
          inQty: dayMovs.filter(m => m.type === "in").reduce((s, m) => s + m.quantity, 0),
          outQty: dayMovs.filter(m => m.type === "out").reduce((s, m) => s + m.quantity, 0),
        });
      }
      return {
        totalSkus, totalUnits, inventoryValueCost, inventoryValueSell,
        lowStockCount: lowStockProducts.length, outOfStockCount,
        todayInQty, todayOutQty, todayInValue, todayOutValue,
        pendingOrders: orders.filter(o => o.status === "pending" || o.status === "confirmed").length,
        totalOrders: orders.length,
        lowStockProducts: [...lowStockProducts, ...products.filter(p => p.currentStock === 0).map(toProduct)].slice(0, 10),
        recentMovements: movements.slice(0, 8).map(toMovement),
        chart7Days,
      };
    },
  }),

  listProducts: defineAction({
    description: "Danh sách sản phẩm tồn kho, có tìm kiếm và lọc theo danh mục / trạng thái tồn.",
    request: z.object({
      search: z.string().default(""),
      category: z.string().default(""),
      stockFilter: z.enum(["all", "in_stock", "low", "out"]).default("all"),
    }),
    response: z.object({ products: z.array(productShape), categories: z.array(z.string()) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let rows = await db.select().from(schema.products).orderBy(desc(schema.products.updatedAt));
      if (args.search.trim()) {
        const q = args.search.trim().toLowerCase();
        rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || r.brand.toLowerCase().includes(q));
      }
      if (args.category) rows = rows.filter(r => r.category === args.category);
      if (args.stockFilter === "in_stock") rows = rows.filter(r => r.currentStock > r.minStock);
      if (args.stockFilter === "low") rows = rows.filter(r => r.currentStock > 0 && r.currentStock <= r.minStock);
      if (args.stockFilter === "out") rows = rows.filter(r => r.currentStock === 0);
      const cats = await db.select().from(schema.categories).orderBy(schema.categories.name);
      return { products: rows.map(toProduct), categories: cats.map(c => c.name) };
    },
  }),

  createProduct: defineAction({
    description: "Tạo sản phẩm mới với mã SKU tự sinh nếu để trống, kèm tồn đầu kỳ.",
    request: z.object({
      sku: z.string().default(""), name: z.string().min(1), category: z.string().min(1), brand: z.string().default(""),
      unit: z.string().default("cái"), costPrice: z.number().int().min(0).default(0), sellPrice: z.number().int().min(0).default(0),
      initialStock: z.number().int().min(0).default(0), minStock: z.number().int().min(0).default(5),
      location: z.string().default(""), notes: z.string().default(""),
    }),
    response: z.object({ ok: z.boolean(), id: z.number(), sku: z.string(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      // ensure category exists
      const existingCat = await db.select().from(schema.categories).where(eq(schema.categories.name, args.category));
      if (existingCat.length === 0) {
        await db.insert(schema.categories).values({ name: args.category });
      }
      let sku = args.sku.trim().toUpperCase();
      if (sku) {
        const dup = await db.select().from(schema.products).where(eq(schema.products.sku, sku));
        if (dup.length > 0) return { ok: false, id: 0, sku, error: `Mã SKU "${sku}" đã tồn tại. Hãy dùng mã khác hoặc để trống để tự sinh.` };
      } else {
        const countRows = await db.select({ c: sql<number>`count(*)` }).from(schema.products);
        const seed = (countRows[0]?.c ?? 0) + 1 + Math.floor(Math.random() * 90);
        sku = genSku(args.category, seed * 7 + Date.now() % 1000);
        // ensure unique
        const dup2 = await db.select().from(schema.products).where(eq(schema.products.sku, sku));
        if (dup2.length > 0) sku = `${sku}-${Math.floor(Math.random() * 99)}`;
      }
      const inserted = await db.insert(schema.products).values({
        sku, name: args.name.trim(), category: args.category, brand: args.brand.trim(), unit: args.unit,
        costPrice: args.costPrice, sellPrice: args.sellPrice, currentStock: args.initialStock, minStock: args.minStock,
        location: args.location.trim(), notes: args.notes.trim(),
      }).returning({ id: schema.products.id });
      const row = inserted[0];
      if (!row) return { ok: false, id: 0, sku, error: "Không tạo được sản phẩm." };
      if (args.initialStock > 0) {
        await db.insert(schema.movements).values({
          productId: row.id, productSku: sku, productName: args.name.trim(), type: "in", quantity: args.initialStock,
          beforeStock: 0, afterStock: args.initialStock, unitCost: args.costPrice, reason: "Tồn đầu kỳ", refCode: genRefCode("in"), partner: "", note: "Nhập tồn khi tạo sản phẩm",
        });
      }
      ctx.invalidateQueries();
      return { ok: true, id: row.id, sku, error: null };
    },
  }),

  updateProduct: defineAction({
    description: "Cập nhật thông tin sản phẩm (không sửa trực tiếp tồn — dùng phiếu nhập/xuất/kiểm kê).",
    request: z.object({
      id: z.number(), name: z.string().min(1), category: z.string().min(1), brand: z.string().default(""),
      unit: z.string().default("cái"), costPrice: z.number().int().min(0), sellPrice: z.number().int().min(0),
      minStock: z.number().int().min(0), location: z.string().default(""), notes: z.string().default(""),
    }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existingCat = await db.select().from(schema.categories).where(eq(schema.categories.name, args.category));
      if (existingCat.length === 0) await db.insert(schema.categories).values({ name: args.category });
      await db.update(schema.products).set({
        name: args.name.trim(), category: args.category, brand: args.brand.trim(), unit: args.unit,
        costPrice: args.costPrice, sellPrice: args.sellPrice, minStock: args.minStock, location: args.location.trim(), notes: args.notes.trim(), updatedAt: new Date(),
      }).where(eq(schema.products.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteProduct: defineAction({
    description: "Xoá sản phẩm khỏi danh mục (lịch sử phiếu vẫn giữ snapshot tên/mã).",
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.products).where(eq(schema.products.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listMovements: defineAction({
    description: "Lịch sử nhập/xuất/kiểm kê, lọc theo loại phiếu, sản phẩm và từ khoá.",
    request: z.object({ type: z.enum(["all", "in", "out", "adjust"]).default("all"), search: z.string().default(""), limit: z.number().int().positive().max(500).default(200) }),
    response: z.object({ movements: z.array(movementShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let rows = await db.select().from(schema.movements).orderBy(desc(schema.movements.id));
      if (args.type !== "all") rows = rows.filter(r => r.type === args.type);
      if (args.search.trim()) {
        const q = args.search.trim().toLowerCase();
        rows = rows.filter(r => r.productName.toLowerCase().includes(q) || r.productSku.toLowerCase().includes(q) || r.refCode.toLowerCase().includes(q) || r.partner.toLowerCase().includes(q));
      }
      rows = rows.slice(0, args.limit);
      return { movements: rows.map(toMovement) };
    },
  }),

  createMovement: defineAction({
    description: "Tạo phiếu nhập, xuất hoặc kiểm kê và cập nhật tồn kho tương ứng.",
    request: z.object({
      productId: z.number(), type: z.enum(["in", "out", "adjust"]), quantity: z.number().int().min(0),
      unitCost: z.number().int().min(0).default(0), reason: z.string().default(""), partner: z.string().default(""), note: z.string().default(""),
    }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable(), newStock: z.number(), refCode: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const prodRows = await db.select().from(schema.products).where(eq(schema.products.id, args.productId));
      const prod = prodRows[0];
      if (!prod) return { ok: false, error: "Sản phẩm không tồn tại.", newStock: 0, refCode: "" };
      const before = prod.currentStock;
      let after = before;
      let qtyRecord = args.quantity;
      if (args.type === "in") {
        if (args.quantity <= 0) return { ok: false, error: "Số lượng nhập phải lớn hơn 0.", newStock: before, refCode: "" };
        after = before + args.quantity;
      } else if (args.type === "out") {
        if (args.quantity <= 0) return { ok: false, error: "Số lượng xuất phải lớn hơn 0.", newStock: before, refCode: "" };
        if (args.quantity > before) return { ok: false, error: `Không đủ tồn: chỉ còn ${before} ${prod.unit} (cần xuất ${args.quantity}).`, newStock: before, refCode: "" };
        after = before - args.quantity;
      } else {
        // adjust: quantity is the counted actual stock
        after = args.quantity;
        qtyRecord = Math.abs(after - before);
      }
      const refCode = genRefCode(args.type);
      const unitCost = args.unitCost > 0 ? args.unitCost : (args.type === "in" ? prod.costPrice : prod.sellPrice);
      await db.update(schema.products).set({ currentStock: after, updatedAt: new Date() }).where(eq(schema.products.id, prod.id));
      await db.insert(schema.movements).values({
        productId: prod.id, productSku: prod.sku, productName: prod.name, type: args.type, quantity: qtyRecord,
        beforeStock: before, afterStock: after, unitCost, reason: args.reason, refCode, partner: args.partner.trim(), note: args.note.trim(),
      });
      ctx.invalidateQueries();
      return { ok: true, error: null, newStock: after, refCode };
    },
  }),

  deleteMovement: defineAction({
    description: "Xoá một phiếu và hoàn lại tồn kho về trước phiếu đó (chỉ khi phiếu là phiếu gần nhất của sản phẩm).",
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.movements).where(eq(schema.movements.id, args.id));
      const mov = rows[0];
      if (!mov) return { ok: false, error: "Không tìm thấy phiếu." };
      // Chỉ được xoá phiếu gần nhất của sản phẩm đó — xoá phiếu cũ sẽ làm lệch chuỗi tồn trước/sau.
      const latestRows = await db.select().from(schema.movements).where(eq(schema.movements.productId, mov.productId)).orderBy(desc(schema.movements.id)).limit(1);
      const latest = latestRows[0];
      if (latest && latest.id !== mov.id) {
        return { ok: false, error: "Chỉ được xoá phiếu gần nhất của sản phẩm này. Hãy xoá các phiếu mới hơn trước, nếu cần." };
      }
      // Phiếu gắn với đơn hàng được quản lý theo vòng đời đơn: xoá riêng sẽ lệch cờ đã trừ kho của đơn và sinh hàng ảo khi huỷ đơn.
      if (mov.refCode) {
        const linkedOrders = await db.select().from(schema.orders).where(eq(schema.orders.orderCode, mov.refCode));
        if (linkedOrders.length > 0 && (mov.reason === "Xuất theo đơn hàng" || mov.reason === "Hoàn kho do huỷ đơn")) {
          return { ok: false, error: `Phiếu này gắn với đơn ${mov.refCode} — không xoá riêng được. Hãy huỷ đơn để hệ thống hoàn kho đồng bộ.` };
        }
      }
      const prodRows = await db.select().from(schema.products).where(eq(schema.products.id, mov.productId));
      const prod = prodRows[0];
      if (prod) {
        // revert: set stock back to beforeStock only if current matches afterStock, else adjust by delta
        const delta = mov.afterStock - mov.beforeStock;
        const newStock = Math.max(0, prod.currentStock - delta);
        await db.update(schema.products).set({ currentStock: newStock, updatedAt: new Date() }).where(eq(schema.products.id, prod.id));
      }
      await db.delete(schema.movements).where(eq(schema.movements.id, args.id));
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  listSuppliers: defineAction({
    description: "Danh sách nhà cung cấp / đối tác.",
    request: z.object({ search: z.string().default("") }),
    response: z.object({ suppliers: z.array(supplierShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let rows = await db.select().from(schema.suppliers).orderBy(desc(schema.suppliers.id));
      if (args.search.trim()) {
        const q = args.search.trim().toLowerCase();
        rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.phone.includes(q));
      }
      return { suppliers: rows.map(toSupplier) };
    },
  }),

  createSupplier: defineAction({
    description: "Thêm nhà cung cấp mới.",
    request: z.object({ name: z.string().min(1), contactPerson: z.string().default(""), phone: z.string().default(""), email: z.string().default(""), address: z.string().default(""), notes: z.string().default("") }),
    response: z.object({ ok: z.boolean(), id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const res = await db.insert(schema.suppliers).values({ name: args.name.trim(), contactPerson: args.contactPerson.trim(), phone: args.phone.trim(), email: args.email.trim(), address: args.address.trim(), notes: args.notes.trim() }).returning({ id: schema.suppliers.id });
      ctx.invalidateQueries();
      return { ok: true, id: res[0]?.id ?? 0 };
    },
  }),

  updateSupplier: defineAction({
    description: "Cập nhật nhà cung cấp.",
    request: z.object({ id: z.number(), name: z.string().min(1), contactPerson: z.string().default(""), phone: z.string().default(""), email: z.string().default(""), address: z.string().default(""), notes: z.string().default("") }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.update(schema.suppliers).set({ name: args.name.trim(), contactPerson: args.contactPerson.trim(), phone: args.phone.trim(), email: args.email.trim(), address: args.address.trim(), notes: args.notes.trim() }).where(eq(schema.suppliers.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteSupplier: defineAction({
    description: "Xoá nhà cung cấp.",
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.suppliers).where(eq(schema.suppliers.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listCategories: defineAction({
    description: "Danh sách danh mục sản phẩm.",
    request: z.object({}),
    response: z.object({ categories: z.array(z.object({ id: z.number(), name: z.string(), productCount: z.number() })) }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const cats = await db.select().from(schema.categories).orderBy(schema.categories.name);
      const prods = await db.select().from(schema.products);
      return { categories: cats.map(c => ({ id: c.id, name: c.name, productCount: prods.filter(p => p.category === c.name).length })) };
    },
  }),

  createCategory: defineAction({
    description: "Thêm danh mục sản phẩm mới.",
    request: z.object({ name: z.string().min(1) }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const dup = await db.select().from(schema.categories).where(eq(schema.categories.name, args.name.trim()));
      if (dup.length > 0) return { ok: false, error: "Danh mục đã tồn tại." };
      await db.insert(schema.categories).values({ name: args.name.trim() });
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  deleteCategory: defineAction({
    description: "Xoá danh mục (sản phẩm thuộc danh mục sẽ chuyển về 'Khác').",
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const catRows = await db.select().from(schema.categories).where(eq(schema.categories.id, args.id));
      const cat = catRows[0];
      if (cat) {
        await db.update(schema.products).set({ category: "Khác" }).where(eq(schema.products.category, cat.name));
        await db.delete(schema.categories).where(eq(schema.categories.id, args.id));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listOrders: defineAction({
    description: "Danh sách đơn hàng kèm dòng hàng, lọc theo trạng thái và tìm kiếm.",
    request: z.object({ status: z.string().default("all"), search: z.string().default("") }),
    response: z.object({ orders: z.array(orderShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let rows = await db.select().from(schema.orders).orderBy(desc(schema.orders.id));
      if (args.status !== "all") rows = rows.filter(r => r.status === args.status);
      if (args.search.trim()) {
        const q = args.search.trim().toLowerCase();
        rows = rows.filter(r => r.customerName.toLowerCase().includes(q) || r.orderCode.toLowerCase().includes(q) || r.customerPhone.includes(q));
      }
      const allItems = await db.select().from(schema.orderItems);
      const orders = rows.map(o => ({
        id: o.id, orderCode: o.orderCode, customerName: o.customerName, customerPhone: o.customerPhone, customerAddress: o.customerAddress,
        status: o.status, totalAmount: o.totalAmount, note: o.note, stockDeducted: o.stockDeducted, createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(),
        items: allItems.filter(i => i.orderId === o.id).map(i => ({ id: i.id, orderId: i.orderId, productId: i.productId, productSku: i.productSku, productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
      }));
      return { orders };
    },
  }),

  createOrder: defineAction({
    description: "Tạo đơn hàng mới. Khi xác nhận (confirmed trở đi) sẽ tự trừ kho và ghi phiếu xuất.",
    request: z.object({
      customerName: z.string().min(1), customerPhone: z.string().default(""), customerAddress: z.string().default(""),
      status: z.enum(["pending", "confirmed", "delivering", "completed"]).default("pending"),
      note: z.string().default(""),
      items: z.array(z.object({ productId: z.number(), quantity: z.number().int().positive(), unitPrice: z.number().int().min(0) })).min(1),
    }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable(), orderCode: z.string(), id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const shouldDeduct = args.status === "confirmed" || args.status === "delivering" || args.status === "completed";
      // validate stock if deducting — cộng dồn các dòng cùng sản phẩm trước khi so với tồn
      const prodMap = new Map<number, typeof schema.products.$inferSelect>();
      const qtyByProduct = new Map<number, number>();
      for (const it of args.items) qtyByProduct.set(it.productId, (qtyByProduct.get(it.productId) ?? 0) + it.quantity);
      for (const it of args.items) {
        const pr = await db.select().from(schema.products).where(eq(schema.products.id, it.productId));
        const p = pr[0];
        if (!p) return { ok: false, error: "Có sản phẩm không tồn tại trong kho.", orderCode: "", id: 0 };
        prodMap.set(it.productId, p);
      }
      if (shouldDeduct) {
        for (const [pid, totalQty] of qtyByProduct) {
          const p = prodMap.get(pid)!;
          if (totalQty > p.currentStock) {
            return { ok: false, error: `"${p.name}" (${p.sku}) chỉ còn ${p.currentStock} ${p.unit}, không đủ cho đơn ${totalQty} (đã cộng dồn các dòng cùng sản phẩm).`, orderCode: "", id: 0 };
          }
        }
      }
      const orderCode = genOrderCode();
      const totalAmount = args.items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
      const inserted = await db.insert(schema.orders).values({
        orderCode, customerName: args.customerName.trim(), customerPhone: args.customerPhone.trim(), customerAddress: args.customerAddress.trim(),
        status: args.status, totalAmount, note: args.note.trim(), stockDeducted: shouldDeduct ? 1 : 0,
      }).returning({ id: schema.orders.id });
      const orderRow = inserted[0];
      if (!orderRow) return { ok: false, error: "Không tạo được đơn.", orderCode: "", id: 0 };
      for (const it of args.items) {
        const p = prodMap.get(it.productId)!;
        await db.insert(schema.orderItems).values({
          orderId: orderRow.id, productId: it.productId, productSku: p.sku, productName: p.name, quantity: it.quantity, unitPrice: it.unitPrice, lineTotal: it.quantity * it.unitPrice,
        });
        if (shouldDeduct) {
          const before = p.currentStock;
          const after = before - it.quantity;
          await db.update(schema.products).set({ currentStock: after, updatedAt: new Date() }).where(eq(schema.products.id, p.id));
          // update cached stock for subsequent items of same product
          p.currentStock = after;
          await db.insert(schema.movements).values({
            productId: p.id, productSku: p.sku, productName: p.name, type: "out", quantity: it.quantity, beforeStock: before, afterStock: after,
            unitCost: it.unitPrice, reason: "Xuất theo đơn hàng", refCode: orderCode, partner: args.customerName.trim(), note: `Đơn ${orderCode}`,
          });
        }
      }
      ctx.invalidateQueries();
      return { ok: true, error: null, orderCode, id: orderRow.id };
    },
  }),

  updateOrderStatus: defineAction({
    description: "Đổi trạng thái đơn hàng; tự trừ kho khi xác nhận và hoàn kho khi huỷ đơn đã trừ.",
    request: z.object({ id: z.number(), status: z.enum(["pending", "confirmed", "delivering", "completed", "cancelled"]) }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.orders).where(eq(schema.orders.id, args.id));
      const order = rows[0];
      if (!order) return { ok: false, error: "Không tìm thấy đơn hàng." };
      const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));
      const wasDeducted = order.stockDeducted === 1;
      const shouldDeduct = args.status === "confirmed" || args.status === "delivering" || args.status === "completed";
      if (!wasDeducted && shouldDeduct) {
        // Cộng dồn dòng cùng sản phẩm + chặn khi sản phẩm đã bị xoá: không được đánh dấu đã trừ kho khi không có phiếu xuất tương ứng.
        const qtyByProduct = new Map<number, number>();
        for (const it of items) qtyByProduct.set(it.productId, (qtyByProduct.get(it.productId) ?? 0) + it.quantity);
        const prodById = new Map<number, typeof schema.products.$inferSelect>();
        for (const it of items) {
          if (prodById.has(it.productId)) continue;
          const pr = await db.select().from(schema.products).where(eq(schema.products.id, it.productId));
          const p = pr[0];
          if (!p) {
            return { ok: false, error: `Sản phẩm "${it.productName}" (${it.productSku}) trong đơn đã bị xoá khỏi kho — không thể xác nhận đơn. Hãy huỷ đơn này và tạo đơn mới, hoặc thêm lại sản phẩm.` };
          }
          prodById.set(it.productId, p);
        }
        for (const [pid, totalQty] of qtyByProduct) {
          const p = prodById.get(pid)!;
          if (totalQty > p.currentStock) return { ok: false, error: `"${p.name}" chỉ còn ${p.currentStock}, không đủ để xác nhận đơn (cần ${totalQty} sau khi cộng dồn các dòng cùng sản phẩm).` };
        }
        for (const it of items) {
          const p = prodById.get(it.productId)!;
          const before = p.currentStock; const after = before - it.quantity;
          await db.update(schema.products).set({ currentStock: after, updatedAt: new Date() }).where(eq(schema.products.id, p.id));
          p.currentStock = after;
          await db.insert(schema.movements).values({ productId: p.id, productSku: p.sku, productName: p.name, type: "out", quantity: it.quantity, beforeStock: before, afterStock: after, unitCost: it.unitPrice, reason: "Xuất theo đơn hàng", refCode: order.orderCode, partner: order.customerName, note: `Đơn ${order.orderCode}` });
        }
        await db.update(schema.orders).set({ status: args.status, stockDeducted: 1, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
      } else if (wasDeducted && args.status === "cancelled") {
        for (const it of items) {
          const pr = await db.select().from(schema.products).where(eq(schema.products.id, it.productId));
          const p = pr[0];
          if (!p) continue;
          const before = p.currentStock; const after = before + it.quantity;
          await db.update(schema.products).set({ currentStock: after, updatedAt: new Date() }).where(eq(schema.products.id, p.id));
          await db.insert(schema.movements).values({ productId: p.id, productSku: p.sku, productName: p.name, type: "in", quantity: it.quantity, beforeStock: before, afterStock: after, unitCost: it.unitPrice, reason: "Hoàn kho do huỷ đơn", refCode: order.orderCode, partner: order.customerName, note: `Huỷ đơn ${order.orderCode}` });
        }
        await db.update(schema.orders).set({ status: "cancelled", stockDeducted: 0, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
      } else {
        await db.update(schema.orders).set({ status: args.status, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
      }
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

} satisfies ActionsModule;
