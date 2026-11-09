# TESTING.md — Checklist chạy thử tại cửa hàng

Chạy thử trước khi dùng app cho bán hàng thật. Chuẩn bị: đăng nhập bằng tài khoản quản trị (PIN mặc định `123456`, đổi PIN ngay lần đầu), thêm 2–3 sản phẩm thử (tồn nhỏ, ví dụ 10 cái), 1 nhà cung cấp thử. Ghi lại kết quả từng mục: Đạt / Không đạt + ghi chú.

## 0. Chuẩn bị nhanh

- [ ] Đăng nhập PIN `123456` → app bắt đổi PIN → đổi thành PIN mới → đăng xuất → đăng nhập lại bằng PIN mới được.
- [ ] Tạo 1 nhân viên bán hàng (PIN riêng) → đăng nhập bằng tài khoản đó → không thấy tab Nhân viên & Sao lưu, nút Xóa sản phẩm bị khóa, ô giá khi sửa sản phẩm bị khóa.
- [ ] Đăng nhập thủ kho → làm được phiếu nhập/xuất, không xóa được sản phẩm.

## 1. Đối chiếu tồn app với hàng thực tế

- [ ] Đếm tay 3–5 mặt hàng trong kho, so với số tồn trên tab Tồn kho. Ghi lại mặt hàng nào lệch.
- [ ] Tab Kiểm kê → tạo đợt kiểm kê → nhập số đếm thực tế cho các mặt hàng đã đếm → lưu nháp → kiểm tra số đếm đã lưu (tải lại app vẫn còn) → chốt đợt → kiểm tra: tồn từng mặt hàng lệch đã đổi về số đếm, phiếu điều chỉnh đã sinh trong Lịch sử nhập/xuất, báo cáo chênh lệch hiển thị đúng.
- [ ] Tab Kiểm kê → “Đối chiếu tồn kho” → danh sách lệch phải khớp với chênh lệch vừa đếm tay (trước khi chốt). Nếu còn lệch sau khi chốt: bấm “Chốt lại tồn theo sổ phiếu” (chỉ admin) → kiểm tra tồn đã về đúng số theo sổ phiếu và có phiếu kiểm kê + nhật ký.
- [ ] Thử đối chiếu khi tồn đúng: danh sách lệch phải rỗng.

## 2. Mất mạng (app cần mạng — mục này kiểm tra hành vi khi rớt mạng)

- [ ] Tắt wifi/dữ liệu di động trên máy → banner đỏ “Mất kết nối mạng” hiện lên → bấm “Thử lại” khi chưa có mạng → vẫn báo mất mạng, không ghi gì thêm.
- [ ] Bật lại mạng → bấm “Thử lại” → banner biến mất, dữ liệu tải lại đúng.
- [ ] Mở form phiếu xuất, tắt mạng, bấm “Ghi phiếu xuất” → phải báo rõ “Không có mạng, chưa ghi gì — bấm lại sau khi có mạng”, và **không** có phiếu nào được ghi (kiểm tra Lịch sử nhập/xuất sau khi có mạng).
- [ ] Bật mạng, bấm lại đúng phiếu đó 2 lần liên tiếp → chỉ có **1 phiếu** được ghi (nhờ mã chống gửi trùng `requestKey`). Kiểm tra mã phiếu không trùng nhau.
- [ ] Tương tự với tạo đơn hàng: tắt mạng → tạo đơn lỗi rõ ràng → bật mạng → bấm lại 2 lần → chỉ 1 đơn.

## 3. Thao tác nhầm (xóa nhầm, hủy nhầm, nhập sai số)

- [ ] Nhập sai số lượng phiếu nhập (ví dụ nhập 100 thay vì 10) → xóa phiếu vừa ghi (nút “Xoá phiếu & hoàn tồn” ở Lịch sử) → tồn phải trở về số trước phiếu đó.
- [ ] Xóa nhầm sản phẩm: sản phẩm còn tồn → app phải **chặn** và báo lý do; sản phẩm đã có lịch sử bán → bấm Xóa → sản phẩm chuyển “Ngưng bán” chứ không biến mất, lịch sử phiếu/đơn cũ vẫn còn.
- [ ] Tạo đơn, xác nhận (đã trừ kho), rồi hủy đơn → tồn phải hoàn lại đúng số; phiếu “Hoàn kho do huỷ đơn” xuất hiện trong Lịch sử.
- [ ] Hủy đơn mà 1 sản phẩm trong đơn đã bị ngưng bán → đơn vẫn hủy được, khoản hoàn kho của sản phẩm đó phải xuất hiện trong cảnh báo “Hoàn kho chờ xử lý” ở Tổng quan (không được mất hàng trong im lặng) → thêm lại sản phẩm đúng mã SKU → bấm “Đối chiếu” → tồn được cộng lại, khoản chờ xử lý biến mất.
- [ ] Đổi giá bán của 1 sản phẩm → kiểm tra: đơn tạo **sau** đó dùng giá mới, đơn cũ giữ giá cũ; tab Lịch sử giá của sản phẩm ghi đủ giá cũ/mới + lý do.
- [ ] Đổi đơn vị của sản phẩm còn tồn → app phải chặn; đổi đơn vị của sản phẩm tồn = 0 và chưa có phiếu → cho đổi, có ghi nhật ký.
- [ ] Khôi phục sau thao tác nhầm: tab Lịch sử → lọc theo tên người + ngày → tìm được thao tác vừa làm (ai, làm gì, lúc nào); phiếu xóa nhầm gần nhất chỉ khôi phục được bằng cách nhập lại phiếu mới (app chưa có nút hoàn tác 1 chạm — ghi chú lại nếu cửa hàng cần).

