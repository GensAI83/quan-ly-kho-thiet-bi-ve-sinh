import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ApiResponse } from "./api";

type Product = ApiResponse<typeof api, "listProducts">["products"][number];
type Movement = ApiResponse<typeof api, "listMovements">["movements"][number];
type Supplier = ApiResponse<typeof api, "listSuppliers">["suppliers"][number];
type Tab = "dashboard" | "products" | "movements" | "orders" | "partners";

const fmtVND = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + " ₫";
const fmtNum = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};


function stockBadge(p: Product) {
  if (p.currentStock === 0) return { label: "Hết hàng", cls: "bg-[var(--red-soft)] text-[var(--red)]" };
  if (p.currentStock <= p.minStock) return { label: "Sắp hết", cls: "bg-[var(--amber-soft)] text-[var(--amber)]" };
  return { label: "Còn hàng", cls: "bg-[var(--green-soft)] text-[var(--green)]" };
}
const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Chờ xử lý", cls: "bg-[var(--amber-soft)] text-[var(--amber)]" },
  confirmed: { label: "Đã xác nhận · Đã trừ kho", cls: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  delivering: { label: "Đang giao", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  completed: { label: "Hoàn thành", cls: "bg-[var(--green-soft)] text-[var(--green)]" },
  cancelled: { label: "Đã huỷ", cls: "bg-[var(--red-soft)] text-[var(--red)]" },
};
const MOVE_META: Record<string, { label: string; sign: string; cls: string }> = {
  in: { label: "Nhập kho", sign: "+", cls: "text-[var(--green)]" },
  out: { label: "Xuất kho", sign: "−", cls: "text-[var(--red)]" },
  adjust: { label: "Kiểm kê", sign: "±", cls: "text-[var(--amber)]" },
};
const UNITS = ["cái", "bộ", "chiếc", "thùng", "hộp", "mét", "kg"];
const IN_REASONS = ["Nhập từ nhà cung cấp", "Hoàn trả từ khách", "Tồn đầu kỳ", "Điều chuyển vào", "Khác"];
const OUT_REASONS = ["Xuất bán", "Xuất thi công / công trình", "Hư hỏng / Vỡ", "Điều chuyển ra", "Khác"];

const inputCls = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)] placeholder:text-[var(--dim)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";
const labelCls = "block text-[13px] font-semibold text-[var(--dim)] mb-1.5";
const btnPrimary = "rounded-xl bg-[var(--accent)] text-white font-semibold px-4 py-2.5 active:opacity-80 disabled:opacity-50";
const btnGhost = "rounded-xl border border-[var(--border)] bg-[var(--surface)] font-semibold px-4 py-2.5 active:opacity-70";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" role="dialog" aria-label={title}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[var(--bg)] shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between bg-[var(--bg)] px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-bold">{title}</h2>
          <button aria-label="Đóng" onClick={onClose} className="w-9 h-9 rounded-full bg-[var(--surface2)] text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Product Form ---------------- */
function ProductForm({ product, categories, onClose }: { product: Product | null; categories: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? categories[0] ?? "Bồn cầu");
  const [customCat, setCustomCat] = useState("");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "cái");
  const [costPrice, setCostPrice] = useState(product ? String(product.costPrice) : "");
  const [sellPrice, setSellPrice] = useState(product ? String(product.sellPrice) : "");
  const [initialStock, setInitialStock] = useState("0");
  const [minStock, setMinStock] = useState(product ? String(product.minStock) : "5");
  const [location, setLocation] = useState(product?.location ?? "");
  const [notes, setNotes] = useState(product?.notes ?? "");
  const [error, setError] = useState("");

  const createMut = useMutation({
    mutationFn: () => api.createProduct({
      sku, name, category: category === "__custom" ? customCat.trim() : category, brand, unit,
      costPrice: Number(costPrice) || 0, sellPrice: Number(sellPrice) || 0,
      initialStock: Number(initialStock) || 0, minStock: Number(minStock) || 0, location, notes,
    }),
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Có lỗi xảy ra"); return; }
      qc.invalidateQueries(); onClose();
    },
    onError: (e) => setError(String(e)),
  });
  const updateMut = useMutation({
    mutationFn: () => api.updateProduct({
      id: product!.id, name, category: category === "__custom" ? customCat.trim() : category, brand, unit,
      costPrice: Number(costPrice) || 0, sellPrice: Number(sellPrice) || 0, minStock: Number(minStock) || 0, location, notes,
    }),
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
    onError: (e) => setError(String(e)),
  });
  const busy = createMut.isPending || updateMut.isPending;
  function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!name.trim()) { setError("Vui lòng nhập tên sản phẩm."); return; }
    if (category === "__custom" && !customCat.trim()) { setError("Vui lòng nhập tên danh mục mới."); return; }
    if (product) updateMut.mutate(); else createMut.mutate();
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {!product && (
        <div>
          <label htmlFor="p-sku" className={labelCls}>Mã sản phẩm (SKU) — để trống để tự sinh</label>
          <input id="p-sku" aria-label="Mã sản phẩm SKU" className={inputCls} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="VD: BC-TOTO-001" />
          <p className="text-xs text-[var(--dim)] mt-1">Mã giúp tra cứu nhanh, in tem và đối chiếu khi nhập/xuất. VD theo hãng: BC-TOTO-001, LV-INAX-02…</p>
        </div>
      )}
      {product && <p className="text-sm"><span className="text-[var(--dim)]">Mã SKU:</span> <span className="font-bold tabular">{product.sku}</span> <span className="text-[var(--dim)]">· Tồn hiện tại: {fmtNum(product.currentStock)} {product.unit} (sửa tồn qua phiếu Nhập/Xuất/Kiểm kê)</span></p>}
      <div>
        <label htmlFor="p-name" className={labelCls}>Tên sản phẩm *</label>
        <input id="p-name" aria-label="Tên sản phẩm" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Bồn cầu 1 khối TOTO CS767" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="p-cat" className={labelCls}>Danh mục</label>
          <select id="p-cat" aria-label="Danh mục" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__custom">+ Danh mục mới…</option>
          </select>
        </div>
        <div>
          <label htmlFor="p-brand" className={labelCls}>Thương hiệu</label>
          <input id="p-brand" aria-label="Thương hiệu" className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="TOTO, INAX, Caesar…" list="brands" />
          <datalist id="brands"><option value="TOTO" /><option value="INAX" /><option value="Caesar" /><option value="Viglacera" /><option value="American Standard" /><option value="Kohler" /><option value="Linax" /><option value="Häfele" /></datalist>
        </div>
      </div>
      {category === "__custom" && (
        <div><label htmlFor="p-customcat" className={labelCls}>Tên danh mục mới</label><input id="p-customcat" aria-label="Tên danh mục mới" className={inputCls} value={customCat} onChange={(e) => setCustomCat(e.target.value)} placeholder="VD: Máy lọc nước" /></div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="p-cost" className={labelCls}>Giá nhập (VNĐ)</label>
          <input id="p-cost" aria-label="Giá nhập" type="number" inputMode="numeric" min={0} className={inputCls} value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label htmlFor="p-sell" className={labelCls}>Giá bán (VNĐ)</label>
          <input id="p-sell" aria-label="Giá bán" type="number" inputMode="numeric" min={0} className={inputCls} value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} placeholder="0" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label htmlFor="p-unit" className={labelCls}>Đơn vị tính</label>
          <select id="p-unit" aria-label="Đơn vị tính" className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value)}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
        </div>
        {!product ? (
          <div>
            <label htmlFor="p-init" className={labelCls}>Tồn đầu kỳ</label>
            <input id="p-init" aria-label="Tồn đầu kỳ" type="number" inputMode="numeric" min={0} className={inputCls} value={initialStock} onChange={(e) => setInitialStock(e.target.value)} />
          </div>
        ) : <div />}
        <div>
          <label htmlFor="p-min" className={labelCls}>Tồn tối thiểu ⚠</label>
          <input id="p-min" aria-label="Tồn tối thiểu" type="number" inputMode="numeric" min={0} className={inputCls} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-[var(--dim)] -mt-2">Khi tồn ≤ tồn tối thiểu, sản phẩm sẽ hiện cảnh báo “Sắp hết” ở Tổng quan để kịp nhập thêm.</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="p-loc" className={labelCls}>Vị trí trong kho</label>
          <input id="p-loc" aria-label="Vị trí trong kho" className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="VD: Kệ A2, Khu 1" />
        </div>
        <div>
          <label htmlFor="p-notes" className={labelCls}>Ghi chú</label>
          <input id="p-notes" aria-label="Ghi chú sản phẩm" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Màu, kích thước…" />
        </div>
      </div>
      {error && <p className="rounded-xl bg-[var(--red-soft)] text-[var(--red)] text-sm px-3 py-2.5 font-medium">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onClose} className={btnGhost + " flex-1"}>Huỷ</button>
        <button type="submit" disabled={busy} className={btnPrimary + " flex-1"}>{busy ? "Đang lưu…" : product ? "Lưu thay đổi" : "Thêm sản phẩm"}</button>
      </div>
    </form>
  );
}

