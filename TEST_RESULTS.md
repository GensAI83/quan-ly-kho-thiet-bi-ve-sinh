# TEST_RESULTS.md — Kết quả kiểm thử ngày 2026-11-09

Chạy sau đợt sửa 5 lỗi (xem `CHANGES.md` mục "Sửa 5 lỗi"). Cách chạy: harness
`bun tests/repro-5-bugs.ts` (Bun + SQLite trong bộ nhớ, gọi trực tiếp `Actions` handler)
và kiểm chứng phụ (migration, đổi PIN, hủy đơn với sản phẩm ngưng bán, nhập CSV, ma trận
phân quyền đầy đủ). Log đầy đủ: `tests/repro-before-fix.log`, `tests/repro-after-fix.log`,
`tests/verify-extra.log`.

Quy ước cột Kết quả:
- **Đạt** — đã chạy và đúng.
- **Đạt (mức code)** — đã chạy bằng harness/kiểm chứng phụ trên SQLite trong bộ nhớ, chưa chạy
  thao tác đó trên trình duyệt thật / tại cửa hàng.
- **Chưa chạy được** — cần đếm hàng thật tại cửa hàng, trình duyệt thật hoặc Muse runtime;
  KHÔNG ghi Đạt cho những mục này.

## A. Harness tái hiện 5 lỗi (`bun tests/repro-5-bugs.ts`)

| Nhóm | Trước sửa | Sau sửa |
|---|---|---|
| 1 — Vượt quyền (requireAuth + ma trận phân quyền + chống dò PIN) | 6/15 PASS | **15/15 PASS** |
| 2 — Kiểm kê chốt theo delta | 3/6 PASS | **6/6 PASS** |
| 3 — Trả hàng / hủy đơn không cộng thừa | 3/6 PASS | **7/7 PASS** |
| 4 — Công nợ khi hủy đơn / thu nợ | 2/5 PASS | **5/5 PASS** |
| 5 — Hooks sau early return (kiểm tra tĩnh `App.tsx`) | 1/3 PASS | **3/3 PASS** |
| Hồi quy (tồn không âm, hủy 2 lần, chống gửi trùng) | 6/6 PASS | **6/6 PASS** |
| **Tổng** | **21 PASS / 20 FAIL** | **42 PASS / 0 FAIL** |

Số liệu kiểm chứng trong harness (đúng kịch bản đã báo):
- Lỗi 1: `createStaff` admin không token → lỗi; sales tạo phiếu xuất → lỗi; không token tạo
  phiếu → lỗi; admin nhập/xuất được, thủ kho nhập/xuất được, sales tạo đơn được nhưng không tạo
  phiếu xuất/xóa sản phẩm/đổi giá/xem danh sách nhân viên được; token sai → hết hạn;
  5 lần sai PIN → đăng nhập đúng PIN bị khóa 15 phút.
- Lỗi 2: tồn 4, đếm 9 (diff +5), nhập thêm 5, chốt → tồn **14** (trước sửa: 9); phiếu điều
  chỉnh ghi before 9 → after 14, số lượng 5; diffs trả về theo tồn lúc chốt (9/9).
- Lỗi 3: tồn 10 → bán 2 (còn 8) → trả 1 (còn 9) → trả tiếp 1 được (còn 10) → hủy đơn tồn vẫn 10;
  trả 1 rồi hủy đơn tồn 10 (trước sửa: 11); trả quá số còn trả được bị chặn.
- Lỗi 4: hủy đơn → công nợ còn lại 0, trạng thái `cancelled`; đã cọc 40 rồi hủy →
  total = paid = 40, còn 0, `cancelled`; thu 100đ qua `recordDebtPayment` → đơn `paid`, cọc 100.
- Lỗi 5: mọi hook của `App()` đều nằm trước lần early return đầu tiên; 7 `useQuery` dữ liệu
  có `enabled: !!staff && !needPinChange`.

## B. Kiểm chứng phụ (36 mục, đều PASS — xem `tests/verify-extra.log`)

- Migration 0001→0004 trên SQLite trống: đủ 17 bảng (cộng bảng nội bộ `sqlite_sequence`);
  `staff` có cột `failed_attempts`/`locked_until`; `debts.status` nhận giá trị `cancelled`
  (không có CHECK constraint enum nên không cần rebuild bảng).