## 4. Nhiều người dùng cùng lúc

- [ ] Hai máy/2 tài khoản cùng mở 1 sản phẩm còn đúng 5 cái. Cả hai cùng tạo phiếu xuất 5 cái gần như cùng lúc → chỉ 1 người thành công; người còn lại phải nhận lỗi tồn/version (“số tồn vừa thay đổi, vui lòng tải lại”) và tồn cuối cùng **không âm**, đúng bằng 0.
- [ ] Hai người cùng tạo đơn xác nhận cho cùng 1 mặt hàng đến giới hạn tồn → tổng số đã trừ không vượt tồn; đơn thiếu hàng phải báo lỗi rõ ràng, không tạo đơn “âm kho”.
- [ ] Một người đang sửa giá, một người đang xuất cùng sản phẩm → người xuất sau khi giá đổi vẫn xuất đúng số lượng; giá trên đơn lấy theo giá tại lúc tạo đơn.

## 5. Quy trình bán hàng đầy đủ (đi hết 1 vòng)

- [ ] Tạo đơn giữ hàng (trạng thái giữ hàng + hạn giữ) → tồn giảm, sản phẩm hiện “Đang giữ X” → hủy giữ → tồn hoàn lại, “Đang giữ” về 0.
- [ ] Tạo đơn mới → ghi nhận cọc một phần → trạng thái thanh toán “Cọc một phần”, công nợ phải thu giảm đúng số cọc → giao hàng (nhập người giao/phí giao) → hoàn thành → công nợ còn lại đúng.
- [ ] Trả hàng 1 phần: chọn 1 dòng, trả 1 cái → tồn tăng 1, đơn thành “Trả một phần”, công nợ giảm; trả tiếp quá số đã giao → app phải chặn.
- [ ] Phiếu nhập nhiều mặt hàng: 1 phiếu 3 dòng → 1 mã PN chung, tồn cả 3 mặt hàng tăng đúng; thử 1 dòng sai (xuất quá tồn trong phiếu xuất nhiều mặt hàng) → **cả phiếu không ghi**, tồn không đổi.
- [ ] Sao lưu: bấm “Sao lưu ngay” → tải được file JSON về máy → xóa thử 1 sản phẩm (hết tồn, chưa có lịch sử) → khôi phục từ snapshot vừa tạo (gõ `KHOI PHUC`) → sản phẩm quay lại. Lưu ý: khôi phục ghi đè toàn bộ dữ liệu — chỉ thử trên dữ liệu thử, không thử trên dữ liệu bán thật.
- [ ] In phiếu: mở chi tiết phiếu/đơn → “In phiếu” → xem trước đúng mã phiếu, dòng hàng, tổng tiền → in thử (hoặc xem trước khi in) → bản in chỉ có phiếu, không in cả menu/nút.
- [ ] Nhập CSV: tải file mẫu → nhập 2 dòng đúng + 1 dòng sai (SKU trùng) → 2 dòng vào kho, dòng sai báo lỗi rõ từng dòng, không ghi dòng sai. Xuất CSV tồn kho → mở bằng Excel đọc được tiếng Việt.

## 6. Kiểm tra sau khi chạy thử

- [ ] Chạy `bun run typecheck` (0 lỗi) sau mọi lần sửa code trong đợt chạy thử.
- [ ] Đối chiếu cuối ngày: tổng tồn trên app = hàng đếm tay; doanh thu trong tab Báo cáo khớp với tiền bán thực tế trong ngày (trừ phần trả hàng/cọc).
- [ ] Ghi lại mọi lỗi gặp phải (màn hình nào, thao tác nào, thông báo gì) để sửa trước khi dùng thật.
