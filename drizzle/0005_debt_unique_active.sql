-- Migration 0005: tối đa 1 công nợ đang hoạt động cho mỗi (mã tham chiếu, loại).
-- Gốc lỗi: mở lại đơn đã hủy tạo thêm công nợ mới thay vì kích hoạt lại khoản đã
-- void, nên xác nhận -> đang giao -> hoàn thành có thể tạo 3 khoản nợ cho cùng
-- một đơn (xem createReceivableDebtIfNeeded trong server/src/actions.ts).
-- Dọn trùng trước: với mỗi (ref_code, kind) chỉ giữ khoản đang hoạt động mới
-- nhất, các khoản cũ hơn chuyển sang "cancelled" (giữ lịch sử trong ghi chú).
-- Sau đó unique index có điều kiện chặn việc tạo khoản active thứ hai ở tầng DB.
-- Lưu ý: khoản đã thu đủ ("paid") được giữ lại khi hủy đơn để xử lý hoàn tiền
-- thủ công — hành vi đó không đổi (paid không tính là đang hoạt động).
UPDATE debts SET status = 'cancelled',
  note = note || ' | Dọn trùng khi nâng cấp 0005 — chỉ giữ 1 công nợ đang hoạt động cho mỗi đơn'
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY ref_code, kind ORDER BY id DESC) AS rn
    FROM debts WHERE status IN ('open', 'overdue')
  ) WHERE rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX debts_one_active_per_ref ON debts(ref_code, kind) WHERE status IN ('open', 'overdue');