- Đổi PIN: đăng nhập PIN `123456` (`mustChangePin=1`) → đổi sang `654321` → PIN cũ không đăng
  nhập được, PIN mới đăng nhập được (`mustChangePin=0`).
- Hủy đơn khi sản phẩm đã ngưng bán: hoàn thành đơn → xóa sản phẩm (chuyển ngưng bán) → hủy đơn
  sinh 1 khoản hoàn kho chờ xử lý đúng số net (2).
- Nhập CSV (thủ kho): 2 dòng đúng vào kho, 1 dòng SKU trùng báo lỗi; sales nhập CSV bị chặn phân quyền.
- Ma trận phân quyền đầy đủ: sales bị chặn tạo phiếu batch, xóa phiếu, tạo đợt kiểm kê, tạo nhà
  cung cấp, đối chiếu apply, xuất sao lưu, khôi phục backup; thủ kho tạo đợt kiểm kê/nhà cung cấp/
  snapshot sao lưu được nhưng xuất sao lưu bị chặn; admin khôi phục backup được.
- 11 action đọc không token (`listDebts`, `listStocktakes`, `getPendingRestocks`,
  `listPriceHistory`, `listAuditLogs`, `listBackups`, `getReports`, `listSuppliers`,
  `listCategories`, `listOrders`, `listMovements`) đều lỗi "Cần đăng nhập…".

## C. Typecheck / build / migration

| Mục | Kết quả |
|---|---|
| `bun run typecheck` (client + server) | Đạt — 0 lỗi |
| `bun run build:server` | Đạt — `server/dist/actions.js` 0,33 MB |
| `bun run build` (tổng thể) | Chưa chạy được trọn vẹn — dừng ở `build:client` do SDK chặn build tay ("This web artifact cannot be built by hand…"), không phải lỗi code (đã có từ trước, xem `CHANGES.md`) |
| Kiểm chứng riêng client: `bun build ./client/src/main.tsx` | Đạt — `main.js` ~2,2 MB; chỉ cảnh báo `@utility`/`@theme` của Tailwind khi build không qua plugin (bình thường) |

## D. Checklist `TESTING.md` — đối chiếu từng mục

### 0. Chuẩn bị nhanh

| Mục | Kết quả | Ghi chú |
|---|---|---|
| Đăng nhập PIN `123456` → bắt đổi PIN → đổi PIN mới → đăng xuất → đăng nhập lại bằng PIN mới | Đạt (mức code) | Kiểm chứng phụ B1–B4: đổi PIN, PIN cũ fail, PIN mới ok. Thao tác đăng xuất/đăng nhập lại trên trình duyệt thật chưa chạy. |
| Tạo NV bán hàng → đăng nhập → không thấy tab Nhân viên & Sao lưu, nút Xóa sản phẩm bị khóa, ô giá bị khóa | Chưa chạy được | Cần trình duyệt thật. Phân quyền server đã kiểm chứng (sales bị chặn `listStaff`/`deleteProduct`/đổi giá); ẩn tab/nút là logic client theo vai trò, chưa chạy trên trình duyệt. |
| Đăng nhập thủ kho → làm được phiếu nhập/xuất, không xóa được sản phẩm | Đạt (mức code) | Harness 1d-2 + kiểm chứng phụ E4/E6; thao tác trên trình duyệt thật chưa chạy. |

### 1. Đối chiếu tồn app với hàng thực tế

| Mục | Kết quả | Ghi chú |
|---|---|---|
| Đếm tay 3–5 mặt hàng trong kho, so với số tồn trên tab Tồn kho | Chưa chạy được | Cần đếm hàng thật tại cửa hàng. |
| Kiểm kê: tạo đợt → nhập số đếm → lưu nháp → tải lại app vẫn còn → chốt → tồn đổi, phiếu điều chỉnh, báo cáo chênh lệch | Đạt (mức code) | Harness nhóm 2: lưu nháp, chốt theo delta (tồn 14), phiếu điều chỉnh 9→14. "Tải lại app vẫn còn" và xem báo cáo trên trình duyệt chưa chạy. |
| Đối chiếu tồn kho → danh sách lệch khớp chênh lệch đếm tay; chốt lại tồn (admin) | Chưa chạy được | Cần đếm hàng thật tại cửa hàng. Logic đối chiếu/apply: thủ kho apply bị chặn đã kiểm chứng (E7). |
| Đối chiếu khi tồn đúng: danh sách lệch rỗng | Chưa chạy được | Cần dữ liệu thật tại cửa hàng. |

