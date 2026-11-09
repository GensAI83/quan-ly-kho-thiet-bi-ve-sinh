# Quản lý kho thiết bị vệ sinh

App quản lý kho thiết bị vệ sinh — nhập/xuất kho, tồn kho, lịch sử giao dịch, đơn hàng và đối tác.

## Tính năng

- **Tổng quan:** giá trị tồn kho, nhập/xuất hôm nay, biểu đồ 7 ngày, cảnh báo sắp hết / hết hàng, khoản hoàn kho chờ xử lý
- **Tồn kho:** mã SKU tự sinh theo danh mục (BC = bồn cầu, LV = lavabo, ST = sen tắm...), hãng, giá nhập / giá bán, vị trí kệ, tồn tối thiểu, tìm kiếm và lọc, số lượng đang giữ hàng, trạng thái ngưng kinh doanh
- **Nhập / Xuất kho:** phiếu nhập (PN), phiếu xuất (PX) và kiểm kê — cả phiếu 1 mặt hàng và phiếu nhiều mặt hàng (1 mã phiếu chung), tự động cập nhật tồn, chặn xuất quá tồn, xóa phiếu hoàn tồn; chống lệch tồn khi nhiều người cùng thao tác (kiểm tra phiên bản tồn + mã chống gửi trùng)
- **Lịch sử nhập/xuất:** mã phiếu, lý do, đối tác, tồn trước → sau, người thao tác
- **Đơn hàng:** nhiều dòng hàng, giữ hàng (có hạn giữ), xác nhận đơn tự trừ kho và sinh phiếu xuất, giao hàng, hoàn thành, hủy đơn tự hoàn kho, trả hàng (toàn phần / một phần), tiền cọc và trạng thái thanh toán
- **Kiểm kê theo đợt:** tạo đợt, nhập số đếm thực tế nhiều sản phẩm (lưu nháp), chốt đợt sinh phiếu điều chỉnh; đối chiếu tồn kho từ sổ phiếu
- **Công nợ:** phải thu (bán chịu) / phải trả, ghi thanh toán, cảnh báo quá hạn
- **Báo cáo:** doanh thu theo ngày, top sản phẩm bán chạy, hàng sắp hết, lãi gộp (doanh thu − giá vốn), tổng hợp công nợ
- **Nhân viên & phân quyền:** đăng nhập bằng mã PIN, 3 vai trò (quản trị / thủ kho / nhân viên bán hàng), lịch sử thao tác (ai làm gì, khi nào)
- **Sao lưu & khôi phục:** sao lưu ngay (tải file JSON), tự động sao lưu khi mở app nếu bản mới nhất quá 24 giờ, khôi phục từ snapshot (chỉ quản trị, xác nhận 2 lần)
- **Công cụ hằng ngày:** xuất CSV (tồn kho, phiếu, đơn hàng, công nợ, lịch sử), nhập CSV sản phẩm, in phiếu nhập/xuất/đơn hàng
- **Đối tác & danh mục:** nhà cung cấp / khách hàng, sẵn 10 danh mục thiết bị vệ sinh

## Tài khoản mặc định — đọc kỹ khi mở app lần đầu

- Tài khoản quản trị đầu tiên được tạo tự động khi đăng nhập lần đầu: tên **“Chủ cửa hàng”**, mã PIN mặc định **123456**.
- Ở lần đăng nhập đầu tiên, app **bắt buộc đổi PIN** trước khi vào làm việc. Hãy đổi ngay thành PIN riêng (4–8 chữ số) và đừng chia sẻ PIN quản trị cho nhân viên bán hàng.
- Mã PIN chỉ lưu dạng băm SHA-256 + salt, không lưu PIN gốc. Tài khoản quản trị tạo thêm nhân viên (tên, vai trò, PIN) trong tab **Nhân viên & Sao lưu**.
- Phân quyền: chỉ quản trị được xóa sản phẩm/danh mục, đổi giá bán/nhập, khôi phục sao lưu, quản lý nhân viên; thủ kho được nhập/xuất/kiểm kê; nhân viên bán hàng được tạo đơn/giữ hàng/giao hàng/trả hàng nhưng không được sửa tồn trực tiếp.

## Sao lưu & khôi phục

- **Sao lưu ngay:** tab **Nhân viên & Sao lưu** → “Sao lưu ngay” (tạo snapshot trên server rồi tải file JSON về máy).
- **Tự động:** mỗi khi mở app sau khi đăng nhập, nếu snapshot mới nhất đã quá 24 giờ thì app tự tạo snapshot mới một lần. Đây là sao lưu theo phiên mở app, **không phải cron chạy nền trên server** — nếu nhiều ngày không mở app thì cũng không có snapshot mới.
- **Khôi phục:** chỉ quản trị, trong tab **Nhân viên & Sao lưu**, chọn snapshot → xác nhận 2 lần (lần 2 phải gõ đúng `KHOI PHUC`). Khôi phục sẽ ghi đè toàn bộ dữ liệu kho/đơn/phiếu/công nợ bằng snapshot. Tài khoản nhân viên hiện tại được giữ nguyên (không mất PIN); nhân viên chỉ có trong snapshot sẽ nhận PIN mặc định `123456` và phải đổi PIN ở lần đăng nhập đầu.
- File sao lưu JSON **không chứa mã PIN** (chỉ tên, vai trò, trạng thái).

## Cấu trúc mã nguồn

- `client/` — giao diện React + TypeScript (`client/src/App.tsx` là màn hình chính)
- `server/` — logic phía server và định nghĩa dữ liệu (`server/src/actions.ts`, `server/src/schema.ts`)
- `drizzle/` — các file SQL tạo bảng dữ liệu kho (`0003_stock_safety_and_ops.sql` thêm cột version/trạng thái tồn, mã chống trùng và 11 bảng vận hành mới)

## Chạy kiểm tra

```bash
bun install   # lưu ý: trong môi trường này có thể lỗi integrity check với @hatch/space-sdk (xem CHANGES.md)
bun run typecheck
bun run build:server
```

- `bun run typecheck`: kiểm tra kiểu cả client và server (đã về 0 lỗi ngày 2026-11-09).
- `bun run build:server`: đóng gói server thành `server/dist/actions.js`.
- `bun run build:client` (lệnh `bun ./client/build.mjs`) bị SDK chặn có chủ đích khi build tay — thông báo “This web artifact cannot be built by hand… call the `artifact.edit` tool”. Đây không phải lỗi code: artifact sẽ được build/publish lại bằng công cụ artifact khi triển khai. Kiểm tra nhanh bundle client có thể dùng `bun build ./client/src/main.tsx --outdir=/tmp/smoke-out` (chỉ để kiểm tra, cảnh báo `@utility`/`@theme` của Tailwind khi build không qua plugin là bình thường).

## Ghi chú

- Mã nguồn được xuất từ app đang chạy trên Muse. Dữ liệu kho thực tế (sản phẩm, đơn hàng, phiếu nhập/xuất đã nhập trong app) không nằm trong repo này.
- Xem `CHANGES.md` để biết chi tiết thay đổi theo từng bước và những giới hạn còn tồn tại, `TESTING.md` để biết checklist chạy thử tại cửa hàng.
