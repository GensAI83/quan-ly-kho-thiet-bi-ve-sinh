import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ApiResponse } from "./api";

type Product = ApiResponse<typeof api, "listProducts">["products"][number];
type Movement = ApiResponse<typeof api, "listMovements">["movements"][number];
type Supplier = ApiResponse<typeof api, "listSuppliers">["suppliers"][number];
type Order = ApiResponse<typeof api, "listOrders">["orders"][number];
type Tab = "dashboard" | "products" | "movements" | "orders" | "partners" | "reports" | "debts" | "stocktakes" | "history" | "admin";

const fmtVND = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + " ₫";
const fmtNum = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
const fmtDate = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const fmtDay = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysAgoStr = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ---------------- Nhân viên / phân quyền / tiện ích chung ---------------- */
type StaffInfo = { id: number; name: string; role: string; mustChangePin: number };
function loadStaff(): StaffInfo | null {
  try {
    const s = sessionStorage.getItem("staffInfo");
    return s ? (JSON.parse(s) as StaffInfo) : null;
  } catch {
    return null;
  }
}
function loadToken(): string {
  return sessionStorage.getItem("staffToken") ?? "";
}
const ROLE_LABEL: Record<string, string> = { admin: "Quản trị viên", storekeeper: "Thủ kho", sales: "Nhân viên bán hàng" };
const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;
const isAdminRole = (s: StaffInfo | null) => s?.role === "admin";
const canStockRole = (s: StaffInfo | null) => s?.role === "admin" || s?.role === "storekeeper";