### 2. Mất mạng

| Mục | Kết quả | Ghi chú |
|---|---|---|
| Tắt mạng → banner đỏ → "Thử lại" khi chưa có mạng → vẫn báo mất mạng, không ghi gì thêm | Chưa chạy được | Cần trình duyệt thật + tắt mạng thật. |
| Bật lại mạng → "Thử lại" → banner biến mất, dữ liệu tải lại đúng | Chưa chạy được | Cần trình duyệt thật. |
| Mở form phiếu xuất, tắt mạng, bấm "Ghi phiếu xuất" → báo rõ chưa ghi gì, không có phiếu nào được ghi | Chưa chạy được | Cần trình duyệt thật. |
| Bật mạng, bấm lại đúng phiếu đó 2 lần → chỉ 1 phiếu (nhờ `requestKey`) | Đạt (mức code) | Harness R3a/R3b: gửi trùng `requestKey` chỉ ghi 1 phiếu/1 đơn. Thao tác bấm trên trình duyệt chưa chạy. |
| Tương tự với tạo đơn: tắt mạng → lỗi rõ ràng → bật mạng → bấm lại 2 lần → chỉ 1 đơn | Chưa chạy được | Cần trình duyệt thật (phần chống trùng đã kiểm chứng mức code ở R3b). |

### 3. Thao tác nhầm

| Mục | Kết quả | Ghi chú |
|---|---|---|
| Nhập sai số lượng phiếu nhập → xóa phiếu → tồn về số trước phiếu | Chưa chạy được | Cần trình duyệt thật. Logic `deleteMovement` không đổi đợt này; sales xóa phiếu bị chặn đã kiểm chứng (E2). |
| Xóa nhầm sản phẩm: còn tồn → chặn; đã có lịch sử → chuyển "Ngưng bán", lịch sử cũ vẫn còn | Đạt (mức code) | Kiểm chứng phụ C0–C1: hoàn thành đơn rồi xóa → `discontinued`. Chặn xóa khi còn tồn là logic cũ, chưa có test riêng đợt này. |
| Tạo đơn, xác nhận, hủy đơn → tồn hoàn đúng số; phiếu "Hoàn kho do huỷ đơn" xuất hiện | Đạt (mức code) | Harness nhóm 3 + R2. |
| Hủy đơn mà 1 sản phẩm đã ngưng bán → khoản hoàn kho chờ xử lý ở Tổng quan | Đạt (mức code) | Kiểm chứng phụ C2: hủy đơn với sản phẩm ngưng bán sinh `pendingRestocks` đúng số net. Hiển thị cảnh báo trên trình duyệt chưa chạy. |
| Thêm lại sản phẩm đúng mã SKU → "Đối chiếu" → tồn cộng lại, khoản chờ biến mất | Chưa chạy được | Cần làm tại cửa hàng. Logic `resolvePendingRestock` không đổi đợt này. |
| Đổi giá → đơn sau dùng giá mới, đơn cũ giữ giá cũ; lịch sử giá đủ giá cũ/mới + lý do | Chưa chạy được | Cần trình duyệt thật. Phân quyền đổi giá (chỉ admin) đã kiểm chứng (1d-5); logic `price_history` không đổi đợt này. |
| Đổi đơn vị của sản phẩm còn tồn → chặn; tồn = 0 và chưa có phiếu → cho đổi, có nhật ký | Chưa chạy được | Cần trình duyệt thật. Logic không đổi đợt này. |
| Khôi phục sau thao tác nhầm: tab Lịch sử → lọc theo người + ngày → tìm được thao tác | Chưa chạy được | Cần trình duyệt thật. `listAuditLogs` yêu cầu đăng nhập đã kiểm chứng (E13); lọc trên giao diện chưa chạy. |

### 4. Nhiều người dùng cùng lúc

