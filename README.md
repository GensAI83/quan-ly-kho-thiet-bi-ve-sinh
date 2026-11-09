# Quản lý kho thiết bị vệ sinh

App quản lý kho thiết bị vệ sinh — nhập/xuất kho, tồn kho, lịch sử giao dịch, đơn hàng và đối tác.

## Tính năng

- **Tổng quan:** giá trị tồn kho, nhập/xuất hôm nay, biểu đồ 7 ngày, cảnh báo sắp hết / hết hàng
- **Tồn kho:** mã SKU tự sinh theo danh mục (BC = bồn cầu, LV = lavabo, ST = sen tắm...), hãng, giá nhập / giá bán, vị trí kệ, tồn tối thiểu, tìm kiếm và lọc
- **Nhập / Xuất kho:** phiếu nhập (PN), phiếu xuất (PX) và kiểm kê, tự động cập nhật tồn, chặn xuất quá tồn, xóa phiếu hoàn tồn
- **Lịch sử nhập/xuất:** mã phiếu, lý do, đối tác, tồn trước → sau
- **Đơn hàng:** nhiều dòng hàng, xác nhận đơn tự trừ kho và sinh phiếu xuất, hủy đơn tự hoàn kho
- **Đối tác & danh mục:** nhà cung cấp / khách hàng, sẵn 10 danh mục thiết bị vệ sinh

## Cấu trúc mã nguồn

- `client/` — giao diện React + TypeScript (`client/src/App.tsx` là màn hình chính)
- `server/` — logic phía server và định nghĩa dữ liệu (`server/src/actions.ts`, `server/src/schema.ts`)
- `drizzle/` — các file SQL tạo bảng dữ liệu kho

## Ghi chú

Mã nguồn được xuất từ app đang chạy trên Muse. Dữ liệu kho thực tế (sản phẩm, đơn hàng, phiếu nhập/xuất đã nhập trong app) không nằm trong repo này.