/* ---------------- Movement Form ---------------- */
function MovementForm({ presetType, presetProductId, products, suppliers, onClose }: { presetType: "in" | "out" | "adjust"; presetProductId?: number; products: Product[]; suppliers: Supplier[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<"in" | "out" | "adjust">(presetType);
  const [productId, setProductId] = useState<number>(() => {
    if (presetProductId && products.some((p) => p.id === presetProductId)) return presetProductId;
    return products[0]?.id ?? 0;
  });
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState(presetType === "in" ? IN_REASONS[0]! : presetType === "out" ? OUT_REASONS[0]! : "Kiểm kê định kỳ");
  const [partner, setPartner] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [doneMsg, setDoneMsg] = useState("");
  const selected = products.find((p) => p.id === productId);

  const mut = useMutation({
    mutationFn: () => api.createMovement({ productId, type, quantity: Number(quantity) || 0, unitCost: Number(unitCost) || 0, reason, partner, note }),
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Có lỗi"); return; }
      setDoneMsg(`Đã ghi phiếu ${r.refCode} · Tồn mới: ${fmtNum(r.newStock)} ${selected?.unit ?? ""}`);
      qc.invalidateQueries();
      setTimeout(onClose, 1100);
    },
    onError: (e) => setError(String(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!productId) { setError("Hãy chọn sản phẩm (cần có ít nhất 1 sản phẩm trong kho)."); return; }
    if (quantity === "" || Number(quantity) < 0) { setError("Vui lòng nhập số lượng hợp lệ."); return; }
    mut.mutate();
  }
  const reasons = type === "in" ? IN_REASONS : type === "out" ? OUT_REASONS : ["Kiểm kê định kỳ", "Kiểm kê đột xuất", "Hao hụt / Vỡ", "Sai lệch số liệu"];
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Loại phiếu">
        {(["in", "out", "adjust"] as const).map((t) => (
          <button key={t} type="button" aria-label={MOVE_META[t]!.label} onClick={() => { setType(t); setReason(t === "in" ? IN_REASONS[0]! : t === "out" ? OUT_REASONS[0]! : "Kiểm kê định kỳ"); }}
            className={`rounded-xl py-2.5 font-semibold text-sm border ${type === t ? "bg-[var(--accent)] text-white border-transparent" : "bg-[var(--surface)] border-[var(--border)]"}`}>
            {MOVE_META[t]!.label}
          </button>
        ))}
      </div>
      <div>
        <label htmlFor="m-product" className={labelCls}>Sản phẩm *</label>
        <select id="m-product" aria-label="Chọn sản phẩm" className={inputCls} value={productId} onChange={(e) => setProductId(Number(e.target.value))}>
          {products.length === 0 && <option value={0}>— Chưa có sản phẩm —</option>}
          {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name} (tồn: {p.currentStock} {p.unit})</option>)}
        </select>
        {selected && <p className="text-xs text-[var(--dim)] mt-1">Tồn hiện tại: <b className="text-[var(--text)]">{fmtNum(selected.currentStock)} {selected.unit}</b> · Giá nhập: {fmtVND(selected.costPrice)} · Giá bán: {fmtVND(selected.sellPrice)}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="m-qty" className={labelCls}>{type === "adjust" ? "Số tồn thực tế đếm được *" : "Số lượng *"}</label>
          <input id="m-qty" aria-label="Số lượng" type="number" inputMode="numeric" min={0} className={inputCls} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" required />
        </div>
        <div>
          <label htmlFor="m-cost" className={labelCls}>{type === "out" ? "Đơn giá xuất (VNĐ)" : "Đơn giá nhập (VNĐ)"}</label>
          <input id="m-cost" aria-label="Đơn giá" type="number" inputMode="numeric" min={0} className={inputCls} value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder={selected ? String(type === "out" ? selected.sellPrice : selected.costPrice) : "0"} />
        </div>
      </div>
      {type === "adjust" && selected && quantity !== "" && (
        <p className="text-sm rounded-xl bg-[var(--amber-soft)] text-[var(--amber)] px-3 py-2.5 font-medium">Chênh lệch kiểm kê: {Number(quantity) - selected.currentStock >= 0 ? "+" : ""}{Number(quantity) - selected.currentStock} {selected.unit} so với sổ sách.</p>
      )}
      <div>
        <label htmlFor="m-reason" className={labelCls}>Lý do</label>
        <select id="m-reason" aria-label="Lý do" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>{reasons.map((r) => <option key={r} value={r}>{r}</option>)}</select>
      </div>
      <div>
        <label htmlFor="m-partner" className={labelCls}>{type === "in" ? "Nhà cung cấp / Đối tác" : type === "out" ? "Khách hàng / Công trình" : "Người kiểm kê"}</label>
        <input id="m-partner" aria-label="Đối tác" className={inputCls} value={partner} onChange={(e) => setPartner(e.target.value)} placeholder={type === "in" ? "Chọn hoặc gõ tên NCC" : "Tên khách / công trình"} list="supplier-list" />
        <datalist id="supplier-list">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
      </div>
      <div>
        <label htmlFor="m-note" className={labelCls}>Ghi chú phiếu</label>
        <input id="m-note" aria-label="Ghi chú phiếu" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Số hoá đơn, xe giao hàng…" />
      </div>
      {error && <p className="rounded-xl bg-[var(--red-soft)] text-[var(--red)] text-sm px-3 py-2.5 font-medium">{error}</p>}
      {doneMsg && <p className="rounded-xl bg-[var(--green-soft)] text-[var(--green)] text-sm px-3 py-2.5 font-semibold">{doneMsg}</p>}
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onClose} className={btnGhost + " flex-1"}>Đóng</button>
        <button type="submit" disabled={mut.isPending} className={btnPrimary + " flex-1"}>{mut.isPending ? "Đang ghi…" : type === "in" ? "✓ Ghi phiếu nhập" : type === "out" ? "✓ Ghi phiếu xuất" : "✓ Lưu kiểm kê"}</button>
      </div>
    </form>
  );
}

