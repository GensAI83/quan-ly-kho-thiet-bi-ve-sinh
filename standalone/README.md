# Bản chạy trực tiếp trên máy tính (standalone)

Chạy app **Quản lý kho thiết bị vệ sinh** trực tiếp trên máy tính Windows
của bạn bằng [Bun](https://bun.sh) + file SQLite — không cần mạng, không cần
tài khoản Muse. Giao diện và logic y hệt bản chạy trên Muse vì bản này dùng
chung code gốc (`client/src/`, `server/src/`, `drizzle/`); chỉ khác lớp chạy:
server Bun tự phục vụ thay cho máy chủ Muse, và SDK được thay bằng một shim
tối thiểu trong `shim/space-sdk/` (xem `CHANGES.md` ở gốc repo).

> **Database riêng.** Bản standalone có database RIÊNG (`standalone/data/warehouse.db`),
> không đồng bộ với app trên Muse. Muốn mang dữ liệu từ app Muse sang: trong
> app Muse, vào tab **Nhân viên & Sao lưu** → xuất sao lưu JSON, rồi trong bản
> standalone dùng chức năng **Khôi phục** để nạp file đó.

## Cài đặt (làm một lần)

1. **Cài Bun.** Mở PowerShell, chạy:
   ```powershell
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```
   Đóng rồi mở lại terminal (để nhận lệnh `bun`). Kiểm tra: `bun --version`
   (bản đã kiểm chứng: Bun 1.4.4).
2. **Lấy mã nguồn.** Tải ZIP từ
   <https://github.com/GensAI83/quan-ly-kho-thiet-bi-ve-sinh>
   (nút **Code → Download ZIP**) rồi giải nén, hoặc:
   ```bash
   git clone https://github.com/GensAI83/quan-ly-kho-thiet-bi-ve-sinh.git
   ```
3. **Cài gói phụ thuộc** (chỉ gói npm công khai, không cần tài khoản gì thêm):
   ```bash
   cd quan-ly-kho-thiet-bi-ve-sinh\standalone
   bun install
   ```
4. **Build giao diện:**
   ```bash
   bun run build
   ```
   (Tạo `standalone/dist/app.js` + `app.css` từ code gốc trong `client/src/`.)

## Chạy hàng ngày

Đúp vào **`start.bat`** trong thư mục `standalone/` — file này tự build nếu
chưa có bản build, khởi động server rồi mở trình duyệt tới
<http://127.0.0.1:3000>.

Hoặc chạy tay trong terminal (tại thư mục `standalone/`):

```bash
bun run start
```

rồi mở <http://127.0.0.1:3000>.

**Đăng nhập lần đầu:** mã PIN mặc định **`123456`** (tài khoản “Chủ cửa hàng”).
App bắt buộc đổi PIN ngay ở lần đăng nhập đầu — hãy đổi thành PIN riêng
(4–8 chữ số) và đừng chia sẻ PIN quản trị.

## Dữ liệu & sao lưu

- Dữ liệu nằm trong **một file duy nhất**: `standalone/data/warehouse.db`.
  **Sao lưu = copy file này khi server đang TẮT** (đóng cửa sổ server/`start.bat`
  trước rồi mới copy). Ngoài ra trong app vẫn có sao lưu JSON ở tab
  **Nhân viên & Sao lưu** (snapshot trên server + tải file JSON về).
- Chỉ dùng trên **1 máy** (localhost `127.0.0.1`), không mở ra mạng ngoài.
  Server chỉ bind `127.0.0.1` nên máy khác trong mạng không truy cập được.

## Đổi cổng / đổi đường dẫn database

Đặt biến môi trường trước khi chạy (PowerShell):

```powershell
$env:PORT=4000; $env:DB_PATH="D:\kho\warehouse.db"; bun run start
```

- `PORT` (mặc định `3000`): cổng server. Đổi cổng thì mở trình duyệt tới
  `http://127.0.0.1:<PORT>` (lưu ý: `start.bat` luôn mở cổng 3000).
- `DB_PATH` (mặc định `standalone/data/warehouse.db`): đường dẫn file SQLite.

## Kiểm chứng sau khi cài (tùy chọn)

```bash
bun run smoke      # kiểm thử end-to-end qua HTTP thật (đăng nhập, phiếu nhập/xuất, đơn, trả hàng, sao lưu/khôi phục, migration)
bun run typecheck  # kiểm tra kiểu code standalone + shim
```

## Khắc phục sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| `bun` không nhận lệnh | Đóng/mở lại terminal sau khi cài Bun; kiểm tra `bun --version`. |
| `Cannot find module '@hatch/space-sdk'` | Chạy lại `bun install` trong thư mục `standalone/` (không chạy ở thư mục gốc repo). |
| Build lỗi `Can't resolve 'tailwindcss'` | Script build tự tạo liên kết tạm `client\node_modules` → `standalone\node_modules` trong lúc build rồi gỡ lại. Nếu vẫn lỗi, tạo tay tại gốc repo: `mklink /J client\node_modules standalone\node_modules` (không cần quyền admin), build xong thì xóa liên kết đó đi (`rmdir client\node_modules`). |
| Trang trắng / `app.js` 404 | Chạy `bun run build` rồi `bun run start` lại. |
| Cổng 3000 đã bị chiếm | Đặt `$env:PORT=4000` rồi chạy lại (xem mục trên). |
| Quên PIN | Xóa file `standalone/data/warehouse.db` sẽ tạo lại tài khoản quản trị PIN `123456` — **nhưng mất toàn bộ dữ liệu**, chỉ làm khi đã có bản sao lưu. |

## Giới hạn đã biết

- Không có đồng bộ với app Muse, không có tài khoản online, không chạy được
  trên 2 máy cùng lúc (mỗi máy một file database riêng).
- Không có cron sao lưu chạy nền: snapshot tự động chỉ tạo khi mở app (như
  bản Muse).
- Hai người thao tác cùng lúc trên cùng máy vẫn dùng chung một server nên
  không xung đột như hai máy riêng — nhưng vẫn áp dụng kiểm tra version như
  bản gốc; nếu báo “Số tồn vừa thay đổi…”, tải lại trang rồi thử lại.
- Xem thêm giới hạn chung của app trong `CHANGES.md` và `TEST_RESULTS.md`
  ở gốc repo.
