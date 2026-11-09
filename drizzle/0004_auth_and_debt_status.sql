-- Migration 0004: chống dò mã PIN + trạng thái công nợ "cancelled" khi hủy đơn.
-- Chống dò PIN: thêm failed_attempts / locked_until cho bảng staff; đăng nhập sai
-- 5 lần liên tiếp thì khóa 15 phút (xem loginStaff trong server/src/actions.ts).
-- Lưu ý: debts.status trong 0003 là cột TEXT thường, KHÔNG có CHECK constraint enum,
-- nên giá trị "cancelled" dùng được ngay mà không cần rebuild bảng debts; chỉ mở
-- rộng enum ở tầng TypeScript (server/src/schema.ts).
ALTER TABLE staff ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE staff ADD COLUMN locked_until INTEGER;