/* ---------------- Order Form ---------------- */
type OrderLine = { productId: number; quantity: number; unitPrice: number };
function OrderForm({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [status, setStatus] = useState<"pending" | "confirmed">("pending");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<OrderLine[]>(products[0] ? [{ productId: products[0].id, quantity: 1, unitPrice: products[0].sellPrice }] : []);
  const [error, setError] = useState("");
  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  const mut = useMutation({
    mutationFn: () => api.createOrder({ customerName, customerPhone, customerAddress, status, note, items: lines }),
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Có lỗi"); return; }
      qc.invalidateQueries(); onClose();
    },
    onError: (e) => setError(String(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!customerName.trim()) { setError("Vui lòng nhập tên khách hàng."); return; }
    if (lines.length === 0) { setError("Đơn cần ít nhất 1 dòng hàng."); return; }
    mut.mutate();
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="o-name" className={labelCls}>Khách hàng *</label><input id="o-name" aria-label="Tên khách hàng" className={inputCls} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Anh Tuấn / Cty ABC" required /></div>
        <div><label htmlFor="o-phone" className={labelCls}>Số điện thoại</label><input id="o-phone" aria-label="Số điện thoại khách" type="tel" className={inputCls} value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="09xx…" /></div>
      </div>
      <div><label htmlFor="o-addr" className={labelCls}>Địa chỉ giao hàng</label><input id="o-addr" aria-label="Địa chỉ giao hàng" className={inputCls} value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Số nhà, đường, quận…" /></div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-semibold text-[var(--dim)]">Dòng hàng</span>
          <button type="button" aria-label="Thêm dòng hàng" className="text-sm font-semibold text-[var(--accent)]" onClick={() => { const p = products[0]; if (p) setLines([...lines, { productId: p.id, quantity: 1, unitPrice: p.sellPrice }]); }}>+ Thêm dòng</button>
        </div>
        <div className="space-y-3">
          {lines.map((line, idx) => {
            const p = products.find((x) => x.id === line.productId);
            return (
              <div key={idx} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2">
                <div className="flex gap-2">
                  <select aria-label={`Sản phẩm dòng ${idx + 1}`} className={inputCls + " flex-1"} value={line.productId} onChange={(e) => {
                    const np = products.find((x) => x.id === Number(e.target.value));
                    const nl = [...lines]; nl[idx] = { ...line, productId: Number(e.target.value), unitPrice: np?.sellPrice ?? line.unitPrice }; setLines(nl);
                  }}>
                    {products.map((x) => <option key={x.id} value={x.id}>{x.sku} · {x.name} (tồn {x.currentStock})</option>)}
                  </select>
                  {lines.length > 1 && <button type="button" aria-label={`Xoá dòng ${idx + 1}`} className="w-10 shrink-0 rounded-xl bg-[var(--red-soft)] text-[var(--red)] font-bold" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>×</button>}
                </div>
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div><label htmlFor={`o-qty-${idx}`} className={labelCls}>SL</label><input id={`o-qty-${idx}`} aria-label={`Số lượng dòng ${idx + 1}`} type="number" inputMode="numeric" min={1} className={inputCls} value={line.quantity} onChange={(e) => { const nl = [...lines]; nl[idx] = { ...line, quantity: Number(e.target.value) || 1 }; setLines(nl); }} /></div>
                  <div><label htmlFor={`o-price-${idx}`} className={labelCls}>Đơn giá</label><input id={`o-price-${idx}`} aria-label={`Đơn giá dòng ${idx + 1}`} type="number" inputMode="numeric" min={0} className={inputCls} value={line.unitPrice} onChange={(e) => { const nl = [...lines]; nl[idx] = { ...line, unitPrice: Number(e.target.value) || 0 }; setLines(nl); }} /></div>
                  <div className="text-right pb-2"><span className="text-xs text-[var(--dim)] block">Thành tiền</span><span className="font-bold tabular text-sm">{fmtVND(line.quantity * line.unitPrice)}</span></div>
                </div>
                {p && lines.filter((x) => x.productId === line.productId).reduce((s, x) => s + x.quantity, 0) > p.currentStock && <p className="text-xs font-medium text-[var(--amber)]">⚠ Tổng số lượng sản phẩm này trong đơn ({lines.filter((x) => x.productId === line.productId).reduce((s, x) => s + x.quantity, 0)}) vượt tồn ({p.currentStock} {p.unit}) — đơn ở trạng thái “Chờ xử lý” vẫn tạo được, nhưng khi Xác nhận sẽ cần đủ hàng (hệ thống cộng dồn các dòng trùng sản phẩm).</p>}
              </div>
            );
          })}
          {products.length === 0 && <p className="text-sm text-[var(--dim)]">Chưa có sản phẩm nào trong kho. Hãy thêm sản phẩm ở tab Tồn kho trước.</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="o-status" className={labelCls}>Trạng thái khi tạo</label>
          <select id="o-status" aria-label="Trạng thái đơn" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as "pending" | "confirmed")}>
            <option value="pending">Chờ xử lý (chưa trừ kho)</option>
            <option value="confirmed">Đã xác nhận (trừ kho ngay)</option>
          </select>
        </div>
        <div><label htmlFor="o-note" className={labelCls}>Ghi chú đơn</label><input id="o-note" aria-label="Ghi chú đơn" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Giao buổi sáng…" /></div>
      </div>
      <div className="flex items-center justify-between rounded-2xl bg-[var(--accent-soft)] px-4 py-3">
        <span className="font-semibold text-sm">Tổng tiền đơn</span><span className="text-xl font-extrabold tabular">{fmtVND(total)}</span>
      </div>
      {error && <p className="rounded-xl bg-[var(--red-soft)] text-[var(--red)] text-sm px-3 py-2.5 font-medium">{error}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className={btnGhost + " flex-1"}>Huỷ</button>
        <button type="submit" disabled={mut.isPending} className={btnPrimary + " flex-1"}>{mut.isPending ? "Đang tạo…" : "Tạo đơn hàng"}</button>
      </div>
    </form>
  );
}

/* ---------------- Supplier Form ---------------- */
function SupplierForm({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(supplier?.name ?? "");
  const [contactPerson, setContactPerson] = useState(supplier?.contactPerson ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [error, setError] = useState("");
  const mut = useMutation({
    mutationFn: () => supplier ? api.updateSupplier({ id: supplier.id, name, contactPerson, phone, email, address, notes }) : api.createSupplier({ name, contactPerson, phone, email, address, notes }),
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
    onError: (e) => setError(String(e)),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) { setError("Vui lòng nhập tên nhà cung cấp."); return; } mut.mutate(); }} className="space-y-4">
      <div><label htmlFor="s-name" className={labelCls}>Tên nhà cung cấp / Đối tác *</label><input id="s-name" aria-label="Tên nhà cung cấp" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: NPP TOTO Miền Nam" required /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="s-contact" className={labelCls}>Người liên hệ</label><input id="s-contact" aria-label="Người liên hệ" className={inputCls} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} /></div>
        <div><label htmlFor="s-phone" className={labelCls}>Điện thoại</label><input id="s-phone" aria-label="Điện thoại NCC" type="tel" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
      </div>
      <div><label htmlFor="s-email" className={labelCls}>Email</label><input id="s-email" aria-label="Email NCC" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><label htmlFor="s-addr" className={labelCls}>Địa chỉ</label><input id="s-addr" aria-label="Địa chỉ NCC" className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
      <div><label htmlFor="s-notes" className={labelCls}>Ghi chú (hạn thanh toán, chiết khấu…)</label><input id="s-notes" aria-label="Ghi chú NCC" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      {error && <p className="rounded-xl bg-[var(--red-soft)] text-[var(--red)] text-sm px-3 py-2.5 font-medium">{error}</p>}
      <div className="flex gap-3"><button type="button" onClick={onClose} className={btnGhost + " flex-1"}>Huỷ</button><button type="submit" disabled={mut.isPending} className={btnPrimary + " flex-1"}>{mut.isPending ? "Đang lưu…" : "Lưu nhà cung cấp"}</button></div>
    </form>
  );
}

/* ---------------- Main App ---------------- */
export function App() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [prodSearch, setProdSearch] = useState("");
  const [prodCat, setProdCat] = useState("");
  const [prodStock, setProdStock] = useState<"all" | "in_stock" | "low" | "out">("all");
  const [moveType, setMoveType] = useState<"all" | "in" | "out" | "adjust">("all");
  const [moveSearch, setMoveSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [newCatName, setNewCatName] = useState("");

  const [productForm, setProductForm] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [moveForm, setMoveForm] = useState<{ open: boolean; type: "in" | "out" | "adjust"; productId?: number }>({ open: false, type: "in" });
  const [orderFormOpen, setOrderFormOpen] = useState(false);
  const [supplierForm, setSupplierForm] = useState<{ open: boolean; supplier: Supplier | null }>({ open: false, supplier: null });
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: string; id: number; label: string } | null>(null);

  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api.getDashboard({}) });
  const productsQ = useQuery({ queryKey: ["products", prodSearch, prodCat, prodStock], queryFn: () => api.listProducts({ search: prodSearch, category: prodCat, stockFilter: prodStock }) });
  const allProductsQ = useQuery({ queryKey: ["products-all"], queryFn: () => api.listProducts({ search: "", category: "", stockFilter: "all" }) });
  const movementsQ = useQuery({ queryKey: ["movements", moveType, moveSearch], queryFn: () => api.listMovements({ type: moveType, search: moveSearch, limit: 200 }) });
  const ordersQ = useQuery({ queryKey: ["orders", orderStatus, orderSearch], queryFn: () => api.listOrders({ status: orderStatus, search: orderSearch }) });
  const suppliersQ = useQuery({ queryKey: ["suppliers", supplierSearch], queryFn: () => api.listSuppliers({ search: supplierSearch }) });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: () => api.listCategories({}) });

  const allProducts = allProductsQ.data?.products ?? [];
  const categories = useMemo(() => allProductsQ.data?.categories ?? productsQ.data?.categories ?? [], [allProductsQ.data, productsQ.data]);

  const deleteMut = useMutation({
    mutationFn: async (c: { kind: string; id: number }) => {
      if (c.kind === "product") return api.deleteProduct({ id: c.id });
      if (c.kind === "supplier") return api.deleteSupplier({ id: c.id });
      if (c.kind === "category") return api.deleteCategory({ id: c.id });
      return api.deleteMovement({ id: c.id });
    },
    onSuccess: (r) => {
      qc.invalidateQueries(); setConfirmDelete(null);
      if (r && typeof r === "object" && "ok" in r && !(r as { ok: boolean }).ok) {
        alertMsg((r as { error?: string | null }).error ?? "Không xoá được phiếu này.");
      }
    },
  });
  const orderStatusMut = useMutation({
    mutationFn: (v: { id: number; status: "pending" | "confirmed" | "delivering" | "completed" | "cancelled" }) => api.updateOrderStatus(v),
    onSuccess: (r) => { if (!r.ok) alertMsg(r.error ?? "Không đổi được trạng thái"); qc.invalidateQueries(); },
  });
  const [toast, setToast] = useState("");
  function alertMsg(m: string) { setToast(m); setTimeout(() => setToast(""), 5500); }
  const addCatMut = useMutation({ mutationFn: () => api.createCategory({ name: newCatName }), onSuccess: (r) => { if (!r.ok) alertMsg(r.error ?? "Lỗi"); else setNewCatName(""); qc.invalidateQueries(); } });

  const d = dashboard.data;
  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "dashboard", label: "Tổng quan", icon: "▦" },
    { key: "products", label: "Tồn kho", icon: "▤" },
    { key: "movements", label: "Nhập / Xuất", icon: "⇅" },
    { key: "orders", label: "Đơn hàng", icon: "🧾" },
    { key: "partners", label: "Đối tác", icon: "🏭" },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg)] pb-24">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] rounded-2xl bg-[var(--text)] text-[var(--bg)] text-sm font-semibold px-4 py-3 shadow-lg">{toast}</div>}

      <main className="mx-auto max-w-3xl px-4 pt-4">
        {/* Quick actions */}
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          <button aria-label="Tạo phiếu nhập kho" onClick={() => setMoveForm({ open: true, type: "in" })} className="rounded-2xl bg-[var(--green)] text-white py-3.5 font-bold text-[15px] active:opacity-80 shadow-sm">↓ Nhập kho</button>
          <button aria-label="Tạo phiếu xuất kho" onClick={() => setMoveForm({ open: true, type: "out" })} className="rounded-2xl bg-[var(--red)] text-white py-3.5 font-bold text-[15px] active:opacity-80 shadow-sm">↑ Xuất kho</button>
          <button aria-label="Tạo đơn hàng mới" onClick={() => setOrderFormOpen(true)} className="rounded-2xl bg-[var(--accent)] text-white py-3.5 font-bold text-[15px] active:opacity-80 shadow-sm">+ Đơn hàng</button>
        </div>

        {tab === "dashboard" && (
          <section aria-label="Tổng quan kho">
            {dashboard.isPending && <p className="text-[var(--dim)] py-8 text-center">Đang tải tổng quan…</p>}
            {dashboard.error && <p className="text-[var(--red)] py-8 text-center">Không tải được dữ liệu. Hãy thử lại.</p>}
            {d && (
              <>
                <div className="rounded-3xl bg-[var(--accent)] text-white p-5 mb-4">
                  <p className="text-white/80 text-sm font-medium">Giá trị tồn kho (theo giá nhập)</p>
                  <p className="text-[32px] leading-tight font-extrabold tabular mt-1">{fmtVND(d.inventoryValueCost)}</p>
                  <p className="text-white/80 text-sm mt-1">Giá trị bán ra dự kiến: <span className="font-semibold text-white">{fmtVND(d.inventoryValueSell)}</span></p>
                  <div className="grid grid-cols-3 gap-3 mt-4 text-center">
                    <div className="rounded-2xl bg-white/15 py-2.5"><p className="text-xl font-extrabold tabular">{fmtNum(d.totalSkus)}</p><p className="text-[11px] text-white/85 font-medium">Mã sản phẩm</p></div>
                    <div className="rounded-2xl bg-white/15 py-2.5"><p className="text-xl font-extrabold tabular">{fmtNum(d.totalUnits)}</p><p className="text-[11px] text-white/85 font-medium">Tổng số lượng tồn</p></div>
                    <div className="rounded-2xl bg-white/15 py-2.5"><p className="text-xl font-extrabold tabular">{fmtNum(d.pendingOrders)}</p><p className="text-[11px] text-white/85 font-medium">Đơn đang xử lý</p></div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
                    <p className="text-[13px] font-semibold text-[var(--dim)]">Nhập hôm nay</p>
                    <p className="text-2xl font-extrabold tabular text-[var(--green)] mt-1">+{fmtNum(d.todayInQty)}</p>
                    <p className="text-xs text-[var(--dim)] mt-0.5">{fmtVND(d.todayInValue)}</p>
                  </div>
                  <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
                    <p className="text-[13px] font-semibold text-[var(--dim)]">Xuất hôm nay</p>
                    <p className="text-2xl font-extrabold tabular text-[var(--red)] mt-1">−{fmtNum(d.todayOutQty)}</p>
                    <p className="text-xs text-[var(--dim)] mt-0.5">{fmtVND(d.todayOutValue)}</p>
                  </div>
                </div>

                {(d.lowStockCount > 0 || d.outOfStockCount > 0) && (
                  <div className="rounded-2xl border border-[var(--amber)]/40 bg-[var(--amber-soft)] p-4 mb-4">
                    <h3 className="font-bold text-[15px]">⚠ Cần nhập thêm: {d.lowStockCount} sắp hết · {d.outOfStockCount} hết hàng</h3>
                    <ul className="mt-2 space-y-1.5">
                      {d.lowStockProducts.map((p) => (
                        <li key={p.id} className="flex items-center justify-between text-sm gap-2">
                          <span className="min-w-0 truncate"><span className="font-semibold tabular">{p.sku}</span> · {p.name}</span>
                          <span className="shrink-0 font-bold tabular">{p.currentStock} / tối thiểu {p.minStock} {p.unit}</span>
                        </li>
                      ))}
                    </ul>
                    <button aria-label="Đi tới nhập kho cho hàng sắp hết" className="mt-3 w-full rounded-xl bg-[var(--amber)] text-white font-bold py-2.5" onClick={() => setMoveForm({ open: true, type: "in" })}>Nhập hàng ngay</button>
                  </div>
                )}
                {d.totalSkus === 0 && (
                  <div className="rounded-2xl bg-[var(--surface)] border border-dashed border-[var(--border)] p-6 text-center mb-4">
                    <p className="text-4xl mb-2">🚿</p>
                    <h3 className="font-bold text-lg">Kho đang trống — bắt đầu nhé</h3>
                    <p className="text-sm text-[var(--dim)] mt-1.5 leading-relaxed">Thêm sản phẩm đầu tiên (bồn cầu, lavabo, sen tắm…) kèm mã SKU và tồn đầu kỳ. Sau đó dùng Nhập/Xuất và Đơn hàng — tồn kho sẽ tự cập nhật.</p>
                    <button aria-label="Thêm sản phẩm đầu tiên" className={btnPrimary + " mt-4 w-full"} onClick={() => setProductForm({ open: true, product: null })}>+ Thêm sản phẩm đầu tiên</button>
                  </div>
                )}

                {d.totalSkus > 0 && (
                  <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 mb-4">
                    <h3 className="font-bold text-[15px] mb-3">Nhập / Xuất 7 ngày gần nhất (số lượng)</h3>
                    <div className="h-[180px]" aria-label="Biểu đồ nhập xuất 7 ngày">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={d.chart7Days} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--dim)" }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: "var(--dim)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip formatter={(v: number, name: string) => [fmtNum(v), name === "inQty" ? "Nhập" : "Xuất"]} labelFormatter={(l) => `Ngày ${l}`} />
                          <Bar dataKey="inQty" name="inQty" fill="#15803D" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="outQty" name="outQty" fill="#DC2626" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex gap-4 text-xs font-medium text-[var(--dim)] mt-1"><span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#15803D] mr-1" />Nhập</span><span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#DC2626] mr-1" />Xuất</span></div>
                  </div>
                )}

                {d.recentMovements.length > 0 && (
                  <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
                    <div className="flex items-center justify-between mb-2"><h3 className="font-bold text-[15px]">Biến động gần nhất</h3><button aria-label="Xem toàn bộ lịch sử" className="text-sm font-semibold text-[var(--accent)]" onClick={() => setTab("movements")}>Xem tất cả →</button></div>
                    <ul className="divide-y divide-[var(--border)]">
                      {d.recentMovements.map((m) => <MovementRow key={m.id} m={m} compact />)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {tab === "products" && (
          <section aria-label="Tồn kho">
            <div className="flex gap-2 mb-3">
              <input aria-label="Tìm sản phẩm theo tên, mã SKU, hãng" className={inputCls + " flex-1"} value={prodSearch} onChange={(e) => setProdSearch(e.target.value)} placeholder="Tìm theo tên, mã SKU, hãng…" />
              <button aria-label="Thêm sản phẩm mới" className={btnPrimary + " shrink-0"} onClick={() => setProductForm({ open: true, product: null })}>+ Thêm</button>
            </div>
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1 -mx-1 px-1">
              <select aria-label="Lọc theo danh mục" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium shrink-0" value={prodCat} onChange={(e) => setProdCat(e.target.value)}>
                <option value="">Tất cả danh mục</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {([["all", "Tất cả"], ["in_stock", "Còn hàng"], ["low", "Sắp hết"], ["out", "Hết hàng"]] as const).map(([v, l]) => (
                <button key={v} aria-label={`Lọc tồn: ${l}`} onClick={() => setProdStock(v)} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold border ${prodStock === v ? "bg-[var(--accent)] text-white border-transparent" : "bg-[var(--surface)] border-[var(--border)]"}`}>{l}</button>
              ))}
            </div>
            {productsQ.isPending && <p className="text-center text-[var(--dim)] py-8">Đang tải tồn kho…</p>}
            {productsQ.data && productsQ.data.products.length === 0 && (
              <div className="rounded-2xl bg-[var(--surface)] border border-dashed border-[var(--border)] p-6 text-center">
                <p className="font-semibold">Không có sản phẩm nào khớp bộ lọc</p>
                <p className="text-sm text-[var(--dim)] mt-1">Thử đổi từ khoá / danh mục, hoặc thêm sản phẩm mới.</p>
              </div>
            )}
            <ul className="space-y-3">
              {productsQ.data?.products.map((p) => {
                const b = stockBadge(p);
                return (
                  <li key={p.id} className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold leading-snug">{p.name}</p>
                        <p className="text-[13px] text-[var(--dim)] mt-0.5"><span className="font-semibold text-[var(--accent)] tabular">{p.sku}</span> · {p.category}{p.brand ? ` · ${p.brand}` : ""}{p.location ? ` · 📍 ${p.location}` : ""}</p>
                      </div>
                      <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${b.cls}`}>{b.label}</span>
                    </div>
                    <div className="flex items-end justify-between mt-3 gap-2">
                      <div>
                        <p className="text-[26px] leading-none font-extrabold tabular">{fmtNum(p.currentStock)} <span className="text-sm font-semibold text-[var(--dim)]">{p.unit}</span></p>
                        <p className="text-xs text-[var(--dim)] mt-1">Tối thiểu {p.minStock} · Nhập {fmtVND(p.costPrice)} · Bán {fmtVND(p.sellPrice)}</p>
                      </div>
                      <p className="text-right text-xs text-[var(--dim)]">Giá trị tồn<br /><span className="text-sm font-bold text-[var(--text)] tabular">{fmtVND(p.currentStock * p.costPrice)}</span></p>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-3">
                      <button aria-label={`Nhập thêm ${p.name}`} className="rounded-lg bg-[var(--green-soft)] text-[var(--green)] font-bold text-[13px] py-2" onClick={() => setMoveForm({ open: true, type: "in", productId: p.id })}>↓ Nhập</button>
                      <button aria-label={`Xuất ${p.name}`} className="rounded-lg bg-[var(--red-soft)] text-[var(--red)] font-bold text-[13px] py-2" onClick={() => setMoveForm({ open: true, type: "out", productId: p.id })}>↑ Xuất</button>
                      <button aria-label={`Sửa ${p.name}`} className="rounded-lg bg-[var(--surface2)] font-bold text-[13px] py-2" onClick={() => setProductForm({ open: true, product: p })}>Sửa</button>
                      <button aria-label={`Xoá ${p.name}`} className="rounded-lg bg-[var(--surface2)] text-[var(--red)] font-bold text-[13px] py-2" onClick={() => setConfirmDelete({ kind: "product", id: p.id, label: `${p.sku} · ${p.name}` })}>Xoá</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {tab === "movements" && (
          <section aria-label="Lịch sử nhập xuất">
            <div className="flex gap-2 mb-3">
              <input aria-label="Tìm phiếu theo sản phẩm, mã phiếu, đối tác" className={inputCls + " flex-1"} value={moveSearch} onChange={(e) => setMoveSearch(e.target.value)} placeholder="Tìm phiếu, sản phẩm, đối tác…" />
              <button aria-label="Tạo phiếu mới" className={btnPrimary + " shrink-0"} onClick={() => setMoveForm({ open: true, type: "in" })}>+ Phiếu</button>
            </div>
            <div className="flex gap-2 mb-3">
              {([["all", "Tất cả"], ["in", "Nhập"], ["out", "Xuất"], ["adjust", "Kiểm kê"]] as const).map(([v, l]) => (
                <button key={v} aria-label={`Lọc phiếu: ${l}`} onClick={() => setMoveType(v)} className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold border ${moveType === v ? "bg-[var(--accent)] text-white border-transparent" : "bg-[var(--surface)] border-[var(--border)]"}`}>{l}</button>
              ))}
            </div>
            {movementsQ.isPending && <p className="text-center text-[var(--dim)] py-8">Đang tải lịch sử…</p>}
            {movementsQ.data && movementsQ.data.movements.length === 0 && (
              <div className="rounded-2xl bg-[var(--surface)] border border-dashed border-[var(--border)] p-6 text-center">
                <p className="font-semibold">Chưa có phiếu nào</p>
                <p className="text-sm text-[var(--dim)] mt-1">Mỗi lần nhập, xuất hoặc kiểm kê sẽ được ghi lại tại đây kèm mã phiếu để tra cứu.</p>
              </div>
            )}
            <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] px-4">
              <ul className="divide-y divide-[var(--border)]">
                {movementsQ.data?.movements.map((m) => (
                  <li key={m.id} className="py-1">
                    <MovementRow m={m} />
                    <div className="flex justify-end pb-2">
                      <button aria-label={`Xoá phiếu ${m.refCode} và hoàn tồn`} className="text-xs font-semibold text-[var(--red)]" onClick={() => setConfirmDelete({ kind: "movement", id: m.id, label: `Phiếu ${m.refCode} · ${m.productName}` })}>Xoá phiếu & hoàn tồn</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {tab === "orders" && (
          <section aria-label="Đơn hàng">
            <div className="flex gap-2 mb-3">
              <input aria-label="Tìm đơn theo khách, mã đơn, SĐT" className={inputCls + " flex-1"} value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="Tìm khách, mã đơn, SĐT…" />
              <button aria-label="Tạo đơn hàng mới" className={btnPrimary + " shrink-0"} onClick={() => setOrderFormOpen(true)}>+ Đơn mới</button>
            </div>
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1 -mx-1 px-1">
              {([["all", "Tất cả"], ["pending", "Chờ xử lý"], ["confirmed", "Đã xác nhận"], ["delivering", "Đang giao"], ["completed", "Hoàn thành"], ["cancelled", "Đã huỷ"]] as const).map(([v, l]) => (
                <button key={v} aria-label={`Lọc đơn: ${l}`} onClick={() => setOrderStatus(v)} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold border ${orderStatus === v ? "bg-[var(--accent)] text-white border-transparent" : "bg-[var(--surface)] border-[var(--border)]"}`}>{l}</button>
              ))}
            </div>
            <p className="text-xs text-[var(--dim)] mb-3 leading-relaxed">💡 Đơn “Chờ xử lý” chưa trừ kho. Bấm <b>Xác nhận</b> → kho tự trừ + ghi phiếu xuất. Huỷ đơn đã xác nhận → kho tự hoàn lại.</p>
            {ordersQ.isPending && <p className="text-center text-[var(--dim)] py-8">Đang tải đơn hàng…</p>}
            {ordersQ.data && ordersQ.data.orders.length === 0 && (
              <div className="rounded-2xl bg-[var(--surface)] border border-dashed border-[var(--border)] p-6 text-center">
                <p className="font-semibold">Chưa có đơn hàng nào khớp</p>
                <p className="text-sm text-[var(--dim)] mt-1">Tạo đơn mới để bán hàng và xuất kho theo đơn.</p>
              </div>
            )}
            <ul className="space-y-3">
              {ordersQ.data?.orders.map((o) => {
                const st = ORDER_STATUS[o.status] ?? ORDER_STATUS.pending!;
                const expanded = expandedOrder === o.id;
                return (
                  <li key={o.id} className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
                    <button aria-label={`Xem chi tiết đơn ${o.orderCode}`} className="w-full text-left" onClick={() => setExpandedOrder(expanded ? null : o.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold">{o.customerName} <span className="font-semibold text-[var(--accent)] tabular text-sm">{o.orderCode}</span></p>
                          <p className="text-[13px] text-[var(--dim)] mt-0.5">{fmtDate(o.createdAt)}{o.customerPhone ? ` · ${o.customerPhone}` : ""} · {o.items.length} dòng hàng</p>
                        </div>
                        <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm text-[var(--dim)]">{o.items.reduce((s, i) => s + i.quantity, 0)} sản phẩm</span>
                        <span className="font-extrabold tabular">{fmtVND(o.totalAmount)}</span>
                      </div>
                    </button>
                    {expanded && (
                      <div className="mt-3 pt-3 border-t border-[var(--border)]">
                        {o.customerAddress && <p className="text-sm text-[var(--dim)] mb-2">📍 {o.customerAddress}</p>}
                        <ul className="space-y-1.5 mb-3">
                          {o.items.map((i) => (
                            <li key={i.id} className="flex justify-between text-sm gap-2"><span className="min-w-0 truncate"><span className="tabular font-semibold">{i.productSku}</span> · {i.productName} × {i.quantity}</span><span className="tabular font-semibold shrink-0">{fmtVND(i.lineTotal)}</span></li>
                          ))}
                        </ul>
                        {o.note && <p className="text-sm text-[var(--dim)] mb-3">📝 {o.note}</p>}
                        <label htmlFor={`order-status-${o.id}`} className={labelCls}>Đổi trạng thái đơn</label>
                        <select id={`order-status-${o.id}`} aria-label={`Trạng thái đơn ${o.orderCode}`} className={inputCls} value={o.status}
                          onChange={(e) => orderStatusMut.mutate({ id: o.id, status: e.target.value as "pending" | "confirmed" | "delivering" | "completed" | "cancelled" })}>
                          <option value="pending">Chờ xử lý</option>
                          <option value="confirmed">Đã xác nhận (trừ kho)</option>
                          <option value="delivering">Đang giao</option>
                          <option value="completed">Hoàn thành</option>
                          <option value="cancelled">Huỷ đơn (hoàn kho nếu đã trừ)</option>
                        </select>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {tab === "partners" && (
          <section aria-label="Đối tác và danh mục">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-lg">Nhà cung cấp</h3>
              <button aria-label="Thêm nhà cung cấp" className={btnPrimary} onClick={() => setSupplierForm({ open: true, supplier: null })}>+ Thêm NCC</button>
            </div>
            <input aria-label="Tìm nhà cung cấp" className={inputCls + " mb-3"} value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} placeholder="Tìm NCC theo tên, SĐT…" />
            {suppliersQ.data && suppliersQ.data.suppliers.length === 0 && (
              <div className="rounded-2xl bg-[var(--surface)] border border-dashed border-[var(--border)] p-5 text-center mb-6">
                <p className="font-semibold text-sm">Chưa có nhà cung cấp nào</p>
                <p className="text-sm text-[var(--dim)] mt-1">Thêm NCC (TOTO, INAX, Caesar…) để chọn nhanh khi nhập kho và đối chiếu công nợ.</p>
              </div>
            )}
            <ul className="space-y-3 mb-8">
              {suppliersQ.data?.suppliers.map((s) => (
                <li key={s.id} className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
                  <p className="font-bold">{s.name}</p>
                  <p className="text-[13px] text-[var(--dim)] mt-0.5">{[s.contactPerson, s.phone, s.email].filter(Boolean).join(" · ") || "Chưa có thông tin liên hệ"}</p>
                  {s.address && <p className="text-[13px] text-[var(--dim)]">📍 {s.address}</p>}
                  {s.notes && <p className="text-[13px] text-[var(--dim)]">📝 {s.notes}</p>}
                  <div className="flex gap-2 mt-3">
                    <button aria-label={`Sửa nhà cung cấp ${s.name}`} className="rounded-lg bg-[var(--surface2)] font-bold text-[13px] px-4 py-2" onClick={() => setSupplierForm({ open: true, supplier: s })}>Sửa</button>
                    <button aria-label={`Xoá nhà cung cấp ${s.name}`} className="rounded-lg bg-[var(--surface2)] text-[var(--red)] font-bold text-[13px] px-4 py-2" onClick={() => setConfirmDelete({ kind: "supplier", id: s.id, label: s.name })}>Xoá</button>
                    {s.phone && <a aria-label={`Gọi ${s.name}`} href={`tel:${s.phone}`} className="rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] font-bold text-[13px] px-4 py-2">📞 Gọi</a>}
                  </div>
                </li>
              ))}
            </ul>

            <h3 className="font-bold text-lg mb-3">Danh mục sản phẩm</h3>
            <form className="flex gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); if (newCatName.trim()) addCatMut.mutate(); }}>
              <input aria-label="Tên danh mục mới" className={inputCls + " flex-1"} value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="VD: Máy lọc nước, Đèn sưởi…" />
              <button type="submit" aria-label="Thêm danh mục" className={btnPrimary + " shrink-0"} disabled={addCatMut.isPending}>Thêm</button>
            </form>
            <ul className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] divide-y divide-[var(--border)] px-4">
              {categoriesQ.data?.categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-3">
                  <span className="font-medium text-sm">{c.name} <span className="text-[var(--dim)]">· {c.productCount} sản phẩm</span></span>
                  <button aria-label={`Xoá danh mục ${c.name}`} className="text-xs font-bold text-[var(--red)]" onClick={() => setConfirmDelete({ kind: "category", id: c.id, label: `Danh mục ${c.name} (${c.productCount} sản phẩm sẽ chuyển về “Khác”)` })}>Xoá</button>
                </li>
              ))}
            </ul>
            <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 mt-6">
              <h4 className="font-bold text-[15px] mb-2">Gợi ý vận hành kho (đã tích hợp sẵn)</h4>
              <ul className="text-sm text-[var(--dim)] space-y-1.5 leading-relaxed list-disc pl-5">
                <li><b className="text-[var(--text)]">Mã SKU chuẩn hoá:</b> để trống khi tạo sản phẩm, hệ thống tự sinh theo danh mục (BC = bồn cầu, LV = lavabo, ST = sen tắm…).</li>
                <li><b className="text-[var(--text)]">Cảnh báo tồn tối thiểu:</b> đặt mức tối thiểu cho từng mặt hàng bán chạy để không hụt hàng khi khách chốt đơn.</li>
                <li><b className="text-[var(--text)]">Kiểm kê:</b> dùng loại phiếu “Kiểm kê”, nhập số đếm thực tế — hệ thống tự tính chênh lệch và chốt tồn mới.</li>
                <li><b className="text-[var(--text)]">Vị trí kệ:</b> ghi vị trí (Kệ A2, Khu 1…) cho sản phẩm để nhân viên lấy hàng nhanh, tránh thất lạc hàng cồng kềnh.</li>
                <li><b className="text-[var(--text)]">Đơn gắn phiếu xuất:</b> mọi đơn xác nhận đều sinh phiếu xuất mang mã đơn, tra ngược được trong Lịch sử nhập/xuất.</li>
              </ul>
            </div>
          </section>
        )}
      </main>

      {/* Bottom nav */}
      <nav aria-label="Điều hướng chính" className="fixed bottom-0 inset-x-0 z-40 bg-[var(--surface)] border-t border-[var(--border)] pb-safe">
        <div className="mx-auto max-w-3xl grid grid-cols-5">
          {tabs.map((t) => (
            <button key={t.key} aria-label={t.label} aria-current={tab === t.key ? "page" : undefined} onClick={() => setTab(t.key)}
              className={`py-2.5 flex flex-col items-center gap-0.5 text-[11px] font-semibold ${tab === t.key ? "text-[var(--accent)]" : "text-[var(--dim)]"}`}>
              <span className="text-lg leading-none" aria-hidden>{t.icon}</span>{t.label}
              {t.key === "orders" && d && d.pendingOrders > 0 && <span className="absolute mt-[-2px] ml-10 min-w-5 h-5 px-1 rounded-full bg-[var(--red)] text-white text-[10px] font-bold flex items-center justify-center">{d.pendingOrders}</span>}
            </button>
          ))}
        </div>
      </nav>

      {productForm.open && <Modal title={productForm.product ? "Sửa sản phẩm" : "Thêm sản phẩm mới"} onClose={() => setProductForm({ open: false, product: null })}><ProductForm product={productForm.product} categories={categories.length ? categories : ["Bồn cầu", "Lavabo & Chậu rửa", "Vòi lavabo", "Sen tắm & Vòi sen", "Bồn tắm", "Khác"]} onClose={() => setProductForm({ open: false, product: null })} /></Modal>}
      {moveForm.open && <Modal title="Phiếu nhập / xuất / kiểm kê" onClose={() => setMoveForm({ ...moveForm, open: false })}><MovementForm presetType={moveForm.type} presetProductId={moveForm.productId} products={allProducts} suppliers={suppliersQ.data?.suppliers ?? []} onClose={() => setMoveForm({ ...moveForm, open: false })} /></Modal>}
      {orderFormOpen && <Modal title="Tạo đơn hàng mới" onClose={() => setOrderFormOpen(false)}><OrderForm products={allProducts} onClose={() => setOrderFormOpen(false)} /></Modal>}
      {supplierForm.open && <Modal title={supplierForm.supplier ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp"} onClose={() => setSupplierForm({ open: false, supplier: null })}><SupplierForm supplier={supplierForm.supplier} onClose={() => setSupplierForm({ open: false, supplier: null })} /></Modal>}

      {confirmDelete && (
        <Modal title="Xác nhận xoá" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm leading-relaxed">Bạn chắc chắn muốn xoá <b>{confirmDelete.label}</b>?</p>
          {confirmDelete.kind === "movement" && <p className="text-sm text-[var(--dim)] mt-2">Tồn kho sẽ được hoàn lại theo chênh lệch của phiếu này.</p>}
          {confirmDelete.kind === "product" && <p className="text-sm text-[var(--dim)] mt-2">Lịch sử phiếu & đơn cũ vẫn giữ tên/mã snapshot, nhưng sản phẩm sẽ biến mất khỏi tồn kho.</p>}
          <div className="flex gap-3 mt-5">
            <button aria-label="Huỷ xoá" className={btnGhost + " flex-1"} onClick={() => setConfirmDelete(null)}>Không xoá</button>
            <button aria-label="Xác nhận xoá" className="flex-1 rounded-xl bg-[var(--red)] text-white font-semibold px-4 py-2.5 disabled:opacity-50" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate({ kind: confirmDelete.kind, id: confirmDelete.id })}>{deleteMut.isPending ? "Đang xoá…" : "Xoá luôn"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MovementRow({ m, compact }: { m: Movement; compact?: boolean }) {
  const meta = MOVE_META[m.type] ?? MOVE_META.in!;
  const qtyLabel = m.type === "adjust" ? `${m.beforeStock} → ${m.afterStock}` : `${meta.sign}${fmtNum(m.quantity)}`;
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-sm leading-snug truncate">{m.productName}</p>
          <p className="text-xs text-[var(--dim)] mt-0.5 tabular">{m.refCode} · {m.productSku} · {fmtDate(m.createdAt)}</p>
          {!compact && (m.reason || m.partner) && <p className="text-xs text-[var(--dim)] mt-0.5">{[m.reason, m.partner].filter(Boolean).join(" · ")}{m.note ? ` · ${m.note}` : ""}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className={`font-extrabold tabular ${meta.cls}`}>{qtyLabel}</p>
          <p className="text-[11px] font-semibold text-[var(--dim)]">{meta.label} · tồn {fmtNum(m.afterStock)}</p>
        </div>
      </div>
    </div>
  );
}
