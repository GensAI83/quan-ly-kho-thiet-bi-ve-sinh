import { Database } from "bun:sqlite";

export function snapshotWarehouse(filename: string) {
  const db = new Database(filename, { readonly: true, strict: true });
  try { return db.serialize(); } finally { db.close(); }
}

export async function transferWarehouse(options: { sourceDatabase: string; origin: string; password: string }) {
  const url = new URL(options.origin);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Cần địa chỉ HTTPS gốc của kho online.");
  const origin = url.origin;
  const login = await fetch(origin + "/cloud/login", { method: "POST", redirect: "manual", headers: {
    Origin: origin, "Content-Type": "application/x-www-form-urlencoded",
  }, body: new URLSearchParams({ password: options.password }) });
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]!).find(value => value.startsWith("__Host-kho_remote="));
  if (login.status !== 303 || !cookie) throw new Error("Không đăng nhập được kho online. Kiểm tra mật khẩu truy cập từ xa.");
  const bytes = snapshotWarehouse(options.sourceDatabase);
  if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("Dữ liệu vượt giới hạn chuyển tự động 64 MB; cần chuyển qua quản trị máy chủ.");
  const result = await fetch(origin + "/cloud/import", { method: "POST", redirect: "manual", headers: {
    Cookie: cookie, Origin: origin, "Content-Type": "application/vnd.sqlite3",
  }, body: bytes });
  const response = await result.json() as { ok?: boolean; error?: string; message?: string };
  if (!result.ok || !response.ok) throw new Error(response.error || `Chuyển dữ liệu không thành công (${result.status}).`);
  return response.message || "Đã chuyển dữ liệu.";
}