function newRequestKey(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fallback bên dưới */ }
  return `rk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function netErrMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/network|fetch|failed to fetch|load failed|offline/i.test(m)) return process.env.KHO_DEPLOYMENT_MODE === "online" ? "Không kết nối được kho online. Kiểm tra Internet; kiểm tra lịch sử trước khi gửi lại thao tác." : "Không kết nối được ứng dụng trên máy. Hãy mở lại bằng nút Mở kho; kiểm tra lịch sử trước khi gửi lại thao tác.";
  return m;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = "\uFEFF" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), filename);
}
const CSV_SAMPLE =
  "sku,tên,danh mục,hãng,đơn vị,giá nhập,giá bán,tồn đầu,tồn tối thiểu,vị trí\r\n" +
  "BC-TOTO-001,Bồn cầu 1 khối TOTO CS767,Bồn cầu,TOTO,cái,3500000,4500000,10,2,Kệ A2\r\n" +
  "LV-INAX-01,Lavabo INAX AL-229V,Lavabo & Chậu rửa,INAX,cái,1200000,1650000,5,2,Kệ B1\r\n";

function stockBadge(p: Product) {
  if (p.status === "discontinued") return { label: "Ngưng bán", cls: "bg-[var(--surface2)] text-[var(--dim)]" };
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
  reserved: { label: "Đang giữ hàng", cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  returned: { label: "Đã trả hàng", cls: "bg-[var(--red-soft)] text-[var(--red)]" },
  partially_returned: { label: "Trả một phần", cls: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
};
const PAYMENT_STATUS: Record<string, string> = { unpaid: "Chưa thanh toán", partial: "Đã cọc một phần", paid: "Đã thanh toán đủ" };
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

export type PrintRow = { name: string; qty: string; price: number; amount: number };
export type PrintData = { title: string; meta: string[]; rows: PrintRow[]; total: number };
function PrintPreview({ data, onClose }: { data: PrintData; onClose: () => void }) {
  return (
    <Modal title="Xem trước phiếu in" onClose={onClose}>
      <div className="print-area rounded-2xl border border-[var(--border)] bg-white text-black p-5">
        <p className="text-center font-extrabold text-lg">Cửa hàng thiết bị vệ sinh</p>
        <p className="text-center font-bold mt-1">{data.title}</p>
        {data.meta.map((m, i) => <p key={i} className="text-sm mt-0.5">{m}</p>)}
        <table className="w-full text-sm mt-3 border-collapse">
          <thead><tr className="border-b border-black/30"><th className="text-left py-1">Hàng hoá</th><th className="text-right py-1">SL</th><th className="text-right py-1">Đơn giá</th><th className="text-right py-1">Thành tiền</th></tr></thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className="border-b border-black/10"><td className="py-1 pr-2">{r.name}</td><td className="text-right py-1">{r.qty}</td><td className="text-right py-1">{fmtVND(r.price)}</td><td className="text-right py-1 font-semibold">{fmtVND(r.amount)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="text-right font-extrabold mt-3">Tổng tiền: {fmtVND(data.total)}</p>
        <div className="flex justify-between mt-8 text-sm">
          <div className="text-center"><p className="font-semibold">Người giao</p><p className="mt-10 text-xs text-black/60">(Ký, ghi rõ họ tên)</p></div>
          <div className="text-center"><p className="font-semibold">Người nhận</p><p className="mt-10 text-xs text-black/60">(Ký, ghi rõ họ tên)</p></div>
        </div>
      </div>
      <button className={btnPrimary + " w-full mt-4"} onClick={() => window.print()}>🖨 In phiếu</button>
      <p className="text-xs text-[var(--dim)] mt-2 text-center">Khi in, chỉ nội dung phiếu được hiển thị.</p>
    </Modal>
  );
}

/* ---------------- Đăng nhập PIN / Đổi PIN ---------------- */
function LoginScreen({ onLoggedIn }: { onLoggedIn: (token: string, staff: StaffInfo, pin: string) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^\d{4,8}$/.test(pin)) { setError("Mã PIN gồm 4–8 chữ số."); return; }
    setBusy(true);
    try {
      const r = await api.loginStaff({ pin });
      if (!r.ok || !r.staff) { setError(r.error ?? "Mã PIN không đúng."); return; }
      onLoggedIn(r.token, { id: r.staff.id, name: r.staff.name, role: r.staff.role, mustChangePin: r.staff.mustChangePin }, pin);
    } catch (err) {
      setError(netErrMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-[var(--surface)] border border-[var(--border)] p-6 shadow-sm">
        <p className="text-4xl text-center mb-2">🚿</p>
        <h1 className="text-xl font-extrabold text-center">Cửa hàng thiết bị vệ sinh</h1>
        <p className="text-sm text-[var(--dim)] text-center mt-1">Đăng nhập bằng mã PIN nhân viên để vào app quản lý kho.</p>
        <div className="mt-5">
          <label htmlFor="login-pin" className={labelCls}>Mã PIN (4–8 số)</label>
          <input id="login-pin" aria-label="Mã PIN đăng nhập" type="password" inputMode="numeric" autoComplete="off" className={inputCls + " text-center text-2xl tracking-[0.5em]"} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••••" autoFocus />
        </div>
        {error && <p className="rounded-xl bg-[var(--red-soft)] text-[var(--red)] text-sm px-3 py-2.5 font-medium mt-4">{error}</p>}
        <button type="submit" disabled={busy} className={btnPrimary + " w-full mt-4"}>{busy ? "Đang kiểm tra…" : "Đăng nhập"}</button>
        <p className="text-xs text-[var(--dim)] mt-4 leading-relaxed text-center">Tài khoản quản trị mặc định: “Chủ cửa hàng”, PIN 123456 — bắt buộc đổi PIN ngay lần đầu đăng nhập.</p>
      </form>
    </div>
  );
}

function ChangePinScreen({ token, oldPin, onDone }: { token: string; oldPin: string; onDone: () => void }) {
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^\d{4,8}$/.test(newPin)) { setError("Mã PIN mới phải gồm 4–8 chữ số."); return; }
    if (newPin !== confirmPin) { setError("Mã PIN nhập lại chưa khớp."); return; }
    if (newPin === oldPin) { setError("Mã PIN mới phải khác mã PIN hiện tại."); return; }
    setBusy(true);
    try {
      const r = await api.changePin({ token, oldPin, newPin });
      if (!r.ok) { setError(r.error ?? "Không đổi được PIN."); return; }
      onDone();
    } catch (err) {
      setError(netErrMsg(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-[var(--surface)] border border-[var(--border)] p-6 shadow-sm">
        <h1 className="text-xl font-extrabold text-center">Đổi mã PIN lần đầu</h1>
        <p className="text-sm text-[var(--dim)] text-center mt-1">Vì lý do bảo mật, bạn phải đổi mã PIN mặc định trước khi vào app.</p>
        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="new-pin" className={labelCls}>Mã PIN mới (4–8 số)</label>
            <input id="new-pin" aria-label="Mã PIN mới" type="password" inputMode="numeric" autoComplete="off" className={inputCls + " text-center text-2xl tracking-[0.5em]"} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••••" autoFocus />
          </div>
          <div>
            <label htmlFor="confirm-pin" className={labelCls}>Nhập lại mã PIN mới</label>
            <input id="confirm-pin" aria-label="Nhập lại mã PIN mới" type="password" inputMode="numeric" autoComplete="off" className={inputCls + " text-center text-2xl tracking-[0.5em]"} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••••" />
          </div>
        </div>
        {error && <p className="rounded-xl bg-[var(--red-soft)] text-[var(--red)] text-sm px-3 py-2.5 font-medium mt-4">{error}</p>}
        <button type="submit" disabled={busy} className={btnPrimary + " w-full mt-4"}>{busy ? "Đang đổi…" : "Đổi PIN và vào app"}</button>
      </form>
    </div>
  );
}

/* ---------------- Product Form ---------------- */
function ProductForm({ product, categories, token, isAdmin, onClose }: { product: Product | null; categories: string[]; token: string; isAdmin: boolean; onClose: () => void }) {
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
  const [showPriceHistory, setShowPriceHistory] = useState(false);
  const priceChanged = !!product && (Number(costPrice) !== product.costPrice || Number(sellPrice) !== product.sellPrice);
  const [priceReason, setPriceReason] = useState("");
  const priceHistoryQ = useQuery({
    queryKey: ["priceHistory", product?.id],
    queryFn: () => api.listPriceHistory({ productId: product!.id, actorToken: token || undefined }),
    enabled: !!product && showPriceHistory,
  });

  const createMut = useMutation({
    mutationFn: () => api.createProduct({
      sku, name, category: category === "__custom" ? customCat.trim() : category, brand, unit,
      costPrice: Number(costPrice) || 0, sellPrice: Number(sellPrice) || 0,
      initialStock: Number(initialStock) || 0, minStock: Number(minStock) || 0, location, notes,
      actorToken: token || undefined,
    }),
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Có lỗi xảy ra"); return; }
      qc.invalidateQueries(); onClose();
    },
    onError: (e) => setError(netErrMsg(e)),
  });
  const updateMut = useMutation({
    mutationFn: () => api.updateProduct({
      id: product!.id, name, category: category === "__custom" ? customCat.trim() : category, brand, unit,
      costPrice: Number(costPrice) || 0, sellPrice: Number(sellPrice) || 0, minStock: Number(minStock) || 0, location, notes,
      actorToken: token || undefined, expectedVersion: product!.version,
      priceChangeReason: priceChanged ? priceReason.trim() : undefined,
    }),
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Có lỗi xảy ra"); return; }
      qc.invalidateQueries(); onClose();
    },
    onError: (e) => setError(netErrMsg(e)),
  });
  const busy = createMut.isPending || updateMut.isPending;
  function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!name.trim()) { setError("Vui lòng nhập tên sản phẩm."); return; }
    if (category === "__custom" && !customCat.trim()) { setError("Vui lòng nhập tên danh mục mới."); return; }
    if (product) updateMut.mutate(); else createMut.mutate();
  }
  const priceLocked = !!product && !isAdmin;
  return (
    <form onSubmit={submit} className="space-y-4">
      {!product && (
        <div>
          <label htmlFor="p-sku" className={labelCls}>Mã sản phẩm (SKU) — để trống để tự sinh</label>
          <input id="p-sku" aria-label="Mã sản phẩm SKU" className={inputCls} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="VD: BC-TOTO-001" />
          <p className="text-xs text-[var(--dim)] mt-1">Mã giúp tra cứu nhanh, in tem và đối chiếu khi nhập/xuất. VD theo hãng: BC-TOTO-001, LV-INAX-02…</p>
        </div>
      )}
      {product && <p className="text-sm"><span className="text-[var(--dim)]">Mã SKU:</span> <span className="font-bold tabular">{product.sku}</span> <span className="text-[var(--dim)]">· Tồn hiện tại: {fmtNum(product.currentStock)} {product.unit} (sửa tồn qua phiếu Nhập/Xuất/Kiểm kê)</span>{product.reservedQty > 0 && <span className="text-[var(--dim)]"> · Đang giữ: {fmtNum(product.reservedQty)} {product.unit}</span>}{product.status === "discontinued" && <span className="font-bold text-[var(--amber)]"> · Ngưng bán</span>}</p>}
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
          <input id="p-cost" aria-label="Giá nhập" type="number" inputMode="numeric" min={0} className={inputCls} value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0" disabled={priceLocked} />
        </div>
        <div>
          <label htmlFor="p-sell" className={labelCls}>Giá bán (VNĐ)</label>
          <input id="p-sell" aria-label="Giá bán" type="number" inputMode="numeric" min={0} className={inputCls} value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} placeholder="0" disabled={priceLocked} />
        </div>
      </div>
      {priceLocked && <p className="text-xs font-medium text-[var(--amber)] -mt-2">🔒 Đổi giá cần quyền quản trị — 2 ô giá đã khoá với tài khoản của bạn.</p>}
      {priceChanged && (
        <div>
          <label htmlFor="p-price-reason" className={labelCls}>Lý do đổi giá</label>
          <input id="p-price-reason" aria-label="Lý do đổi giá" className={inputCls} value={priceReason} onChange={(e) => setPriceReason(e.target.value)} placeholder="VD: NCC tăng giá 5%, điều chỉnh theo giá thị trường…" />
        </div>
      )}
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
      {product && product.unit !== unit && <p className="text-xs font-medium text-[var(--amber)]">Lưu ý: máy chủ sẽ chặn đổi đơn vị khi sản phẩm còn tồn hoặc đã có phiếu nhập/xuất.</p>}
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
      {product && (
        <div>
          <button type="button" className="text-sm font-semibold text-[var(--accent)]" onClick={() => setShowPriceHistory(!showPriceHistory)}>{showPriceHistory ? "Ẩn lịch sử giá ▲" : "Xem lịch sử giá ▼"}</button>
          {showPriceHistory && (
            <div className="mt-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              {priceHistoryQ.isPending && <p className="text-sm text-[var(--dim)]">Đang tải lịch sử giá…</p>}
              {priceHistoryQ.data && priceHistoryQ.data.history.length === 0 && <p className="text-sm text-[var(--dim)]">Chưa có lần đổi giá nào được ghi lại.</p>}
              <ul className="space-y-2">
                {priceHistoryQ.data?.history.map((h) => (
                  <li key={h.id} className="text-sm">
                    <p className="font-semibold">{fmtDate(h.createdAt)} · {h.actor}</p>
                    <p className="text-[var(--dim)]">Nhập: {fmtVND(h.oldCost)} → {fmtVND(h.newCost)} · Bán: {fmtVND(h.oldSell)} → {fmtVND(h.newSell)}</p>
                    {h.reason && <p className="text-[var(--dim)]">Lý do: {h.reason}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {error && <p className="rounded-xl bg-[var(--red-soft)] text-[var(--red)] text-sm px-3 py-2.5 font-medium">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onClose} className={btnGhost + " flex-1"}>Huỷ</button>
        <button type="submit" disabled={busy} className={btnPrimary + " flex-1"}>{busy ? "Đang lưu…" : product ? "Lưu thay đổi" : "Thêm sản phẩm"}</button>
      </div>
    </form>
  );
}

/* ---------------- Movement Form (đơn lẻ + nhiều mặt hàng) ---------------- */
type BatchLine = { productId: number; quantity: number; unitCost: number };
function MovementForm({ presetType, presetProductId, products, suppliers, token, canStock, onClose }: { presetType: "in" | "out" | "adjust"; presetProductId?: number; products: Product[]; suppliers: Supplier[]; token: string; canStock: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<"in" | "out" | "adjust">(presetType);
  const [mode, setMode] = useState<"single" | "batch">("single");
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
  const [batchLines, setBatchLines] = useState<BatchLine[]>(products[0] ? [{ productId: products[0].id, quantity: 1, unitCost: products[0].costPrice }] : []);
  const selected = products.find((p) => p.id === productId);

  const mut = useMutation({
    mutationFn: () => api.createMovement({
      productId, type, quantity: Number(quantity) || 0, unitCost: Number(unitCost) || 0, reason, partner, note,
      actorToken: token || undefined, requestKey: newRequestKey(), expectedVersion: selected?.version,
    }),
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Có lỗi"); return; }
      setDoneMsg(`Đã ghi phiếu ${r.refCode} · Tồn mới: ${fmtNum(r.newStock)} ${selected?.unit ?? ""}`);
      qc.invalidateQueries();
      setTimeout(onClose, 1100);
    },
    onError: (e) => setError(netErrMsg(e)),
  });
  const batchMut = useMutation({
    mutationFn: () => {
      const expectedVersions: Record<string, number> = {};
      for (const l of batchLines) {
        const p = products.find((x) => x.id === l.productId);
        if (p) expectedVersions[String(p.id)] = p.version;
      }
      return api.createMovementBatch({
        type: type as "in" | "out",
        lines: batchLines.filter((l) => l.quantity > 0).map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, reason, partner, note })),
        requestKey: newRequestKey(), expectedVersions, actorToken: token || undefined,
      });
    },
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Có lỗi"); return; }
      setDoneMsg(`Đã ghi phiếu ${r.refCode} · ${r.results.length} dòng hàng đã cập nhật tồn.`);
      qc.invalidateQueries();
      setTimeout(onClose, 1100);
    },
    onError: (e) => setError(netErrMsg(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!canStock) { setError("Cần quyền thủ kho hoặc quản trị để nhập/xuất kho."); return; }
    if (mode === "batch") {
      const valid = batchLines.filter((l) => l.quantity > 0);
      if (valid.length === 0) { setError("Phiếu nhiều mặt hàng cần ít nhất 1 dòng có số lượng > 0."); return; }
      batchMut.mutate();
      return;
    }
    if (!productId) { setError("Hãy chọn sản phẩm (cần có ít nhất 1 sản phẩm trong kho)."); return; }
    if (quantity === "" || Number(quantity) < 0) { setError("Vui lòng nhập số lượng hợp lệ."); return; }
    mut.mutate();
  }
  const reasons = type === "in" ? IN_REASONS : type === "out" ? OUT_REASONS : ["Kiểm kê định kỳ", "Kiểm kê đột xuất", "Hao hụt / Vỡ", "Sai lệch số liệu"];
  return (
    <form onSubmit={submit} className="space-y-4">
      {!canStock && <p className="rounded-xl bg-[var(--amber-soft)] text-[var(--amber)] text-sm px-3 py-2.5 font-medium">🔒 Nhập/xuất kho cần quyền thủ kho hoặc quản trị. Tài khoản nhân viên bán hàng không được ghi phiếu.</p>}
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Loại phiếu">
        {(["in", "out", "adjust"] as const).map((t) => (
          <button key={t} type="button" aria-label={MOVE_META[t]!.label} onClick={() => { setType(t); setReason(t === "in" ? IN_REASONS[0]! : t === "out" ? OUT_REASONS[0]! : "Kiểm kê định kỳ"); if (t === "adjust") setMode("single"); }}
            className={`rounded-xl py-2.5 font-semibold text-sm border ${type === t ? "bg-[var(--accent)] text-white border-transparent" : "bg-[var(--surface)] border-[var(--border)]"}`}>
            {MOVE_META[t]!.label}
          </button>
        ))}
      </div>
      {type !== "adjust" && (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Chế độ phiếu">
          <button type="button" onClick={() => setMode("single")} className={`rounded-xl py-2 font-semibold text-sm border ${mode === "single" ? "bg-[var(--accent)] text-white border-transparent" : "bg-[var(--surface)] border-[var(--border)]"}`}>1 mặt hàng</button>
          <button type="button" onClick={() => setMode("batch")} className={`rounded-xl py-2 font-semibold text-sm border ${mode === "batch" ? "bg-[var(--accent)] text-white border-transparent" : "bg-[var(--surface)] border-[var(--border)]"}`}>Nhiều mặt hàng</button>
        </div>
      )}
      {mode === "batch" ? (
        <div className="space-y-3">
          <p className="text-xs text-[var(--dim)]">Tất cả các dòng dùng chung 1 mã phiếu, 1 lý do và 1 đối tác. Bấm lại sau khi mất mạng cũng không ghi trùng nhờ mã chống trùng.</p>
          {batchLines.map((line, idx) => {
            const p = products.find((x) => x.id === line.productId);
            return (
              <div key={idx} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2">
                <div className="flex gap-2">
                  <select aria-label={`Sản phẩm dòng ${idx + 1}`} className={inputCls + " flex-1"} value={line.productId} onChange={(e) => {
                    const np = products.find((x) => x.id === Number(e.target.value));
                    const nl = [...batchLines]; nl[idx] = { ...line, productId: Number(e.target.value), unitCost: np ? (type === "out" ? np.sellPrice : np.costPrice) : line.unitCost }; setBatchLines(nl);
                  }}>
                    {products.map((x) => <option key={x.id} value={x.id}>{x.sku} · {x.name} (tồn {x.currentStock})</option>)}
                  </select>
                  {batchLines.length > 1 && <button type="button" aria-label={`Xoá dòng ${idx + 1}`} className="w-10 shrink-0 rounded-xl bg-[var(--red-soft)] text-[var(--red)] font-bold" onClick={() => setBatchLines(batchLines.filter((_, i) => i !== idx))}>×</button>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label htmlFor={`b-qty-${idx}`} className={labelCls}>Số lượng</label><input id={`b-qty-${idx}`} aria-label={`Số lượng dòng ${idx + 1}`} type="number" inputMode="numeric" min={0} className={inputCls} value={line.quantity} onChange={(e) => { const nl = [...batchLines]; nl[idx] = { ...line, quantity: Number(e.target.value) || 0 }; setBatchLines(nl); }} /></div>
                  <div><label htmlFor={`b-cost-${idx}`} className={labelCls}>Đơn giá (VNĐ)</label><input id={`b-cost-${idx}`} aria-label={`Đơn giá dòng ${idx + 1}`} type="number" inputMode="numeric" min={0} className={inputCls} value={line.unitCost} onChange={(e) => { const nl = [...batchLines]; nl[idx] = { ...line, unitCost: Number(e.target.value) || 0 }; setBatchLines(nl); }} /></div>
                </div>
                {p && type === "out" && line.quantity > p.currentStock && <p className="text-xs font-medium text-[var(--red)]">⚠ Số lượng vượt tồn ({p.currentStock} {p.unit}).</p>}
              </div>
            );
          })}
          <button type="button" className="text-sm font-semibold text-[var(--accent)]" onClick={() => { const p = products[0]; if (p) setBatchLines([...batchLines, { productId: p.id, quantity: 1, unitCost: type === "out" ? p.sellPrice : p.costPrice }]); }}>+ Thêm dòng hàng</button>
        </div>
      ) : (
        <>
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
        </>
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
        <button type="submit" disabled={mut.isPending || batchMut.isPending || !canStock} className={btnPrimary + " flex-1"}>{mut.isPending || batchMut.isPending ? "Đang ghi…" : type === "in" ? "✓ Ghi phiếu nhập" : type === "out" ? "✓ Ghi phiếu xuất" : "✓ Lưu kiểm kê"}</button>
      </div>
    </form>
  );
}

/* ---------------- Order Form ---------------- */
type OrderLine = { productId: number; quantity: number; unitPrice: number };
function OrderForm({ products, token, onClose }: { products: Product[]; token: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [status, setStatus] = useState<"pending" | "confirmed" | "reserved">("pending");
  const [note, setNote] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [deliveryPerson, setDeliveryPerson] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [reservedUntil, setReservedUntil] = useState("");
  const [lines, setLines] = useState<OrderLine[]>(products[0] ? [{ productId: products[0].id, quantity: 1, unitPrice: products[0].sellPrice }] : []);
  const [error, setError] = useState("");
  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  const mut = useMutation({
    mutationFn: () => {
      const expectedVersions: Record<string, number> = {};
      for (const l of lines) {
        const p = products.find((x) => x.id === l.productId);
        if (p) expectedVersions[String(p.id)] = p.version;
      }
      return api.createOrder({
        customerName, customerPhone, customerAddress, status, note, items: lines,
        actorToken: token || undefined, depositAmount: Number(depositAmount) || 0,
        deliveryPerson: deliveryPerson.trim() || undefined, deliveryFee: Number(deliveryFee) || 0,
        expectedDelivery: expectedDelivery || undefined, reservedUntil: reservedUntil || undefined,
        requestKey: newRequestKey(), expectedVersions,
      });
    },
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Có lỗi"); return; }
      qc.invalidateQueries(); onClose();
    },
    onError: (e) => setError(netErrMsg(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!customerName.trim()) { setError("Vui lòng nhập tên khách hàng."); return; }
    if (lines.length === 0) { setError("Đơn cần ít nhất 1 dòng hàng."); return; }
    if (status === "reserved" && !reservedUntil) { setError("Đơn giữ hàng cần nhập hạn giữ (ngày/giờ hết hạn giữ)."); return; }
    if (Number(depositAmount) > total) { setError("Tiền cọc không được lớn hơn tổng tiền đơn."); return; }
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
          <select id="o-status" aria-label="Trạng thái đơn" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as "pending" | "confirmed" | "reserved")}>
            <option value="pending">Chờ xử lý (chưa trừ kho)</option>
            <option value="confirmed">Đã xác nhận (trừ kho ngay)</option>
            <option value="reserved">Giữ hàng (trừ kho + giữ số lượng)</option>
          </select>
        </div>
        <div><label htmlFor="o-note" className={labelCls}>Ghi chú đơn</label><input id="o-note" aria-label="Ghi chú đơn" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Giao buổi sáng…" /></div>
      </div>
      {status === "reserved" && (
        <div>
          <label htmlFor="o-reserved-until" className={labelCls}>Hạn giữ hàng *</label>
          <input id="o-reserved-until" aria-label="Hạn giữ hàng" type="datetime-local" className={inputCls} value={reservedUntil} onChange={(e) => setReservedUntil(e.target.value)} />
          <p className="text-xs text-[var(--dim)] mt-1">Hàng được giữ (trừ kho, cộng số lượng đang giữ) tới thời điểm này. Hết hạn mà khách chưa lấy thì dùng “Huỷ giữ hàng” ở chi tiết đơn để hoàn kho.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="o-deposit" className={labelCls}>Tiền cọc khách đã trả (VNĐ)</label>
          <input id="o-deposit" aria-label="Tiền cọc" type="number" inputMode="numeric" min={0} className={inputCls} value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label htmlFor="o-fee" className={labelCls}>Phí giao hàng (VNĐ)</label>
          <input id="o-fee" aria-label="Phí giao hàng" type="number" inputMode="numeric" min={0} className={inputCls} value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder="0" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="o-delivery-person" className={labelCls}>Người giao hàng</label>
          <input id="o-delivery-person" aria-label="Người giao hàng" className={inputCls} value={deliveryPerson} onChange={(e) => setDeliveryPerson(e.target.value)} placeholder="Tên shipper / nhân viên giao" />
        </div>
        <div>
          <label htmlFor="o-expected" className={labelCls}>Ngày giao dự kiến</label>
          <input id="o-expected" aria-label="Ngày giao dự kiến" type="date" className={inputCls} value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center justify-between rounded-2xl bg-[var(--accent-soft)] px-4 py-3">
        <span className="font-semibold text-sm">Tổng tiền đơn</span><span className="text-xl font-extrabold tabular">{fmtVND(total)}</span>
      </div>
      {depositAmount && Number(depositAmount) > 0 && <p className="text-sm text-[var(--dim)]">Còn phải thu sau cọc: <b className="text-[var(--text)]">{fmtVND(Math.max(0, total - Number(depositAmount)))}</b></p>}
      {error && <p className="rounded-xl bg-[var(--red-soft)] text-[var(--red)] text-sm px-3 py-2.5 font-medium">{error}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className={btnGhost + " flex-1"}>Huỷ</button>
        <button type="submit" disabled={mut.isPending} className={btnPrimary + " flex-1"}>{mut.isPending ? "Đang tạo…" : "Tạo đơn hàng"}</button>
      </div>
    </form>
  );
}

/* ---------------- Trả hàng ---------------- */
function ReturnModal({ order, token, onClose }: { order: Order; token: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const mut = useMutation({
    mutationFn: () => api.createReturn({
      orderId: order.id,
      lines: order.items.filter((i) => (qtys[i.id] ?? 0) > 0).map((i) => ({ orderItemId: i.id, quantity: qtys[i.id] ?? 0 })),
      reason: reason.trim(), actorToken: token || undefined,
    }),
    onSuccess: (r) => {
      if (!r.ok) { setError(r.error ?? "Có lỗi"); return; }
      qc.invalidateQueries(); onClose();
    },
    onError: (e) => setError(netErrMsg(e)),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(""); if (order.items.every((i) => (qtys[i.id] ?? 0) <= 0)) { setError("Chọn ít nhất 1 dòng và nhập số lượng trả > 0."); return; } mut.mutate(); }} className="space-y-4">
      <p className="text-sm text-[var(--dim)]">Đơn {order.orderCode} · {order.customerName}. Hàng trả sẽ được hoàn lại kho. Không trả quá số lượng còn trả được của từng dòng.</p>
      <ul className="space-y-3">
        {order.items.map((i) => {
          const returnable = i.quantity - i.returnedQty;
          return (
            <li key={i.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <p className="text-sm font-semibold">{i.productSku} · {i.productName}</p>
              <p className="text-xs text-[var(--dim)]">Đã mua {i.quantity} · Đã trả {i.returnedQty} · Còn trả được <b className="text-[var(--text)]">{returnable}</b></p>
              <div className="mt-2 flex items-center gap-2">
                <label htmlFor={`ret-${i.id}`} className={labelCls + " mb-0"}>Số lượng trả</label>
                <input id={`ret-${i.id}`} aria-label={`Số lượng trả ${i.productName}`} type="number" inputMode="numeric" min={0} max={returnable} className={inputCls + " w-28"} value={qtys[i.id] ?? 0} disabled={returnable <= 0}
                  onChange={(e) => setQtys({ ...qtys, [i.id]: Math.max(0, Math.min(returnable, Number(e.target.value) || 0)) })} />
              </div>
            </li>
          );
        })}
      </ul>
      <div><label htmlFor="ret-reason" className={labelCls}>Lý do trả hàng</label><input id="ret-reason" aria-label="Lý do trả hàng" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Khách đổi mẫu khác, hàng lỗi…" /></div>
      {error && <p className="rounded-xl bg-[var(--red-soft)] text-[var(--red)] text-sm px-3 py-2.5 font-medium">{error}</p>}
      <div className="flex gap-3"><button type="button" onClick={onClose} className={btnGhost + " flex-1"}>Huỷ</button><button type="submit" disabled={mut.isPending} className={btnPrimary + " flex-1"}>{mut.isPending ? "Đang ghi…" : "Xác nhận trả hàng"}</button></div>
    </form>
  );
}

/* ---------------- Supplier Form ---------------- */
function SupplierForm({ supplier, token, onClose }: { supplier: Supplier | null; token: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(supplier?.name ?? "");
  const [contactPerson, setContactPerson] = useState(supplier?.contactPerson ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [error, setError] = useState("");
  const mut = useMutation({
    mutationFn: () => supplier ? api.updateSupplier({ id: supplier.id, name, contactPerson, phone, email, address, notes, actorToken: token || undefined }) : api.createSupplier({ name, contactPerson, phone, email, address, notes, actorToken: token || undefined }),
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
    onError: (e) => setError(netErrMsg(e)),
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

/* ---------------- Tab Báo cáo ---------------- */
function ReportsTab({ token }: { token: string }) {
  const [from, setFrom] = useState(daysAgoStr(29));
  const [to, setTo] = useState(todayStr());
  const q = useQuery({ queryKey: ["reports", from, to], queryFn: () => api.getReports({ from, to, actorToken: token || undefined }) });
  const r = q.data;
  return (
    <section aria-label="Báo cáo">
      <div className="flex gap-2 mb-3 items-end">
        <div className="flex-1"><label htmlFor="rep-from" className={labelCls}>Từ ngày</label><input id="rep-from" aria-label="Từ ngày" type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex-1"><label htmlFor="rep-to" className={labelCls}>Đến ngày</label><input id="rep-to" aria-label="Đến ngày" type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {q.isPending && <p className="text-center text-[var(--dim)] py-8">Đang tải báo cáo…</p>}
      {q.error && <p className="text-[var(--red)] py-8 text-center">Không tải được báo cáo. Hãy thử lại.</p>}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4"><p className="text-[13px] font-semibold text-[var(--dim)]">Doanh thu</p><p className="text-xl font-extrabold tabular mt-1">{fmtVND(r.totalRevenue)}</p><p className="text-xs text-[var(--dim)]">{r.totalOrders} đơn hoàn thành</p></div>
            <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4"><p className="text-[13px] font-semibold text-[var(--dim)]">Lãi gộp</p><p className="text-xl font-extrabold tabular mt-1 text-[var(--green)]">{fmtVND(r.totalProfit)}</p><p className="text-xs text-[var(--dim)]">Giá vốn: {fmtVND(r.totalCost)}</p></div>
          </div>
          <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 mb-4">
            <h3 className="font-bold text-[15px] mb-2">Doanh thu theo ngày</h3>
            {r.revenueByDay.length === 0 ? <p className="text-sm text-[var(--dim)]">Chưa có đơn hoàn thành trong khoảng này.</p> : (
              <ul className="divide-y divide-[var(--border)]">
                {r.revenueByDay.map((d) => (
                  <li key={d.date} className="flex justify-between py-2 text-sm gap-2"><span className="tabular font-semibold">{fmtDay(d.date)}</span><span className="tabular">Lãi {fmtVND(d.profit)}</span><span className="tabular font-bold">{fmtVND(d.revenue)}</span></li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 mb-4">
            <h3 className="font-bold text-[15px] mb-2">Top sản phẩm bán chạy</h3>
            {r.topProducts.length === 0 ? <p className="text-sm text-[var(--dim)]">Chưa có dữ liệu bán hàng.</p> : (
              <ul className="divide-y divide-[var(--border)]">
                {r.topProducts.map((p) => (
                  <li key={p.productId} className="flex justify-between py-2 text-sm gap-2"><span className="min-w-0 truncate"><span className="tabular font-semibold">{p.sku}</span> · {p.name} <span className="text-[var(--dim)]">× {fmtNum(p.qty)}</span></span><span className="tabular font-bold shrink-0">{fmtVND(p.revenue)}</span></li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 mb-4">
            <h3 className="font-bold text-[15px] mb-2">Tổng hợp công nợ</h3>
            <ul className="text-sm space-y-1.5">
              <li className="flex justify-between"><span>Phải thu (khách nợ)</span><b className="tabular">{fmtVND(r.debtSummary.receivable)}</b></li>
              <li className="flex justify-between"><span>Phải trả (nợ NCC)</span><b className="tabular">{fmtVND(r.debtSummary.payable)}</b></li>
              <li className="flex justify-between text-[var(--red)]"><span>Phải thu quá hạn</span><b className="tabular">{fmtVND(r.debtSummary.overdueReceivable)}</b></li>
              <li className="flex justify-between text-[var(--red)]"><span>Phải trả quá hạn</span><b className="tabular">{fmtVND(r.debtSummary.overduePayable)}</b></li>
            </ul>
          </div>
          <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
            <h3 className="font-bold text-[15px] mb-2">Hàng sắp hết ({r.lowStock.length})</h3>
            {r.lowStock.length === 0 ? <p className="text-sm text-[var(--dim)]">Không có mặt hàng nào dưới mức tối thiểu.</p> : (
              <ul className="divide-y divide-[var(--border)]">
                {r.lowStock.map((p) => <li key={p.id} className="flex justify-between py-2 text-sm gap-2"><span className="min-w-0 truncate"><span className="tabular font-semibold">{p.sku}</span> · {p.name}</span><span className="tabular font-bold shrink-0">{fmtNum(p.currentStock)} / tối thiểu {p.minStock}</span></li>)}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ---------------- Tab Công nợ ---------------- */
function DebtsTab({ token }: { token: string }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"all" | "receivable" | "payable">("all");
  const [payDebtId, setPayDebtId] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Tiền mặt");
  const [payNote, setPayNote] = useState("");
  const [msg, setMsg] = useState("");
  const q = useQuery({ queryKey: ["debts", kind], queryFn: () => api.listDebts({ kind, actorToken: token || undefined }) });
  const debts = q.data?.debts ?? [];
  const today = todayStr();
  const payMut = useMutation({
    mutationFn: (v: { debtId: number; amount: number }) => api.recordDebtPayment({ debtId: v.debtId, amount: v.amount, method: payMethod, note: payNote, actorToken: token || undefined }),
    onSuccess: (r) => {
      if (!r.ok) { setMsg(r.error ?? "Không ghi được thanh toán."); return; }
      setMsg(`Đã ghi thanh toán. Còn lại: ${fmtVND(r.remaining)}`);
      setPayDebtId(null); setPayAmount(""); setPayNote("");
      qc.invalidateQueries();
    },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  return (
    <section aria-label="Công nợ">
      <div className="flex gap-2 mb-3">
        {([["all", "Tất cả"], ["receivable", "Phải thu"], ["payable", "Phải trả"]] as const).map(([v, l]) => (
          <button key={v} aria-label={`Lọc công nợ: ${l}`} onClick={() => setKind(v)} className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold border ${kind === v ? "bg-[var(--accent)] text-white border-transparent" : "bg-[var(--surface)] border-[var(--border)]"}`}>{l}</button>
        ))}
        <button aria-label="Xuất CSV công nợ" className={btnGhost + " shrink-0 !px-3"} onClick={() => downloadCsv(`cong-no-${today}.csv`, ["Đối tác", "Loại", "Kiểu", "Tổng tiền", "Đã trả", "Còn lại", "Hạn trả", "Mã tham chiếu", "Trạng thái"], debts.map((d) => [d.partnerName, d.partnerType, d.kind === "receivable" ? "Phải thu" : "Phải trả", d.totalAmount, d.paidAmount, d.remaining, d.dueDate, d.refCode, d.status]))}>⬇ CSV</button>
      </div>
      {msg && <p className="rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] text-sm px-3 py-2.5 font-medium mb-3">{msg}</p>}
      {q.isPending && <p className="text-center text-[var(--dim)] py-8">Đang tải công nợ…</p>}
      {q.data && debts.length === 0 && <div className="rounded-2xl bg-[var(--surface)] border border-dashed border-[var(--border)] p-6 text-center"><p className="font-semibold">Chưa có khoản công nợ nào</p><p className="text-sm text-[var(--dim)] mt-1">Công nợ phải thu tự sinh khi đơn hoàn thành còn dư chưa thanh toán.</p></div>}
      <ul className="space-y-3">
        {debts.map((d) => {
          const overdue = d.status !== "paid" && d.dueDate !== "" && d.dueDate < today;
          return (
            <li key={d.id} className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold">{d.partnerName}</p>
                  <p className="text-[13px] text-[var(--dim)]">{d.kind === "receivable" ? "Phải thu" : "Phải trả"}{d.refCode ? ` · ${d.refCode}` : ""}{d.dueDate ? ` · Hạn: ${fmtDay(d.dueDate)}` : ""}</p>
                  {d.note && <p className="text-[13px] text-[var(--dim)]">{d.note}</p>}
                </div>
                <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${d.status === "paid" ? "bg-[var(--green-soft)] text-[var(--green)]" : d.status === "cancelled" ? "bg-[var(--surface2)] text-[var(--dim)]" : overdue ? "bg-[var(--red-soft)] text-[var(--red)]" : "bg-[var(--amber-soft)] text-[var(--amber)]"}`}>{d.status === "paid" ? "Đã trả đủ" : d.status === "cancelled" ? "Đã hủy" : overdue ? "⚠ Quá hạn" : "Còn nợ"}</span>
              </div>
              <p className="mt-2 text-sm">Tổng: <b className="tabular">{fmtVND(d.totalAmount)}</b> · Đã trả: <span className="tabular">{fmtVND(d.paidAmount)}</span> · Còn lại: <b className="tabular">{fmtVND(d.remaining)}</b></p>
              {d.status !== "paid" && d.status !== "cancelled" && (
                payDebtId === d.id ? (
                  <div className="mt-3 space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div><label htmlFor={`pay-amt-${d.id}`} className={labelCls}>Số tiền trả</label><input id={`pay-amt-${d.id}`} aria-label="Số tiền trả" type="number" inputMode="numeric" min={1} max={d.remaining} className={inputCls} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={String(d.remaining)} /></div>
                      <div><label htmlFor={`pay-method-${d.id}`} className={labelCls}>Hình thức</label><select id={`pay-method-${d.id}`} aria-label="Hình thức thanh toán" className={inputCls} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}><option>Tiền mặt</option><option>Chuyển khoản</option><option>Quẹt thẻ</option><option>Khác</option></select></div>
                    </div>
                    <div><label htmlFor={`pay-note-${d.id}`} className={labelCls}>Ghi chú</label><input id={`pay-note-${d.id}`} aria-label="Ghi chú thanh toán" className={inputCls} value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="VD: Thu tiền mặt tại cửa hàng" /></div>
                    <div className="flex gap-2">
                      <button className={btnGhost + " flex-1"} onClick={() => setPayDebtId(null)}>Huỷ</button>
                      <button className={btnPrimary + " flex-1"} disabled={payMut.isPending} onClick={() => { const amt = Number(payAmount); if (!amt || amt <= 0) { setMsg("Nhập số tiền trả lớn hơn 0."); return; } if (amt > d.remaining) { setMsg(`Số tiền trả không được vượt còn lại (${fmtVND(d.remaining)}).`); return; } payMut.mutate({ debtId: d.id, amount: amt }); }}>{payMut.isPending ? "Đang ghi…" : "Ghi thanh toán"}</button>
                    </div>
                  </div>
                ) : (
                  <button className="mt-3 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] font-bold text-[13px] px-4 py-2" onClick={() => { setPayDebtId(d.id); setPayAmount(String(d.remaining)); setMsg(""); }}>Ghi thanh toán</button>
                )
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------- Tab Kiểm kê ---------------- */
function StocktakesTab({ token, products, canStock, isAdmin }: { token: string; products: Product[]; canStock: boolean; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [closeResult, setCloseResult] = useState<{ id: number; diffs: { productSku: string; productName: string; systemQty: number; countedQty: number; diff: number; systemQtyAtCount: number; systemQtyAtClose: number; appliedDiff: number }[] } | null>(null);
  const [reconDiffs, setReconDiffs] = useState<{ productId: number; sku: string; name: string; systemStock: number; calculatedStock: number; diff: number }[] | null>(null);
  const [reconApplied, setReconApplied] = useState(false);
  const [addProductId, setAddProductId] = useState(products[0]?.id ?? 0);
  const [addQty, setAddQty] = useState("");
  const [addNote, setAddNote] = useState("");
  const [editQty, setEditQty] = useState<Record<number, string>>({});
  const q = useQuery({ queryKey: ["stocktakes"], queryFn: () => api.listStocktakes({ actorToken: token || undefined }) });
  const createMut = useMutation({
    mutationFn: () => api.createStocktake({ note: note.trim(), actorToken: token || undefined }),
    onSuccess: (r) => { if (!r.ok) { setMsg(r.error ?? "Không tạo được đợt kiểm kê."); return; } setNote(""); setMsg(`Đã tạo đợt kiểm kê ${r.code}.`); qc.invalidateQueries(); },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  const saveMut = useMutation({
    mutationFn: (v: { stocktakeId: number; productId: number; countedQty: number; note: string }) => api.saveStocktakeItem({ ...v, actorToken: token || undefined }),
    onSuccess: (r) => { if (!r.ok) { setMsg(r.error ?? "Không lưu được số đếm."); return; } setMsg("Đã lưu số đếm (nháp)."); qc.invalidateQueries(); },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  const closeMut = useMutation({
    mutationFn: (id: number) => api.closeStocktake({ stocktakeId: id, actorToken: token || undefined }),
    onSuccess: (r, id) => {
      if (!r.ok) { setMsg(r.error ?? "Không chốt được đợt kiểm kê."); return; }
      setCloseResult({ id, diffs: r.diffs });
      setMsg(`Đã chốt đợt kiểm kê. ${r.diffs.length} mặt hàng chênh lệch — đã sinh phiếu điều chỉnh.`);
      qc.invalidateQueries();
    },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  const reconMut = useMutation({
    mutationFn: (apply: boolean) => api.reconcileStock({ apply, actorToken: token || undefined }),
    onSuccess: (r) => {
      if (!r.ok) { setMsg(r.error ?? "Không đối chiếu được."); return; }
      setReconDiffs(r.diffs); setReconApplied(r.applied);
      setMsg(r.applied ? "Đã chốt lại tồn kho theo sổ phiếu." : r.diffs.length === 0 ? "Tồn kho khớp với sổ phiếu, không có chênh lệch." : `Tìm thấy ${r.diffs.length} mặt hàng lệch so với sổ phiếu.`);
      if (r.applied) qc.invalidateQueries();
    },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  return (
    <section aria-label="Kiểm kê">
      {!canStock && <p className="rounded-xl bg-[var(--amber-soft)] text-[var(--amber)] text-sm px-3 py-2.5 font-medium mb-3">🔒 Kiểm kê cần quyền thủ kho hoặc quản trị. Tài khoản nhân viên bán hàng chỉ xem được danh sách.</p>}
      <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 mb-4">
        <h3 className="font-bold text-[15px] mb-2">Đối chiếu tồn kho với sổ phiếu</h3>
        <p className="text-sm text-[var(--dim)] mb-3">Tính lại tồn từng sản phẩm từ phiếu nhập/xuất/kiểm kê và so với tồn hệ thống.</p>
        <div className="flex gap-2">
          <button className={btnGhost} disabled={reconMut.isPending} onClick={() => reconMut.mutate(false)}>{reconMut.isPending ? "Đang đối chiếu…" : "Đối chiếu tồn kho"}</button>
          {isAdmin && reconDiffs && reconDiffs.length > 0 && !reconApplied && (
            <button className="rounded-xl bg-[var(--red)] text-white font-semibold px-4 py-2.5 disabled:opacity-50" disabled={reconMut.isPending}
              onClick={() => { if (window.confirm(`Chốt lại tồn của ${reconDiffs.length} mặt hàng theo sổ phiếu? Tồn hệ thống sẽ bị ghi đè.`)) reconMut.mutate(true); }}>Chốt lại tồn theo sổ phiếu</button>
          )}
        </div>
        {!isAdmin && <p className="text-xs text-[var(--dim)] mt-2">Nút “Chốt lại tồn theo sổ phiếu” chỉ quản trị viên mới thấy (cần quyền quản trị).</p>}
        {reconDiffs && (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {reconDiffs.length === 0 ? <li className="text-sm text-[var(--green)] font-medium py-1">✓ Không có chênh lệch.</li> : reconDiffs.map((d) => (
              <li key={d.productId} className="flex justify-between py-2 text-sm gap-2"><span className="min-w-0 truncate"><span className="tabular font-semibold">{d.sku}</span> · {d.name}</span><span className="tabular shrink-0">Hệ thống {fmtNum(d.systemStock)} · Sổ phiếu {fmtNum(d.calculatedStock)} · Lệch {d.diff > 0 ? "+" : ""}{fmtNum(d.diff)}</span></li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex gap-2 mb-3">
        <input aria-label="Ghi chú đợt kiểm kê" className={inputCls + " flex-1"} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú đợt kiểm kê (VD: Kiểm kê cuối tháng)…" disabled={!canStock} />
        <button className={btnPrimary + " shrink-0"} disabled={!canStock || createMut.isPending} onClick={() => createMut.mutate()}>{createMut.isPending ? "Đang tạo…" : "+ Tạo đợt"}</button>
      </div>
      {msg && <p className="rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] text-sm px-3 py-2.5 font-medium mb-3">{msg}</p>}
      {q.isPending && <p className="text-center text-[var(--dim)] py-8">Đang tải đợt kiểm kê…</p>}
      <ul className="space-y-3">
        {q.data?.stocktakes.map((st) => {
          const open = expanded === st.id;
          const result = closeResult?.id === st.id ? closeResult.diffs : null;
          return (
            <li key={st.id} className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
              <button className="w-full text-left" onClick={() => setExpanded(open ? null : st.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-bold">{st.code}{st.note ? ` · ${st.note}` : ""}</p><p className="text-[13px] text-[var(--dim)]">{fmtDate(st.createdAt)} · {st.createdBy} · {st.items.length} mặt hàng đã đếm</p></div>
                  <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${st.status === "closed" ? "bg-[var(--green-soft)] text-[var(--green)]" : "bg-[var(--amber-soft)] text-[var(--amber)]"}`}>{st.status === "closed" ? "Đã chốt" : "Nháp"}</span>
                </div>
              </button>
              {open && (
                <div className="mt-3 pt-3 border-t border-[var(--border)]">
                  {st.items.length > 0 && (
                    <ul className="space-y-2 mb-3">
                      {st.items.map((it) => (
                        <li key={it.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate"><span className="tabular font-semibold">{it.productSku}</span> · {it.productName} <span className="text-[var(--dim)]">· Sổ: {it.systemQty}</span></span>
                          {st.status === "draft" && canStock ? (
                            <span className="flex items-center gap-1 shrink-0">
                              <input aria-label={`Số đếm ${it.productName}`} type="number" inputMode="numeric" min={0} className="w-20 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5" value={editQty[it.productId] ?? String(it.countedQty)} onChange={(e) => setEditQty({ ...editQty, [it.productId]: e.target.value })} />
                              <button className="rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] font-bold text-xs px-2.5 py-1.5" disabled={saveMut.isPending} onClick={() => saveMut.mutate({ stocktakeId: st.id, productId: it.productId, countedQty: Number(editQty[it.productId] ?? it.countedQty) || 0, note: it.note })}>Lưu</button>
                            </span>
                          ) : (
                            <span className="tabular font-bold shrink-0">Đếm: {it.countedQty} · Lệch {it.diffQty > 0 ? "+" : ""}{it.diffQty}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {st.status === "draft" && canStock && (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2 mb-3">
                      <p className="text-[13px] font-semibold text-[var(--dim)]">Thêm mặt hàng vào đợt</p>
                      <select aria-label="Sản phẩm kiểm kê" className={inputCls} value={addProductId} onChange={(e) => setAddProductId(Number(e.target.value))}>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name} (sổ: {p.currentStock})</option>)}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        <input aria-label="Số đếm thực tế" type="number" inputMode="numeric" min={0} className={inputCls} value={addQty} onChange={(e) => setAddQty(e.target.value)} placeholder="Số đếm thực tế" />
                        <input aria-label="Ghi chú dòng kiểm kê" className={inputCls} value={addNote} onChange={(e) => setAddNote(e.target.value)} placeholder="Ghi chú (không bắt buộc)" />
                      </div>
                      <button className={btnPrimary + " w-full"} disabled={saveMut.isPending || !addProductId || addQty === ""} onClick={() => { saveMut.mutate({ stocktakeId: st.id, productId: addProductId, countedQty: Number(addQty) || 0, note: addNote }); setAddQty(""); setAddNote(""); }}>Lưu số đếm (nháp)</button>
                    </div>
                  )}
                  {result && (
                    <div className="rounded-2xl bg-[var(--amber-soft)] p-3 mb-3">
                      <p className="font-bold text-sm mb-1">Chênh lệch sau khi chốt:</p>
                      {result.length === 0 ? <p className="text-sm">Không có chênh lệch.</p> : result.map((d, i) => <p key={i} className="text-sm">· {d.productSku} {d.productName}: sổ lúc đếm {d.systemQtyAtCount} · đếm {d.countedQty} · sổ lúc chốt {d.systemQtyAtClose} · điều chỉnh {d.appliedDiff > 0 ? "+" : ""}{d.appliedDiff}</p>)}
                    </div>
                  )}
                  {st.status === "draft" && canStock && (
                    <button className={btnPrimary + " w-full"} disabled={closeMut.isPending} onClick={() => { if (window.confirm(`Chốt đợt ${st.code}? Hệ thống sẽ sinh phiếu điều chỉnh cho các mặt hàng chênh lệch và không sửa được nữa.`)) closeMut.mutate(st.id); }}>{closeMut.isPending ? "Đang chốt…" : "✓ Chốt đợt kiểm kê"}</button>
                  )}
                  {st.status === "closed" && <p className="text-sm text-[var(--dim)]">Đã chốt {st.closedAt ? fmtDate(st.closedAt) : ""} — phiếu điều chỉnh đã được sinh cho các mặt hàng chênh lệch.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {q.data && q.data.stocktakes.length === 0 && <div className="rounded-2xl bg-[var(--surface)] border border-dashed border-[var(--border)] p-6 text-center"><p className="font-semibold">Chưa có đợt kiểm kê nào</p><p className="text-sm text-[var(--dim)] mt-1">Tạo đợt, nhập số đếm thực tế từng mặt hàng rồi chốt để sinh phiếu điều chỉnh.</p></div>}
    </section>
  );
}

/* ---------------- Tab Lịch sử (audit log) ---------------- */
function HistoryTab({ token }: { token: string }) {
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useQuery({ queryKey: ["auditLogs", actor, from, to], queryFn: () => api.listAuditLogs({ actor, from, to, limit: 200, actorToken: token || undefined }) });
  const logs = q.data?.logs ?? [];
  function shortDetails(d: string): string {
    try {
      const obj = JSON.parse(d) as Record<string, unknown>;
      const parts = Object.entries(obj).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
      const s = parts.join(" · ");
      return s.length > 160 ? s.slice(0, 160) + "…" : s;
    } catch {
      return d.length > 160 ? d.slice(0, 160) + "…" : d;
    }
  }
  return (
    <section aria-label="Lịch sử thao tác">
      <div className="flex gap-2 mb-3">
        <input aria-label="Lọc theo tên người thao tác" className={inputCls + " flex-1"} value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Tên người thao tác…" />
      </div>
      <div className="flex gap-2 mb-3">
        <div className="flex-1"><label htmlFor="audit-from" className={labelCls}>Từ ngày</label><input id="audit-from" aria-label="Từ ngày" type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex-1"><label htmlFor="audit-to" className={labelCls}>Đến ngày</label><input id="audit-to" aria-label="Đến ngày" type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <button aria-label="Xuất CSV lịch sử" className={btnGhost + " self-end shrink-0 !px-3"} onClick={() => downloadCsv(`lich-su-${todayStr()}.csv`, ["Thời gian", "Người thao tác", "Hành động", "Đối tượng", "ID đối tượng", "Chi tiết"], logs.map((l) => [l.createdAt, l.actor, l.action, l.entity, l.entityId, l.details]))}>⬇ CSV</button>
      </div>
      {q.isPending && <p className="text-center text-[var(--dim)] py-8">Đang tải lịch sử…</p>}
      {q.data && logs.length === 0 && <div className="rounded-2xl bg-[var(--surface)] border border-dashed border-[var(--border)] p-6 text-center"><p className="font-semibold">Chưa có thao tác nào khớp bộ lọc</p></div>}
      <ul className="space-y-2">
        {logs.map((l) => (
          <li key={l.id} className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-3">
            <div className="flex justify-between gap-2 text-sm"><span className="font-bold">{l.action} <span className="font-medium text-[var(--dim)]">· {l.entity} #{l.entityId}</span></span><span className="text-[var(--dim)] tabular shrink-0">{fmtDate(l.createdAt)}</span></div>
            <p className="text-sm text-[var(--dim)] mt-0.5">👤 {l.actor}</p>
            {l.details && l.details !== "{}" && <p className="text-[13px] mt-1 break-words">{shortDetails(l.details)}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Tab Nhân viên & Sao lưu (chỉ admin) ---------------- */
function AdminTab({ token, staff }: { token: string; staff: StaffInfo }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "storekeeper" | "sales">("sales");
  const [newPin, setNewPin] = useState("");
  const [restoreId, setRestoreId] = useState<number | null>(null);
  const [restoreCode, setRestoreCode] = useState("");
  const staffQ = useQuery({ queryKey: ["staff"], queryFn: () => api.listStaff({ actorToken: token || undefined }) });
  const backupsQ = useQuery({ queryKey: ["backups"], queryFn: () => api.listBackups({ actorToken: token || undefined }) });
  const createStaffMut = useMutation({
    mutationFn: () => api.createStaff({ name: newName.trim(), role: newRole, pin: newPin, actorToken: token || undefined }),
    onSuccess: (r) => { if (!r.ok) { setMsg(r.error ?? "Không tạo được nhân viên."); return; } setMsg(`Đã tạo nhân viên ${newName.trim()} (${roleLabel(newRole)}).`); setNewName(""); setNewPin(""); qc.invalidateQueries(); },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  const activeMut = useMutation({
    mutationFn: (v: { id: number; active: number }) => api.setStaffActive({ ...v, actorToken: token || undefined }),
    onSuccess: (r) => { if (!r.ok) { setMsg(r.error ?? "Không đổi được trạng thái."); return; } qc.invalidateQueries(); },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  const snapshotMut = useMutation({
    mutationFn: async () => {
      const snap = await api.createBackupSnapshot({ actorToken: token || undefined });
      if (!snap.ok) return { ok: false as const, error: snap.error };
      const exp = await api.exportBackup({ actorToken: token || undefined });
      if (!exp.ok) return { ok: false as const, error: exp.error };
      return { ok: true as const, id: snap.id, size: snap.size, data: exp.data, note: exp.note };
    },
    onSuccess: (r) => {
      if (!r.ok) { setMsg(r.error ?? "Không tạo được sao lưu."); return; }
      downloadBlob(new Blob([r.data], { type: "application/json;charset=utf-8" }), `sao-luu-kho-${todayStr()}.json`);
      setMsg(`Đã tạo snapshot sao lưu #${r.id} (${fmtNum(r.size)} byte) và tải file JSON về máy. ` + (r.note || ""));
      qc.invalidateQueries();
    },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  const exportMut = useMutation({
    mutationFn: () => api.exportBackup({ actorToken: token || undefined }),
    onSuccess: (r) => {
      if (!r.ok) { setMsg(r.error ?? "Không xuất được sao lưu."); return; }
      downloadBlob(new Blob([r.data], { type: "application/json;charset=utf-8" }), `sao-luu-kho-${todayStr()}.json`);
      setMsg("Đã tải file sao lưu JSON về máy. " + (r.note || ""));
    },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  const restoreMut = useMutation({
    mutationFn: (backupId: number) => api.restoreBackup({ backupId, actorToken: token || undefined }),
    onSuccess: (r) => {
      if (!r.ok) { setMsg(r.error ?? "Không khôi phục được."); return; }
      setMsg("Đã khôi phục dữ liệu từ bản sao lưu. Vui lòng tải lại trang.");
      setRestoreId(null); setRestoreCode("");
      qc.invalidateQueries();
    },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  return (
    <section aria-label="Nhân viên và sao lưu">
      {msg && <p className="rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] text-sm px-3 py-2.5 font-medium mb-3">{msg}</p>}
      <h3 className="font-bold text-lg mb-3">Nhân viên</h3>
      {staffQ.data?.error && <p className="rounded-xl bg-[var(--red-soft)] text-[var(--red)] text-sm px-3 py-2.5 font-medium mb-3">{staffQ.data.error}</p>}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 mb-3 space-y-3">
        <div><label htmlFor="st-name" className={labelCls}>Tên nhân viên *</label><input id="st-name" aria-label="Tên nhân viên" className={inputCls} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="VD: Nguyễn Văn A" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="st-role" className={labelCls}>Vai trò</label><select id="st-role" aria-label="Vai trò" className={inputCls} value={newRole} onChange={(e) => setNewRole(e.target.value as "admin" | "storekeeper" | "sales")}><option value="admin">Quản trị viên</option><option value="storekeeper">Thủ kho</option><option value="sales">Nhân viên bán hàng</option></select></div>
          <div><label htmlFor="st-pin" className={labelCls}>Mã PIN (4–8 số)</label><input id="st-pin" aria-label="Mã PIN nhân viên mới" type="password" inputMode="numeric" autoComplete="off" className={inputCls} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••" /></div>
        </div>
        <button className={btnPrimary + " w-full"} disabled={createStaffMut.isPending} onClick={() => { if (!newName.trim()) { setMsg("Nhập tên nhân viên."); return; } if (!/^\d{4,8}$/.test(newPin)) { setMsg("Mã PIN phải gồm 4–8 chữ số."); return; } createStaffMut.mutate(); }}>{createStaffMut.isPending ? "Đang tạo…" : "+ Tạo nhân viên"}</button>
      </div>
      <ul className="space-y-2 mb-8">
        {staffQ.data?.staff.map((s) => (
          <li key={s.id} className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 flex items-center justify-between gap-2">
            <div><p className="font-bold">{s.name}{s.id === staff.id ? " (bạn)" : ""}</p><p className="text-[13px] text-[var(--dim)]">{roleLabel(s.role)}{s.mustChangePin === 1 ? " · Chưa đổi PIN lần đầu" : ""}</p></div>
            <button className={`rounded-lg font-bold text-[13px] px-4 py-2 ${s.active === 1 ? "bg-[var(--red-soft)] text-[var(--red)]" : "bg-[var(--green-soft)] text-[var(--green)]"}`} disabled={activeMut.isPending} onClick={() => activeMut.mutate({ id: s.id, active: s.active === 1 ? 0 : 1 })}>{s.active === 1 ? "Vô hiệu hoá" : "Kích hoạt lại"}</button>
          </li>
        ))}
      </ul>

      <h3 className="font-bold text-lg mb-3">Sao lưu & khôi phục</h3>
      <p className="text-sm text-[var(--dim)] mb-3 leading-relaxed">Sao lưu tự động theo phiên mở app: mỗi ngày, lần đăng nhập đầu tiên, app tự tạo snapshot nếu snapshot mới nhất đã quá 24 giờ. Bản sao lưu <b className="text-[var(--text)]">không bao gồm mã PIN</b> nhân viên — khi khôi phục, nhân viên đã có giữ nguyên PIN hiện tại, nhân viên mới được đặt PIN mặc định 123456 và bắt buộc đổi khi đăng nhập lần đầu.</p>
      <div className="flex gap-2 mb-3">
        <button className={btnPrimary + " flex-1"} disabled={snapshotMut.isPending} onClick={() => snapshotMut.mutate()}>{snapshotMut.isPending ? "Đang sao lưu…" : "💾 Sao lưu ngay"}</button>
        <button className={btnGhost + " flex-1"} disabled={exportMut.isPending} onClick={() => exportMut.mutate()}>{exportMut.isPending ? "Đang xuất…" : "⬇ Tải file JSON"}</button>
      </div>
      <ul className="space-y-2">
        {backupsQ.data?.backups.map((b) => (
          <li key={b.id} className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4">
            <div className="flex items-center justify-between gap-2">
              <div><p className="font-bold">Snapshot #{b.id}</p><p className="text-[13px] text-[var(--dim)]">{fmtDate(b.createdAt)} · {b.createdBy} · {fmtNum(b.sizeBytes)} byte</p></div>
              <button className="rounded-lg bg-[var(--red-soft)] text-[var(--red)] font-bold text-[13px] px-4 py-2" onClick={() => { setRestoreId(b.id); setRestoreCode(""); }}>Khôi phục</button>
            </div>
            {restoreId === b.id && (
              <div className="mt-3 rounded-2xl border border-[var(--red)]/40 bg-[var(--red-soft)] p-3 space-y-2">
                <p className="text-sm font-bold text-[var(--red)]">⚠ Khôi phục sẽ ghi đè toàn bộ dữ liệu hiện tại bằng snapshot #{b.id}. Hành động này không hoàn tác được.</p>
                <p className="text-sm">Để xác nhận, nhập đúng mã <b>KHOI PHUC</b> vào ô bên dưới rồi bấm “Xác nhận khôi phục”.</p>
                <input aria-label="Mã xác nhận khôi phục" className={inputCls} value={restoreCode} onChange={(e) => setRestoreCode(e.target.value)} placeholder="KHOI PHUC" />
                <div className="flex gap-2">
                  <button className={btnGhost + " flex-1"} onClick={() => { setRestoreId(null); setRestoreCode(""); }}>Huỷ</button>
                  <button className="flex-1 rounded-xl bg-[var(--red)] text-white font-semibold px-4 py-2.5 disabled:opacity-50" disabled={restoreCode !== "KHOI PHUC" || restoreMut.isPending} onClick={() => restoreMut.mutate(b.id)}>{restoreMut.isPending ? "Đang khôi phục…" : "Xác nhận khôi phục"}</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {backupsQ.data && backupsQ.data.backups.length === 0 && <p className="text-sm text-[var(--dim)]">Chưa có snapshot nào. Bấm “Sao lưu ngay” để tạo bản đầu tiên.</p>}
    </section>
  );
}

/* ---------------- Khoản hoàn kho chờ xử lý (Tổng quan) ---------------- */
function PendingRestockBox({ products, token }: { products: Product[]; token: string }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const q = useQuery({ queryKey: ["pendingRestocks"], queryFn: () => api.getPendingRestocks({ actorToken: token || undefined }) });
  const mut = useMutation({
    mutationFn: (v: { id: number; productId?: number }) => api.resolvePendingRestock({ id: v.id, productId: v.productId, actorToken: token || undefined }),
    onSuccess: (r) => { if (!r.ok) { setMsg(r.error ?? "Không xử lý được."); return; } setMsg("Đã hoàn kho cho khoản chờ xử lý."); qc.invalidateQueries(); },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  const items = q.data?.items.filter((i) => i.status === "pending") ?? [];
  if (q.isPending || items.length === 0) return null;
  return (
    <div className="rounded-2xl border border-[var(--red)]/40 bg-[var(--red-soft)] p-4 mb-4">
      <h3 className="font-bold text-[15px]">⚠ {items.length} khoản hoàn kho chờ xử lý</h3>
      <p className="text-sm text-[var(--dim)] mt-1">Sản phẩm bị xoá/ngưng khi huỷ đơn nên kho chưa hoàn được. Thêm lại sản phẩm đúng mã SKU rồi bấm “Đối chiếu” để hoàn kho.</p>
      {msg && <p className="text-sm font-medium mt-2">{msg}</p>}
      <ul className="mt-2 space-y-2">
        {items.map((it) => {
          const match = products.find((p) => p.sku === it.productSku);
          const chosen = sel[it.id] ?? (match ? String(match.id) : "");
          return (
            <li key={it.id} className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-3">
              <p className="text-sm font-semibold">{it.productSku} · {it.productName} — {it.quantity} cái</p>
              <p className="text-xs text-[var(--dim)]">Đơn {it.orderCode} · {it.reason} · {fmtDate(it.createdAt)}</p>
              <div className="flex gap-2 mt-2">
                <select aria-label={`Sản phẩm đối chiếu cho ${it.productSku}`} className={inputCls + " flex-1"} value={chosen} onChange={(e) => setSel({ ...sel, [it.id]: e.target.value })}>
                  <option value="">— Chọn sản phẩm trùng SKU —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                </select>
                <button className={btnPrimary + " shrink-0"} disabled={mut.isPending || !chosen} onClick={() => mut.mutate({ id: it.id, productId: Number(chosen) })}>Đối chiếu</button>
              </div>
              {!match && <p className="text-xs font-medium text-[var(--amber)] mt-1">Chưa có sản phẩm nào trùng SKU {it.productSku} trong kho — hãy thêm lại sản phẩm với đúng mã này trước.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------- Nhập CSV sản phẩm ---------------- */
function CsvImportBox({ token }: { token: string }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<{ imported: number; errors: { line: number; error: string }[] } | null>(null);
  const [msg, setMsg] = useState("");
  const mut = useMutation({
    mutationFn: (csv: string) => api.importProductsCsv({ csv, actorToken: token || undefined }),
    onSuccess: (r) => { setResult({ imported: r.imported, errors: r.errors }); setMsg(r.ok ? `Đã nhập ${r.imported} sản phẩm.` : "Nhập CSV có lỗi — xem bảng lỗi bên dưới."); qc.invalidateQueries(); },
    onError: (e) => setMsg(netErrMsg(e)),
  });
  return (
    <div className="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 mb-4">
      <h3 className="font-bold text-[15px] mb-1">Nhập sản phẩm từ file CSV</h3>
      <p className="text-sm text-[var(--dim)] mb-3">Cột: sku, tên, danh mục, hãng, đơn vị, giá nhập, giá bán, tồn đầu, tồn tối thiểu, vị trí.</p>
      <div className="flex gap-2">
        <label className={btnGhost + " flex-1 text-center cursor-pointer"}>📂 Chọn file .csv
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setResult(null); setMsg(""); try { mut.mutate(await f.text()); } catch (err) { setMsg(netErrMsg(err)); } e.target.value = ""; }} />
        </label>
        <button className={btnGhost + " flex-1"} onClick={() => downloadBlob(new Blob(["\uFEFF" + CSV_SAMPLE], { type: "text/csv;charset=utf-8" }), "mau-nhap-san-pham.csv")}>⬇ Tải file mẫu</button>
      </div>
      {mut.isPending && <p className="text-sm text-[var(--dim)] mt-2">Đang nhập…</p>}
      {msg && <p className="text-sm font-medium mt-2">{msg}</p>}
      {result && (
        <div className="mt-2">
          <p className="text-sm">Nhập được: <b>{result.imported}</b> dòng · Lỗi: <b>{result.errors.length}</b> dòng</p>
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
              {result.errors.map((e, i) => <li key={i} className="text-sm text-[var(--red)]">Dòng {e.line}: {e.error}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Main App ---------------- */
export function App() {
  const qc = useQueryClient();
  const [staff, setStaff] = useState<StaffInfo | null>(() => loadStaff());
  const [needPinChange, setNeedPinChange] = useState(() => (loadStaff()?.mustChangePin ?? 0) === 1);
  const [loginPin, setLoginPin] = useState("");
  const token = loadToken();
  const isAdmin = isAdminRole(staff);
  const canStock = canStockRole(staff);

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
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [returnOrder, setReturnOrder] = useState<Order | null>(null);
  const [depositFor, setDepositFor] = useState<number | null>(null);
  const [depositAmt, setDepositAmt] = useState("");
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [cpOld, setCpOld] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpConfirm, setCpConfirm] = useState("");
  const [cpErr, setCpErr] = useState("");
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let active = true;
    const probe = async () => {
      try { const r = await fetch("/health", { cache: "no-store", signal: AbortSignal.timeout(3000) }); if (active) setOnline(r.ok); }
      catch { if (active) setOnline(false); }
    };
    void probe();
    const timer = window.setInterval(() => { void probe(); }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const [toast, setToast] = useState("");
  function alertMsg(m: string) { setToast(m); setTimeout(() => setToast(""), 5500); }

  // Tự động sao lưu theo phiên mở app: 1 lần/ngày sau đăng nhập, nếu snapshot mới nhất quá 24h.
  const autoBackupRef = useRef(false);
  useEffect(() => {
    if (!staff || autoBackupRef.current) return;
    autoBackupRef.current = true;
    const today = todayStr();
    if (sessionStorage.getItem("autoBackupDate") === today) return;
    (async () => {
      try {
        const list = await api.listBackups({ actorToken: token || undefined });
        const newest = list.backups.reduce((acc, b) => (!acc || b.createdAt > acc.createdAt ? b : acc), null as { createdAt: string } | null);
        const stale = !newest || Date.now() - new Date(newest.createdAt).getTime() > 24 * 3600 * 1000;
        if (stale) {
          const r = await api.createBackupSnapshot({ actorToken: token || undefined });
          if (r.ok) { sessionStorage.setItem("autoBackupDate", today); alertMsg("Đã tự động sao lưu"); }
        } else {
          sessionStorage.setItem("autoBackupDate", today);
        }
      } catch { /* sao lưu tự động lỗi thì bỏ qua, không chặn app */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff]);

  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api.getDashboard({ actorToken: token || undefined }), enabled: !!staff && !needPinChange });
  const productsQ = useQuery({ queryKey: ["products", prodSearch, prodCat, prodStock], queryFn: () => api.listProducts({ search: prodSearch, category: prodCat, stockFilter: prodStock, actorToken: token || undefined }), enabled: !!staff && !needPinChange });
  const allProductsQ = useQuery({ queryKey: ["products-all"], queryFn: () => api.listProducts({ search: "", category: "", stockFilter: "all", actorToken: token || undefined }), enabled: !!staff && !needPinChange });
  const movementsQ = useQuery({ queryKey: ["movements", moveType, moveSearch], queryFn: () => api.listMovements({ type: moveType, search: moveSearch, limit: 200, actorToken: token || undefined }), enabled: !!staff && !needPinChange });
  const ordersQ = useQuery({ queryKey: ["orders", orderStatus, orderSearch], queryFn: () => api.listOrders({ status: orderStatus, search: orderSearch, actorToken: token || undefined }), enabled: !!staff && !needPinChange });
  const suppliersQ = useQuery({ queryKey: ["suppliers", supplierSearch], queryFn: () => api.listSuppliers({ search: supplierSearch, actorToken: token || undefined }), enabled: !!staff && !needPinChange });
  const categoriesQ = useQuery({ queryKey: ["categories"], queryFn: () => api.listCategories({ actorToken: token || undefined }), enabled: !!staff && !needPinChange });

  const allProducts = allProductsQ.data?.products ?? [];
  const categories = useMemo(() => allProductsQ.data?.categories ?? productsQ.data?.categories ?? [], [allProductsQ.data, productsQ.data]);

  const deleteMut = useMutation({
    mutationFn: async (c: { kind: string; id: number }) => {
      if (c.kind === "product") return api.deleteProduct({ id: c.id, actorToken: token || undefined });
      if (c.kind === "supplier") return api.deleteSupplier({ id: c.id, actorToken: token || undefined });
      if (c.kind === "category") return api.deleteCategory({ id: c.id, actorToken: token || undefined });
      return api.deleteMovement({ id: c.id, actorToken: token || undefined });
    },
    onSuccess: (r) => {
      qc.invalidateQueries(); setConfirmDelete(null);
      if (r && typeof r === "object" && "ok" in r && !(r as { ok: boolean }).ok) {
        alertMsg((r as { error?: string | null }).error ?? "Không xoá được.");
      } else if (r && typeof r === "object" && "discontinued" in r && (r as { discontinued?: boolean }).discontinued) {
        alertMsg("Sản phẩm đã có lịch sử phiếu/đơn nên được chuyển sang “Ngưng bán” thay vì xoá hẳn.");
      }
    },
    onError: (e) => alertMsg(netErrMsg(e)),
  });
  const orderStatusMut = useMutation({
    mutationFn: (v: { id: number; status: "pending" | "confirmed" | "delivering" | "completed" | "cancelled" | "reserved" }) => api.updateOrderStatus({ ...v, actorToken: token || undefined }),
    onSuccess: (r) => {
      if (!r.ok) alertMsg(r.error ?? "Không đổi được trạng thái");
      if (r.pendingRestocks.length > 0) alertMsg(`Có ${r.pendingRestocks.length} mặt hàng chờ hoàn kho (sản phẩm đã bị xoá): ${r.pendingRestocks.map((p) => `${p.productName} ×${p.quantity}`).join(", ")} — xem mục cảnh báo ở Tổng quan.`);
      qc.invalidateQueries();
    },
    onError: (e) => alertMsg(netErrMsg(e)),
  });
  const depositMut = useMutation({
    mutationFn: (v: { orderId: number; amount: number }) => api.recordDeposit({ ...v, actorToken: token || undefined }),
    onSuccess: (r) => {
      if (!r.ok) { alertMsg(r.error ?? "Không ghi được cọc."); return; }
      alertMsg(`Đã ghi nhận cọc. Tổng cọc: ${fmtVND(r.depositAmount)} · ${PAYMENT_STATUS[r.paymentStatus] ?? r.paymentStatus}`);
      setDepositFor(null); setDepositAmt("");
      qc.invalidateQueries();
    },
    onError: (e) => alertMsg(netErrMsg(e)),
  });
  const releaseMut = useMutation({
    mutationFn: (orderId: number) => api.releaseReservation({ orderId, actorToken: token || undefined }),
    onSuccess: (r) => { if (!r.ok) alertMsg(r.error ?? "Không huỷ được giữ hàng."); else alertMsg("Đã huỷ giữ hàng, kho đã hoàn lại."); qc.invalidateQueries(); },
    onError: (e) => alertMsg(netErrMsg(e)),
  });
  const changePinMut = useMutation({
    mutationFn: () => api.changePin({ token, oldPin: cpOld, newPin: cpNew }),
    onSuccess: (r) => {
      if (!r.ok) { setCpErr(r.error ?? "Không đổi được PIN."); return; }
      setChangePinOpen(false); setCpOld(""); setCpNew(""); setCpConfirm(""); setCpErr("");
      alertMsg("Đã đổi mã PIN.");
    },
    onError: (e) => setCpErr(netErrMsg(e)),
  });
  const addCatMut = useMutation({ mutationFn: () => api.createCategory({ name: newCatName, actorToken: token || undefined }), onSuccess: (r) => { if (!r.ok) alertMsg(r.error ?? "Lỗi"); else setNewCatName(""); qc.invalidateQueries(); }, onError: (e) => alertMsg(netErrMsg(e)) });

  // Chặn toàn bộ app khi chưa đăng nhập; bắt buộc đổi PIN lần đầu.
  if (!staff) {
    return (
      <LoginScreen
        onLoggedIn={(t, s, pin) => {
          sessionStorage.setItem("staffToken", t);
          sessionStorage.setItem("staffInfo", JSON.stringify(s));
          setLoginPin(pin);
          setStaff(s);
          setNeedPinChange(s.mustChangePin === 1);
        }}
      />
    );
  }
  if (needPinChange) {
    return (
      <ChangePinScreen
        token={token}
        oldPin={loginPin}
        onDone={() => {
          const updated = { ...staff, mustChangePin: 0 };
          sessionStorage.setItem("staffInfo", JSON.stringify(updated));
          setStaff(updated);
          setNeedPinChange(false);
          setLoginPin("");
        }}
      />
    );
  }



  const d = dashboard.data;
  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "dashboard", label: "Tổng quan", icon: "▦" },
    { key: "products", label: "Tồn kho", icon: "▤" },
    { key: "movements", label: "Nhập / Xuất", icon: "⇅" },
    { key: "orders", label: "Đơn hàng", icon: "🧾" },
    { key: "reports", label: "Báo cáo", icon: "📊" },
    { key: "debts", label: "Công nợ", icon: "💳" },
    { key: "stocktakes", label: "Kiểm kê", icon: "📋" },
    { key: "history", label: "Lịch sử", icon: "🕘" },
    { key: "partners", label: "Đối tác", icon: "🏭" },
    ...(isAdmin ? [{ key: "admin" as Tab, label: "NV & Sao lưu", icon: "⚙" }] : []),
  ];

  function logout() {
    sessionStorage.removeItem("staffToken");
    sessionStorage.removeItem("staffInfo");
    setStaff(null);
    setNeedPinChange(false);
    setLoginPin("");
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] pb-24">
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] rounded-2xl bg-[var(--text)] text-[var(--bg)] text-sm font-semibold px-4 py-3 shadow-lg">{toast}</div>}
      {!online && (
        <div className="sticky top-0 z-50 bg-[var(--red)] text-white px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm font-bold">{process.env.KHO_DEPLOYMENT_MODE === "online" ? "⚠ Chưa kết nối được kho online — kiểm tra Internet rồi tải lại trang" : "⚠ Chưa kết nối được ứng dụng trên máy — hãy mở lại bằng nút Mở kho"}</p>
          <button className="shrink-0 rounded-lg bg-white text-[var(--red)] font-bold text-sm px-3 py-1.5" onClick={() => qc.invalidateQueries()}>Thử lại</button>
        </div>
      )}

      <main className="mx-auto max-w-3xl px-4 pt-4">
        <div className="flex items-center justify-between mb-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] px-4 py-2.5">
          <p className="text-sm min-w-0 truncate">👤 <b>{staff.name}</b> · {roleLabel(staff.role)}</p>
          <span className="flex gap-2 shrink-0">
            <button className="text-xs font-bold text-[var(--accent)]" onClick={() => setChangePinOpen(true)}>Đổi PIN</button>
            <button className="text-xs font-bold text-[var(--red)]" onClick={logout}>Đăng xuất</button>
          </span>
        </div>
        {/* Quick actions */}
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          <button aria-label="Tạo phiếu nhập kho" disabled={!canStock} title={canStock ? "" : "Cần quyền thủ kho hoặc quản trị"} onClick={() => setMoveForm({ open: true, type: "in" })} className="rounded-2xl bg-[var(--green)] text-white py-3.5 font-bold text-[15px] active:opacity-80 shadow-sm disabled:opacity-50">↓ Nhập kho</button>
          <button aria-label="Tạo phiếu xuất kho" disabled={!canStock} title={canStock ? "" : "Cần quyền thủ kho hoặc quản trị"} onClick={() => setMoveForm({ open: true, type: "out" })} className="rounded-2xl bg-[var(--red)] text-white py-3.5 font-bold text-[15px] active:opacity-80 shadow-sm disabled:opacity-50">↑ Xuất kho</button>
          <button aria-label="Tạo đơn hàng mới" onClick={() => setOrderFormOpen(true)} className="rounded-2xl bg-[var(--accent)] text-white py-3.5 font-bold text-[15px] active:opacity-80 shadow-sm">+ Đơn hàng</button>
        </div>
        {!canStock && <p className="text-xs text-[var(--amber)] font-medium -mt-3 mb-4">Tài khoản nhân viên bán hàng: chỉ tạo đơn/giữ hàng/giao hàng/trả hàng — nhập, xuất và kiểm kê cần quyền thủ kho hoặc quản trị.</p>}

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

                {(d.reservedOrders > 0 || d.overdueDebtTotal > 0) && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="rounded-2xl bg-violet-100 dark:bg-violet-950 border border-violet-200 dark:border-violet-900 p-4">
                      <p className="text-[13px] font-semibold text-violet-700 dark:text-violet-300">Đơn đang giữ hàng</p>
                      <p className="text-2xl font-extrabold tabular mt-1">{fmtNum(d.reservedOrders)}</p>
                    </div>
                    <div className="rounded-2xl bg-[var(--red-soft)] border border-[var(--red)]/20 p-4">
                      <p className="text-[13px] font-semibold text-[var(--red)]">Công nợ quá hạn</p>
                      <p className="text-2xl font-extrabold tabular mt-1">{fmtVND(d.overdueDebtTotal)}</p>
                    </div>
                  </div>
                )}

                {d.pendingRestockCount > 0 && <PendingRestockBox products={allProducts} token={token} />}

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
                    <button aria-label="Đi tới nhập kho cho hàng sắp hết" className="mt-3 w-full rounded-xl bg-[var(--amber)] text-white font-bold py-2.5 disabled:opacity-50" disabled={!canStock} onClick={() => setMoveForm({ open: true, type: "in" })}>Nhập hàng ngay</button>
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
              <button aria-label="Xuất CSV tồn kho" className={btnGhost + " shrink-0 !px-3"} onClick={() => downloadCsv(`ton-kho-${todayStr()}.csv`, ["SKU", "Tên", "Danh mục", "Hãng", "Đơn vị", "Tồn", "Đang giữ", "Tồn tối thiểu", "Giá nhập", "Giá bán", "Vị trí", "Trạng thái"], (productsQ.data?.products ?? []).map((p) => [p.sku, p.name, p.category, p.brand, p.unit, p.currentStock, p.reservedQty, p.minStock, p.costPrice, p.sellPrice, p.location, p.status]))}>⬇ CSV</button>
            </div>
            <CsvImportBox token={token} />
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
                        <p className="text-xs text-[var(--dim)] mt-1">Tối thiểu {p.minStock} · Nhập {fmtVND(p.costPrice)} · Bán {fmtVND(p.sellPrice)}{p.reservedQty > 0 ? ` · Đang giữ ${fmtNum(p.reservedQty)} ${p.unit}` : ""}</p>
                      </div>
                      <p className="text-right text-xs text-[var(--dim)]">Giá trị tồn<br /><span className="text-sm font-bold text-[var(--text)] tabular">{fmtVND(p.currentStock * p.costPrice)}</span></p>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-3">
                      <button aria-label={`Nhập thêm ${p.name}`} disabled={!canStock} title={canStock ? "" : "Cần quyền thủ kho hoặc quản trị"} className="rounded-lg bg-[var(--green-soft)] text-[var(--green)] font-bold text-[13px] py-2 disabled:opacity-50" onClick={() => setMoveForm({ open: true, type: "in", productId: p.id })}>↓ Nhập</button>
                      <button aria-label={`Xuất ${p.name}`} disabled={!canStock} title={canStock ? "" : "Cần quyền thủ kho hoặc quản trị"} className="rounded-lg bg-[var(--red-soft)] text-[var(--red)] font-bold text-[13px] py-2 disabled:opacity-50" onClick={() => setMoveForm({ open: true, type: "out", productId: p.id })}>↑ Xuất</button>
                      <button aria-label={`Sửa ${p.name}`} className="rounded-lg bg-[var(--surface2)] font-bold text-[13px] py-2" onClick={() => setProductForm({ open: true, product: p })}>Sửa</button>
                      <button aria-label={`Xoá ${p.name}`} disabled={!isAdmin} title={isAdmin ? "" : "Cần quyền quản trị"} className="rounded-lg bg-[var(--surface2)] text-[var(--red)] font-bold text-[13px] py-2 disabled:opacity-50" onClick={() => setConfirmDelete({ kind: "product", id: p.id, label: `${p.sku} · ${p.name}` })}>Xoá</button>
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
              <button aria-label="Tạo phiếu mới" className={btnPrimary + " shrink-0"} disabled={!canStock} title={canStock ? "" : "Cần quyền thủ kho hoặc quản trị"} onClick={() => setMoveForm({ open: true, type: "in" })}>+ Phiếu</button>
              <button aria-label="Xuất CSV lịch sử phiếu" className={btnGhost + " shrink-0 !px-3"} onClick={() => downloadCsv(`lich-su-phieu-${todayStr()}.csv`, ["Mã phiếu", "Loại", "SKU", "Sản phẩm", "Số lượng", "Tồn trước", "Tồn sau", "Đơn giá", "Lý do", "Đối tác", "Ghi chú", "Người ghi", "Thời gian"], (movementsQ.data?.movements ?? []).map((m) => [m.refCode, MOVE_META[m.type]?.label ?? m.type, m.productSku, m.productName, m.quantity, m.beforeStock, m.afterStock, m.unitCost, m.reason, m.partner, m.note, m.actor, m.createdAt]))}>⬇ CSV</button>
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
                    <div className="flex justify-end gap-4 pb-2">
                      <button aria-label={`In phiếu ${m.refCode}`} className="text-xs font-semibold text-[var(--accent)]" onClick={() => setPrintData({ title: `PHIẾU ${MOVE_META[m.type]?.label?.toUpperCase() ?? ""} — ${m.refCode}`, meta: [`Ngày: ${fmtDate(m.createdAt)}`, `Đối tác: ${m.partner || "—"}`, `Lý do: ${m.reason || "—"}${m.note ? ` · ${m.note}` : ""}`, `Người ghi: ${m.actor}`], rows: [{ name: `${m.productSku} · ${m.productName}`, qty: m.type === "adjust" ? `${m.beforeStock} → ${m.afterStock}` : String(m.quantity), price: m.unitCost, amount: m.quantity * m.unitCost }], total: m.quantity * m.unitCost })}>🖨 In phiếu</button>
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
              <button aria-label="Xuất CSV đơn hàng" className={btnGhost + " shrink-0 !px-3"} onClick={() => downloadCsv(`don-hang-${todayStr()}.csv`, ["Mã đơn", "Khách hàng", "SĐT", "Địa chỉ", "Trạng thái", "Tổng tiền", "Đã cọc", "Thanh toán", "Người giao", "Phí giao", "Ngày giao dự kiến", "Hạn giữ", "Ngày tạo"], (ordersQ.data?.orders ?? []).map((o) => [o.orderCode, o.customerName, o.customerPhone, o.customerAddress, ORDER_STATUS[o.status]?.label ?? o.status, o.totalAmount, o.depositAmount, PAYMENT_STATUS[o.paymentStatus] ?? o.paymentStatus, o.deliveryPerson, o.deliveryFee, o.expectedDelivery, o.reservedUntil, o.createdAt]))}>⬇ CSV</button>
            </div>
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1 -mx-1 px-1">
              {([["all", "Tất cả"], ["pending", "Chờ xử lý"], ["reserved", "Đang giữ hàng"], ["confirmed", "Đã xác nhận"], ["delivering", "Đang giao"], ["completed", "Hoàn thành"], ["cancelled", "Đã huỷ"]] as const).map(([v, l]) => (
                <button key={v} aria-label={`Lọc đơn: ${l}`} onClick={() => setOrderStatus(v)} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold border ${orderStatus === v ? "bg-[var(--accent)] text-white border-transparent" : "bg-[var(--surface)] border-[var(--border)]"}`}>{l}</button>
              ))}
            </div>
            <p className="text-xs text-[var(--dim)] mb-3 leading-relaxed">💡 Đơn “Chờ xử lý” chưa trừ kho. Bấm <b>Xác nhận</b> → kho tự trừ + ghi phiếu xuất. Huỷ đơn đã xác nhận → kho tự hoàn lại. Đơn “Đang giữ hàng” đã trừ kho và giữ số lượng tới hạn giữ.</p>
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
                // Còn phải thu = tổng đơn − tiền hàng đã trả − tiền đã cọc
                // (netPayable − cọc, khớp paymentStatus/công nợ ở server).
                // Công thức cũ (tổng − cọc) không trừ tiền hoàn hàng nên đơn trả
                // một phần rồi thu đủ vẫn hiển thị còn nợ.
                const refunded = o.items.reduce((s, i) => s + (i.returnedQty || 0) * i.unitPrice, 0);
                const remaining = Math.max(0, o.totalAmount - refunded - o.depositAmount);
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
                        <span className="text-sm text-[var(--dim)]">{o.items.reduce((s, i) => s + i.quantity, 0)} sản phẩm{o.status === "reserved" && o.reservedUntil ? ` · Giữ tới ${fmtDate(o.reservedUntil)}` : ""}{o.depositAmount > 0 ? ` · Đã cọc ${fmtVND(o.depositAmount)}` : ""}</span>
                        <span className="font-extrabold tabular">{fmtVND(o.totalAmount)}</span>
                      </div>
                    </button>
                    {expanded && (
                      <div className="mt-3 pt-3 border-t border-[var(--border)]">
                        {o.customerAddress && <p className="text-sm text-[var(--dim)] mb-2">📍 {o.customerAddress}</p>}
                        <ul className="space-y-1.5 mb-3">
                          {o.items.map((i) => (
                            <li key={i.id} className="flex justify-between text-sm gap-2"><span className="min-w-0 truncate"><span className="tabular font-semibold">{i.productSku}</span> · {i.productName} × {i.quantity}{i.returnedQty > 0 ? ` (đã trả ${i.returnedQty})` : ""}</span><span className="tabular font-semibold shrink-0">{fmtVND(i.lineTotal)}</span></li>
                          ))}
                        </ul>
                        {o.note && <p className="text-sm text-[var(--dim)] mb-3">📝 {o.note}</p>}
                        {o.status === "reserved" && (
                          <p className="text-sm rounded-xl bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 px-3 py-2.5 font-medium mb-3">📌 Đang giữ hàng{o.reservedUntil ? ` — hạn giữ tới ${fmtDate(o.reservedUntil)}` : ""}. Số lượng đã trừ kho và đang giữ.</p>
                        )}
                        <div className="text-sm space-y-1 mb-3">
                          <p>Thanh toán: <b>{PAYMENT_STATUS[o.paymentStatus] ?? o.paymentStatus}</b> · Đã cọc: <b className="tabular">{fmtVND(o.depositAmount)}</b> · Còn phải thu: <b className="tabular">{fmtVND(remaining)}</b></p>
                          {(o.deliveryPerson || o.deliveryFee > 0 || o.expectedDelivery) && (
                            <p className="text-[var(--dim)]">🚚 {o.deliveryPerson ? `Người giao: ${o.deliveryPerson} · ` : ""}{o.deliveryFee > 0 ? `Phí giao: ${fmtVND(o.deliveryFee)} · ` : ""}{o.expectedDelivery ? `Giao dự kiến: ${fmtDay(o.expectedDelivery)}` : ""}</p>
                          )}
                        </div>
                        {o.paymentStatus !== "paid" && (
                          depositFor === o.id ? (
                            <div className="flex gap-2 mb-3">
                              <input aria-label="Số tiền cọc ghi nhận" type="number" inputMode="numeric" min={1} className={inputCls + " flex-1"} value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} placeholder="Số tiền cọc (VNĐ)" />
                              <button className={btnPrimary} disabled={depositMut.isPending} onClick={() => { const amt = Number(depositAmt); if (!amt || amt <= 0) { alertMsg("Nhập số tiền cọc lớn hơn 0."); return; } depositMut.mutate({ orderId: o.id, amount: amt }); }}>{depositMut.isPending ? "Đang ghi…" : "Ghi cọc"}</button>
                              <button className={btnGhost} onClick={() => { setDepositFor(null); setDepositAmt(""); }}>Huỷ</button>
                            </div>
                          ) : (
                            <button className="rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] font-bold text-[13px] px-4 py-2 mb-3" onClick={() => { setDepositFor(o.id); setDepositAmt(remaining > 0 ? String(remaining) : ""); }}>💰 Ghi nhận cọc</button>
                          )
                        )}
                        <div className="flex flex-wrap gap-2 mb-3">
                          {(o.status === "confirmed" || o.status === "reserved") && <button className={btnPrimary + " !py-2 text-sm"} disabled={orderStatusMut.isPending} onClick={() => orderStatusMut.mutate({ id: o.id, status: "delivering" })}>🚚 Giao hàng</button>}
                          {o.status === "delivering" && <button className={btnPrimary + " !py-2 text-sm"} disabled={orderStatusMut.isPending} onClick={() => orderStatusMut.mutate({ id: o.id, status: "completed" })}>✓ Hoàn thành</button>}
                          {o.status === "reserved" && <button className="rounded-xl bg-[var(--amber)] text-white font-semibold px-4 py-2 text-sm" disabled={releaseMut.isPending} onClick={() => { if (window.confirm(`Huỷ giữ hàng đơn ${o.orderCode}? Kho sẽ hoàn lại số lượng đang giữ.`)) releaseMut.mutate(o.id); }}>Huỷ giữ hàng</button>}
                          {["confirmed", "delivering", "completed"].includes(o.status) && <button className={btnGhost + " !py-2 text-sm"} onClick={() => setReturnOrder(o)}>↩ Trả hàng</button>}
                          <button className={btnGhost + " !py-2 text-sm"} onClick={() => setPrintData({ title: `ĐƠN HÀNG — ${o.orderCode}`, meta: [`Khách: ${o.customerName}${o.customerPhone ? ` · ${o.customerPhone}` : ""}`, `Ngày: ${fmtDate(o.createdAt)}`, `Địa chỉ: ${o.customerAddress || "—"}`, `Trạng thái: ${st.label} · Thanh toán: ${PAYMENT_STATUS[o.paymentStatus] ?? o.paymentStatus} (đã cọc ${fmtVND(o.depositAmount)})`, `Người giao: ${o.deliveryPerson || "—"} · Phí giao: ${fmtVND(o.deliveryFee)}`], rows: o.items.map((i) => ({ name: `${i.productSku} · ${i.productName}`, qty: String(i.quantity), price: i.unitPrice, amount: i.lineTotal })), total: o.totalAmount })}>🖨 In phiếu</button>
                        </div>
                        <label htmlFor={`order-status-${o.id}`} className={labelCls}>Đổi trạng thái đơn</label>
                        <select id={`order-status-${o.id}`} aria-label={`Trạng thái đơn ${o.orderCode}`} className={inputCls} value={["returned", "partially_returned"].includes(o.status) ? o.status : o.status}
                          onChange={(e) => orderStatusMut.mutate({ id: o.id, status: e.target.value as "pending" | "confirmed" | "delivering" | "completed" | "cancelled" | "reserved" })}>
                          <option value="pending">Chờ xử lý</option>
                          <option value="reserved">Đang giữ hàng</option>
                          <option value="confirmed">Đã xác nhận (trừ kho)</option>
                          <option value="delivering">Đang giao</option>
                          <option value="completed">Hoàn thành</option>
                          <option value="cancelled">Huỷ đơn (hoàn kho nếu đã trừ)</option>
                          <option value="returned" disabled>Đã trả hàng (dùng nút Trả hàng)</option>
                          <option value="partially_returned" disabled>Trả một phần (dùng nút Trả hàng)</option>
                        </select>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {tab === "reports" && <ReportsTab token={token} />}
        {tab === "debts" && <DebtsTab token={token} />}
        {tab === "stocktakes" && <StocktakesTab token={token} products={allProducts} canStock={canStock} isAdmin={isAdmin} />}
        {tab === "history" && <HistoryTab token={token} />}
        {tab === "admin" && isAdmin && <AdminTab token={token} staff={staff} />}

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
                    <button aria-label={`Xoá nhà cung cấp ${s.name}`} disabled={!isAdmin} title={isAdmin ? "" : "Cần quyền quản trị"} className="rounded-lg bg-[var(--surface2)] text-[var(--red)] font-bold text-[13px] px-4 py-2 disabled:opacity-50" onClick={() => setConfirmDelete({ kind: "supplier", id: s.id, label: s.name })}>Xoá</button>
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
                  <button aria-label={`Xoá danh mục ${c.name}`} disabled={!isAdmin} title={isAdmin ? "" : "Cần quyền quản trị"} className="text-xs font-bold text-[var(--red)] disabled:opacity-50" onClick={() => setConfirmDelete({ kind: "category", id: c.id, label: `Danh mục ${c.name} (${c.productCount} sản phẩm sẽ chuyển về “Khác”)` })}>Xoá</button>
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
        <div className="mx-auto max-w-3xl flex overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.key} aria-label={t.label} aria-current={tab === t.key ? "page" : undefined} onClick={() => setTab(t.key)}
              className={`relative py-2.5 px-1 flex flex-col items-center gap-0.5 text-[11px] font-semibold shrink-0 min-w-[68px] flex-1 ${tab === t.key ? "text-[var(--accent)]" : "text-[var(--dim)]"}`}>
              <span className="text-lg leading-none" aria-hidden>{t.icon}</span>{t.label}
              {t.key === "orders" && d && d.pendingOrders > 0 && <span className="absolute top-1 right-2 min-w-5 h-5 px-1 rounded-full bg-[var(--red)] text-white text-[10px] font-bold flex items-center justify-center">{d.pendingOrders}</span>}
            </button>
          ))}
        </div>
      </nav>

      {productForm.open && <Modal title={productForm.product ? "Sửa sản phẩm" : "Thêm sản phẩm mới"} onClose={() => setProductForm({ open: false, product: null })}><ProductForm product={productForm.product} categories={categories.length ? categories : ["Bồn cầu", "Lavabo & Chậu rửa", "Vòi lavabo", "Sen tắm & Vòi sen", "Bồn tắm", "Khác"]} token={token} isAdmin={isAdmin} onClose={() => setProductForm({ open: false, product: null })} /></Modal>}
      {moveForm.open && <Modal title="Phiếu nhập / xuất / kiểm kê" onClose={() => setMoveForm({ ...moveForm, open: false })}><MovementForm presetType={moveForm.type} presetProductId={moveForm.productId} products={allProducts} suppliers={suppliersQ.data?.suppliers ?? []} token={token} canStock={canStock} onClose={() => setMoveForm({ ...moveForm, open: false })} /></Modal>}
      {orderFormOpen && <Modal title="Tạo đơn hàng mới" onClose={() => setOrderFormOpen(false)}><OrderForm products={allProducts} token={token} onClose={() => setOrderFormOpen(false)} /></Modal>}
      {supplierForm.open && <Modal title={supplierForm.supplier ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp"} onClose={() => setSupplierForm({ open: false, supplier: null })}><SupplierForm supplier={supplierForm.supplier} token={token} onClose={() => setSupplierForm({ open: false, supplier: null })} /></Modal>}
      {returnOrder && <Modal title={`Trả hàng — ${returnOrder.orderCode}`} onClose={() => setReturnOrder(null)}><ReturnModal order={returnOrder} token={token} onClose={() => setReturnOrder(null)} /></Modal>}
      {printData && <PrintPreview data={printData} onClose={() => setPrintData(null)} />}

      {changePinOpen && (
        <Modal title="Đổi mã PIN" onClose={() => { setChangePinOpen(false); setCpErr(""); }}>
          <div className="space-y-4">
            <div><label htmlFor="cp-old" className={labelCls}>Mã PIN hiện tại</label><input id="cp-old" aria-label="Mã PIN hiện tại" type="password" inputMode="numeric" className={inputCls} value={cpOld} onChange={(e) => setCpOld(e.target.value.replace(/\D/g, "").slice(0, 8))} /></div>
            <div><label htmlFor="cp-new" className={labelCls}>Mã PIN mới (4–8 số)</label><input id="cp-new" aria-label="Mã PIN mới" type="password" inputMode="numeric" className={inputCls} value={cpNew} onChange={(e) => setCpNew(e.target.value.replace(/\D/g, "").slice(0, 8))} /></div>
            <div><label htmlFor="cp-confirm" className={labelCls}>Nhập lại mã PIN mới</label><input id="cp-confirm" aria-label="Nhập lại mã PIN mới" type="password" inputMode="numeric" className={inputCls} value={cpConfirm} onChange={(e) => setCpConfirm(e.target.value.replace(/\D/g, "").slice(0, 8))} /></div>
            {cpErr && <p className="rounded-xl bg-[var(--red-soft)] text-[var(--red)] text-sm px-3 py-2.5 font-medium">{cpErr}</p>}
            <div className="flex gap-3">
              <button className={btnGhost + " flex-1"} onClick={() => setChangePinOpen(false)}>Huỷ</button>
              <button className={btnPrimary + " flex-1"} disabled={changePinMut.isPending} onClick={() => { setCpErr(""); if (!/^\d{4,8}$/.test(cpNew)) { setCpErr("Mã PIN mới phải gồm 4–8 chữ số."); return; } if (cpNew !== cpConfirm) { setCpErr("Mã PIN nhập lại chưa khớp."); return; } changePinMut.mutate(); }}>{changePinMut.isPending ? "Đang đổi…" : "Đổi PIN"}</button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Xác nhận xoá" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm leading-relaxed">Bạn chắc chắn muốn xoá <b>{confirmDelete.label}</b>?</p>
          {confirmDelete.kind === "movement" && <p className="text-sm text-[var(--dim)] mt-2">Tồn kho sẽ được hoàn lại theo chênh lệch của phiếu này.</p>}
          {confirmDelete.kind === "product" && <p className="text-sm text-[var(--dim)] mt-2">Lịch sử phiếu & đơn cũ vẫn giữ tên/mã snapshot. Nếu sản phẩm đã có lịch sử, máy chủ sẽ chuyển sang “Ngưng bán” thay vì xoá hẳn; chỉ sản phẩm chưa từng có phiếu/đơn mới bị xoá hẳn.</p>}
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