| Mục | Kết quả | Ghi chú |
|---|---|---|
| Hai máy cùng tạo phiếu xuất 5 cái trên tồn 5 → chỉ 1 thành công, người còn lại lỗi tồn/version, tồn cuối 0, không âm | Chưa chạy được | Cần 2 máy/tài khoản thật. Chống xuất quá tồn + tồn không âm đã kiểm chứng mức code (R1a/R1b). |
| Hai người cùng tạo đơn xác nhận đến giới hạn tồn → tổng trừ không vượt tồn, đơn thiếu hàng báo lỗi | Chưa chạy được | Cần 2 máy/tài khoản thật. Chặn đơn vượt tồn đã kiểm chứng mức code (R1b). |
| Một người sửa giá, một người xuất cùng sản phẩm → xuất đúng số lượng, giá đơn lấy theo lúc tạo | Chưa chạy được | Cần 2 máy/tài khoản thật. |

### 5. Quy trình bán hàng đầy đủ

| Mục | Kết quả | Ghi chú |
|---|---|---|
| Giữ hàng → tồn giảm, "Đang giữ X" → hủy giữ → tồn hoàn, "Đang giữ" về 0 | Chưa chạy được | Cần trình duyệt thật. `releaseReservation` đợt này chỉ thêm void công nợ + yêu cầu đăng nhập; chưa có harness riêng cho luồng giữ/hủy giữ. |
| Tạo đơn → cọc một phần → "Cọc một phần", công nợ giảm → giao hàng → hoàn thành → công nợ còn lại đúng | Đạt (mức code, một phần) | Harness 4a2: cọc 40 rồi hủy đơn (đồng bộ cọc/công nợ đúng). Giao hàng/hoàn thành trên giao diện chưa chạy. |
| Trả hàng 1 phần → tồn tăng 1, "Trả một phần", công nợ giảm; trả tiếp quá số đã giao → chặn | Đạt (mức code) | Harness nhóm 3: trả 1, trả tiếp được, trả quá bị chặn (3ii-a2). Hiển thị công nợ trên giao diện chưa chạy. |
| Phiếu nhập nhiều mặt hàng: 1 phiếu 3 dòng → 1 mã PN chung, tồn cả 3 tăng đúng; 1 dòng sai → cả phiếu không ghi | Chưa chạy được | Cần trình duyệt thật. Logic batch không đổi đợt này; sales tạo batch bị chặn đã kiểm chứng (E1). |
| Sao lưu: "Sao lưu ngay" → tải JSON → xóa thử sản phẩm → khôi phục (gõ `KHOI PHUC`) → sản phẩm quay lại | Đạt (mức code, một phần) | Kiểm chứng phụ E10/E12: thủ kho tạo snapshot được, admin khôi phục được, sales khôi phục bị chặn. Tải file + gõ xác nhận trên giao diện chưa chạy. |
| In phiếu: xem trước đúng mã/dòng/tổng tiền → in thử → bản in chỉ có phiếu | Chưa chạy được | Cần trình duyệt/máy in thật. |
| Nhập CSV: 2 dòng đúng + 1 dòng sai (SKU trùng) → 2 dòng vào, dòng sai báo lỗi; xuất CSV mở bằng Excel đọc được tiếng Việt | Đạt (mức code, một phần) | Kiểm chứng phụ D1: nhập 2 đúng + 1 lỗi SKU trùng. Xuất CSV + mở bằng Excel chưa chạy. |

### 6. Kiểm tra sau khi chạy thử

| Mục | Kết quả | Ghi chú |
|---|---|---|
| `bun run typecheck` (0 lỗi) sau mọi lần sửa code | Đạt | 0 lỗi (xem mục C). |
| Đối chiếu cuối ngày: tổng tồn trên app = hàng đếm tay; doanh thu tab Báo cáo khớp tiền bán thực tế | Chưa chạy được | Cần làm tại cửa hàng cuối ngày bán thật. |
| Ghi lại mọi lỗi gặp phải | — | Chưa phát sinh lỗi mới trong đợt kiểm thử bằng code (xem mục A–C). |

## Tóm tắt

- **Đạt (kể cả mức code):** harness 42/42, kiểm chứng phụ 36/36, typecheck 0 lỗi,
  `build:server` thành công, migration 0001→0004 áp được lên SQLite trống (đủ 17 bảng,
  đủ cột mới, `debts.status` nhận `cancelled`).
- **Chưa chạy được:** mọi mục cần đếm hàng thật tại cửa hàng, trình duyệt thật, tắt mạng thật,
  2 máy/tài khoản cùng lúc, in phiếu, mở CSV bằng Excel — phải chạy theo `TESTING.md`
  trước khi dùng cho bán hàng thật.
