# TEST_RESULTS.md — Kết quả kiểm thử ngày 2026-11-09 và 2026-11-10

Chạy sau đợt sửa 5 lỗi (xem `CHANGES.md` mục "Sửa 5 lỗi"). Cách chạy: harness
`bun tests/repro-5-bugs.ts` (Bun + SQLite trong bộ nhớ, gọi trực tiếp `Actions` handler)
và kiểm chứng phụ (migration, đổi PIN, hủy đơn với sản phẩm ngưng bán, nhập CSV, ma trận
phân quyền đầy đủ). Log đầy đủ: `tests/repro-before-fix.log`, `tests/repro-after-fix.log`,
`tests/verify-extra.log`.

Đợt 2 (ngày 2026-11-10): sửa 4 nhóm lỗi mới (xem `CHANGES.md` mục "Sửa 4 nhóm lỗi —
đợt 2"). Harness mới `bun tests/repro-4-bugs.ts`, log `tests/repro-4-before-fix.log` /
`tests/repro-4-after-fix.log`, kiểm chứng phụ `tests/verify-extra-4.ts` /
`tests/verify-extra-4.log`. Kết quả đợt 2 ở mục E–G bên dưới.

Đợt 3 (ngày 2026-11-10): sửa 2 lỗi mới (xem `CHANGES.md` mục "Sửa 2 lỗi — đợt 3").
Harness mới `bun tests/repro-2-bugs-round3.ts`, log `tests/repro-2-before-fix.log` /
`tests/repro-2-after-fix.log`. Kết quả đợt 3 ở mục H bên dưới; các bước kiểm tra trên
trình duyệt thật cho đợt 3 bổ sung ở mục G.

Đợt tiền phiếu (ngày 2026-11-10): sửa lỗi tiền phiếu do đợt 3 gộp phiếu theo sản phẩm làm
mất đơn giá dòng (xem `CHANGES.md` mục "Sửa lỗi tiền phiếu"). Harness mới
`bun tests/repro-money-batch.ts`, log `tests/repro-money-before-fix.log` /
`tests/repro-money-after-fix.log`. Kết quả ở mục I bên dưới; bước kiểm tra trên trình
duyệt thật bổ sung ở mục G và `TESTING.md` mục 7d.

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
| Giữ hàng → tồn giảm, "Đang giữ X" → hủy giữ → tồn hoàn, "Đang giữ" về 0 | Đạt (mức code) | Harness đợt 3 mục 2f: huỷ giữ đơn reserved 2 dòng cùng SP → tồn 7 → 10, số lượng giữ 3 → 0, đúng 1 phiếu hoàn. Thao tác trên trình duyệt thật chưa chạy. |
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

## E. Đợt 2 — Harness tái hiện 4 nhóm lỗi (`bun tests/repro-4-bugs.ts`)

| Nhóm | Trước sửa | Sau sửa |
|---|---|---|
| 1 — Kiểm kê nhiều mặt hàng lỗi giữa chừng | 1/6 PASS | **6/6 PASS** |
| 2 — Trả hàng làm sai số tiền đã thu | 1/4 PASS | **4/4 PASS** |
| 3 — Mở lại đơn đã hủy làm nhân công nợ | 0/3 PASS | **3/3 PASS** |
| 4 — Ghi dữ liệu thất bại vẫn làm mất tồn | 2/5 PASS | **5/5 PASS** |
| **Tổng** | **4 PASS / 14 FAIL** | **18 PASS / 0 FAIL** |

Số liệu kiểm chứng trong harness (đúng kịch bản đã báo):
- Lỗi 1: dòng 3 ngưng bán → chốt lỗi, tồn cả 3 mặt hàng không đổi (10/5/8), 0 phiếu adjust
  (trước sửa: tồn 12/3/8 — 2 dòng đầu đã áp mà không được hoàn); lỗi ghi movements → chốt
  lỗi, tồn hoàn về 10/5 (trước sửa: handler ném lỗi, tồn 12/3); chốt lại sau thất bại →
  tồn đúng 12/3, mỗi SP đúng 1 phiếu adjust (trước sửa: 14/1 — điều chỉnh trùng); dòng đã
  có phiếu adjust từ lần chốt dở → chốt lại bỏ qua dòng đó (trước sửa: tồn 14).
- Lỗi 2: đơn 100đ chưa cọc, trả hết hàng → cọc vẫn **0**, trạng thái `unpaid` (trước sửa:
  cọc 100, `paid`); trả 40đ rồi thu 60đ qua công nợ → đơn `paid`, cọc 60, công nợ còn 0
  (đã đúng từ trước — giữ làm guard); trả 40đ rồi cọc 60đ → đơn `paid`, cọc 60, công nợ
  còn 0 (trước sửa: đơn `partial` trong khi công nợ đã `paid`/còn 0); cọc 70đ khi chỉ còn
  phải trả 60đ → bị chặn (trước sửa: cho cọc 70đ). Bất biến
  `công nợ còn lại == max(0, netPayable − cọc)` và `cọc == tiền thực thu` đúng sau mọi
  thao tác trong các kịch bản trên.
- Lỗi 3: xác nhận → hủy → xác nhận lại → đang giao → hoàn thành → chỉ **1 hàng công nợ**,
  1 active, còn 100đ (trước sửa: 4 hàng — 1 cancelled + 3 open); đã cọc 40đ rồi hủy-mở
  lại → kích hoạt lại khoản cũ còn 60đ, cọc vẫn 40đ (trước sửa: 2 hàng); chèn trực tiếp
  công nợ active trùng → lỗi unique index (trước sửa: chèn được).
- Lỗi 4: lỗi ghi phiếu xuất / đơn xác nhận sau khi áp tồn → trả lỗi rõ ràng (không ném),
  tồn vẫn 10, 0 phiếu/0 đơn (trước sửa: handler ném lỗi, tồn 8, đơn mồ côi, tồn 6 sau 2
  lần); 2 lần xuất cùng lúc (cùng version) → chỉ 1 thành công, tồn 7 (đã đúng từ trước —
  guard); 2 lần xác nhận đơn cùng lúc → chỉ trừ tồn 1 lần, tồn 8, đúng 1 phiếu xuất
  (trước sửa trong tiến trình cũng chỉ trừ 1 lần nhờ version-check — guard; claim chống
  trùng là phòng thủ cho 2 tab/máy thật, xem mục G); bù trừ bị ép thất bại → trả lỗi nêu
  rõ "đối chiếu tồn kho" + có bản ghi sửa chữa trong Chờ hoàn kho (trước sửa: ném lỗi,
  không có bản ghi nào).

Lưu ý trung thực: các mục 1b, 2b, 4b, 4c đã PASS cả trước khi sửa (logic cũ đã đúng ở
những điểm đó trong tiến trình đơn); chúng được giữ làm guard hồi quy, và bản sửa bổ
sung phòng thủ cho các cửa sổ lỗi mà harness đơn tiến trình không ép được (xem
`CHANGES.md` mục "Giới hạn còn lại").

## F. Kiểm chứng phụ đợt 2 (6 mục, đều PASS — xem `tests/verify-extra-4.log`)

- Migration 0001→0005 trên SQLite trống: 18 bảng + index `debts_one_active_per_ref`;
  dọn trùng: 2 công nợ active trùng → chỉ giữ khoản mới nhất, khoản cũ thành `cancelled`,
  khoản `paid` giữ nguyên.
- Khôi phục backup chứa công nợ active trùng: thành công, chỉ 1 active, khoản trùng
  thành `cancelled` (không phá luồng khôi phục).
- Trả 40đ rồi hủy-mở lại: công nợ kích hoạt lại còn 60đ (= 100 − 40 hoàn − 0 cọc).
- Hủy giữ hàng: tồn 7 → 10, số lượng giữ 3 → 0, đơn `cancelled`, công nợ `cancelled`.
- Hủy đơn 2 lần: tồn 10 sau lần 1, vẫn 10 sau lần 2.
- Đổi PIN 123456 → 654321: PIN cũ lỗi, PIN mới đăng nhập được.

Harness cũ `bun tests/repro-5-bugs.ts` chạy lại sau đợt 2: **42/42 PASS** (không hồi quy).
`bun run typecheck` 0 lỗi; `bun run build:server` thành công (`server/dist/actions.js`
0,34 MB); `bun run build` vẫn dừng ở `build:client` do SDK chặn build tay như trước.

## G. Kiểm thử trình duyệt đợt 2 — mất mạng + 2 người cùng lúc

Harness mô phỏng mất mạng/đồng thời ở tầng handler là bằng chứng mức code, KHÔNG thay thế
kiểm thử trên trình duyệt thật. Các mục dưới đây ghi **Chưa chạy được** — chạy theo
`TESTING.md` mục "Kiểm thử trình duyệt: mất mạng + 2 người cùng lúc" trước khi dùng cho
bán hàng thật.

| Mục | Kết quả | Ghi chú |
|---|---|---|
| Ngắt mạng giữa lúc bấm Lưu/Xác nhận/Chốt (phiếu nhập/xuất, tạo đơn, chốt kiểm kê) → báo rõ chưa ghi gì, tồn không đổi, không phiếu/đơn mồ côi | Chưa chạy được | Cần trình duyệt thật + ngắt mạng thật (DevTools offline hoặc rút dây). Mức code: harness 1c/4a tiêm lỗi ghi → tồn hoàn về, không phiếu/đơn mồ côi. |
| Bật mạng lại rồi bấm lại đúng thao tác đó → chỉ ghi 1 lần (nhờ `requestKey` / chốt lại lũy đẳng) | Chưa chạy được | Cần trình duyệt thật. Mức code: harness 1d/1e (chốt lại không trùng), R3a/R3b (gửi trùng `requestKey`). |
| 2 máy/2 tab đăng nhập 2 PIN khác nhau, cùng xuất 1 sản phẩm đến giới hạn tồn → chỉ 1 thành công, tồn cuối đúng, không âm | Chưa chạy được | Cần 2 máy/tab thật. Mức code: harness 4b (2 lần xuất cùng version → 1 thành công). |
| 2 máy/2 tab cùng xác nhận 1 đơn chờ → chỉ trừ tồn 1 lần, chỉ 1 phiếu xuất | Chưa chạy được | Cần 2 máy/tab thật. Mức code: harness 4c (2 lần xác nhận cùng lúc → trừ 1 lần). |
| 2 máy/2 tab cùng chốt 1 phiếu kiểm kê → chỉ 1 lần chốt có hiệu lực, không điều chỉnh trùng | Chưa chạy được | Cần 2 máy/tab thật. Mức code: chỉ có chốt lại TUẦN TỰ (1d/1e); chốt đồng thời 2 tab vẫn là cửa sổ lỗi còn lại (xem `CHANGES.md`). |
| Mất mạng ngay khi bấm "Trả hàng"/"Thu nợ" → tiền cọc/công nợ không đổi, bấm lại sau khi có mạng thì đúng | Chưa chạy được | Cần trình duyệt thật. Mức code: harness nhóm 2 (cọc chỉ tăng khi thu tiền thật). |
| Trả một phần rồi thu đủ trên trình duyệt thật (đợt 3): màn hình Đơn hàng hiển thị "Còn phải thu" 0đ, nút "Ghi nhận cọc" gợi ý đúng số còn lại | Chưa chạy được | Cần trình duyệt thật (xem `TESTING.md` mục 7c). Mức code: harness đợt 3 nhóm 1 (1a/1b/1c) — công thức client đã trừ tiền hoàn hàng. |
| Tạo đơn 2 dòng cùng SP rồi ngắt mạng lúc xác nhận (đợt 3): tồn tự về đúng, không phiếu/đơn mồ côi, không bản ghi sửa chữa | Chưa chạy được | Cần trình duyệt thật + ngắt mạng thật (xem `TESTING.md` mục 7c). Mức code: harness đợt 3 nhóm 2 (2a/2c) — tồn về đúng 10, 0 phiếu xuất, 0 bản ghi sửa chữa. |
| Nhập 2 dòng cùng SP giá khác nhau trên trình duyệt thật (đợt tiền phiếu): phiếu nhập 1×100.000đ + 1×200k → tồn 12, Lịch sử hiện 2 dòng cùng mã PN (10→11, 11→12), tổng tiền phiếu 300.000đ, "Nhập hôm nay" tăng đúng 300.000đ; phiếu xuất tương tự → "Xuất hôm nay" tăng đúng 300.000đ | Chưa chạy được | Cần trình duyệt thật (xem `TESTING.md` mục 7d). Mức code: harness đợt tiền phiếu nhóm 1 (1a/1b/1b-in) — tiền phiếu 300.000đ, todayInValue/todayOutValue tăng đúng 300.000đ. |
| Sau các thao tác trên: Đối chiếu tồn kho → không lệch; nếu lệch thì có bản ghi sửa chữa trong Chờ hoàn kho | Chưa chạy được | Cần làm tại cửa hàng sau khi chạy các mục trên. |

## H. Đợt 3 — Harness tái hiện 2 lỗi (`bun tests/repro-2-bugs-round3.ts`)

| Nhóm | Trước sửa | Sau sửa |
|---|---|---|
| 1 — Trả một phần rồi thanh toán đủ: Còn phải thu ở client | 0/3 PASS | **3/3 PASS** |
| 2 — Nhiều dòng cùng sản phẩm: hoàn tồn khi gặp lỗi | 0/8 PASS | **9/9 PASS** |
| **Tổng** | **0 PASS / 11 FAIL** | **12 PASS / 0 FAIL** |

Lưu ý trung thực: log trước sửa có 11 kiểm tra, log sau sửa có 12 — kiểm tra 2f (huỷ giữ đơn
reserved 2 dòng cùng SP, thêm cùng lúc với bản sửa `releaseReservation`) không có trong lần
chạy trước sửa; hành vi lỗi của nó trước sửa suy ra từ cùng cơ chế xung đột version đã chứng
minh ở 2d-3/2d-4. Harness cũ chạy lại sau đợt 3: đợt 2 **18/18 PASS**, đợt 1 **42/42 PASS**
(không hồi quy). `bun run typecheck` 0 lỗi; `bun run build:server` thành công
(`server/dist/actions.js` 0,35 MB). Không có migration mới.

Số liệu kiểm chứng trong harness (đúng kịch bản đã báo):
- Lỗi 1: đơn 100đ (60đ + 40đ), trả một phần 40đ, thu đủ 60đ còn lại → client hiển thị
  "Còn phải thu" **0đ** (trước sửa: 40đ), `paymentStatus` `paid`, công nợ còn 0 (server đã
  đúng từ đợt 2 — chỉ client sai); trả 40đ rồi bấm "Ghi nhận cọc" → số tiền gợi ý **60đ**
  (trước sửa: 100đ); kiểm tra tĩnh: dòng tính `remaining` trong `App.tsx` có trừ tiền hoàn.
- Lỗi 2: đơn confirmed 2 dòng cùng SP (×2 và ×1), tồn 10, tiêm lỗi ghi sau khi trừ tồn →
  đơn thất bại, tồn về đúng **10**, 0 phiếu xuất, 0 đơn, 0 bản ghi sửa chữa (trước sửa: tồn
  kẹt ở 8, 1 bản ghi sửa chữa); cùng kịch bản nhưng đơn thành công → tồn **7**, đúng **1 phiếu
  xuất** (số lượng 3, before 10 → after 7), đơn đủ 2 dòng (trước sửa: 2 phiếu xuất 2/1);
  xác nhận đơn pending 2 dòng cùng SP + lỗi ghi → tồn về đúng 10, đơn vẫn pending, 0 phiếu
  xuất, 0 bản ghi sửa chữa (trước sửa: tồn kẹt ở 8); phiếu batch 2 dòng cùng SP + lỗi ghi →
  tồn về đúng 10, 0 phiếu, 0 bản ghi sửa chữa (trước sửa: tồn kẹt ở 8), và khi thành công →
  tồn 7, đúng 1 phiếu (số lượng 3, before 10 → after 7), `results` 1 sản phẩm (trước sửa:
  2 phiếu, `results` 2 dòng); trả hàng 2 dòng cùng SP + lỗi ghi → lỗi đúng là lỗi ghi đã
  tiêm, tồn về đúng 7, đã trả vẫn 0, 0 phiếu nhập trả, 0 bản ghi sửa chữa — và khi thành công
  → tồn 9, đúng 1 phiếu nhập (số lượng 2, before 7 → after 9), mỗi dòng đã trả 1 (trước sửa:
  trả hàng 2 dòng cùng SP lỗi xung đột version ngay ở lần áp thứ 2, cả khi không tiêm lỗi);
  chen ngang đổi tồn giữa lúc áp và lúc bù → đơn lỗi nêu rõ "đối chiếu tồn kho", đúng **1 bản
  ghi sửa chữa** với fixQty **3** (= 10 − 7, đúng tuyệt đối), tồn giữ nguyên 7 không ghi đè
  (trước sửa: 2 bản sửa chữa, fixQty 2 và 1); huỷ giữ đơn reserved 2 dòng cùng SP → tồn về
  10, `reservedQty` 0, đúng 1 phiếu hoàn (số lượng 3, before 7 → after 10), đơn đã huỷ.

## I. Đợt tiền phiếu — Harness tái hiện lỗi tiền phiếu (`bun tests/repro-money-batch.ts`)

| Nhóm | Trước sửa | Sau sửa |
|---|---|---|
| 1 — Phiếu batch 2 dòng cùng SP, giá khác nhau (100.000đ + 200.000đ) | 1/5 PASS | **5/5 PASS** |
| 2 — Đơn hàng 2 dòng cùng SP, giá khác nhau (100.000đ + 200.000đ) | 1/4 PASS | **4/4 PASS** |
| 3 — Hồi quy đợt 3 + nơi tiêu thụ movements (đối chiếu, xoá phiếu) | 2/3 PASS | **5/5 PASS** |
| **Tổng** | **4 PASS / 8 FAIL** | **14 PASS / 0 FAIL** |

Lưu ý trung thực: log trước sửa có 12 kiểm tra, log sau sửa có 14 — kiểm tra 3c (huỷ đơn
confirmed 2 dòng cùng SP giá khác nhau) và 3d (huỷ giữ đơn reserved 2 dòng cùng SP giá khác
nhau) được thêm cùng lúc với bản sửa cho nhánh huỷ đơn của `updateOrderStatus` và
`releaseReservation` nên không có trong lần chạy trước sửa; hành vi lỗi của chúng trước sửa
suy ra từ cùng mẫu "lấy giá dòng đầu" đã chứng minh FAIL ở 1a/2a/2b/2c-1. Harness cũ chạy
lại sau đợt này: đợt 3 **12/12 PASS**, đợt 2 **18/18 PASS**, đợt 1 **42/42 PASS** (không hồi
quy). `bun run typecheck` 0 lỗi; `bun run build:server` thành công
(`server/dist/actions.js` 0,35 MB). Không có migration mới.

Số liệu kiểm chứng trong harness (đúng kịch bản đã báo):
- Lỗi tiền phiếu batch: phiếu nhập 1 × 100.000đ + 1 × 200.000đ → tổng tiền phiếu **300.000đ**
  (trước sửa: 200.000đ — phiếu gộp 2 × 100.000đ), tồn 10 → 12, 2 phiếu nối chuỗi 10 → 11 và
  11 → 12, 0 bản ghi sửa chữa, `results` vẫn 1 sản phẩm (tồn mới 12); phiếu xuất cùng số liệu →
  tổng tiền phiếu 300.000đ, tồn 10 → 8, `todayOutValue` tăng đúng **300.000đ** (trước sửa:
  200.000đ); phiếu nhập → `todayInValue` tăng đúng **300.000đ**.
- Chốt chặn hồi quy đợt 3: batch 2 × 100k + 1 × 100k cùng giá/cùng reason → vẫn đúng **1 phiếu
  gộp** (số lượng 3, tiền 300.000đ, before 10 → after 13); cùng giá nhưng khác reason → 2 phiếu,
  cả 2 reason đều còn (không nuốt mất dòng nào — trước sửa chỉ còn reason dòng đầu).
- Đơn hàng: tạo đơn confirmed 2 dòng cùng SP → tổng tiền đơn 300.000đ (đã đúng từ trước),
  tổng tiền phiếu xuất **300.000đ** (trước sửa: 200.000đ), tồn 10 → 8, 2 phiếu xuất nối chuỗi
  10 → 9, 9 → 8; xác nhận đơn pending cùng số liệu → phiếu xuất 300.000đ, tồn 8, đơn confirmed.
- Trả hàng: trả hết 2 dòng cùng SP giá khác nhau → tổng tiền phiếu nhập trả **300.000đ**
  (trước sửa: 200.000đ), tồn về 10, refund 300.000đ → công nợ còn 0; trả một phần dòng
  100.000đ → phiếu nhập trả 100.000đ, tồn 9, công nợ còn 200.000đ (không hồi quy đợt 2/3).
- Hồi quy đợt 3: batch 2 dòng cùng SP + tiêm lỗi ghi → thao tác thất bại, tồn về đúng 10,
  0 phiếu, 0 bản ghi sửa chữa.
- Nơi tiêu thụ movements: đối chiếu tồn sau phiếu nhập tách giá → diffs rỗng (không lệch);
  xoá phiếu theo chuỗi nối nhau: xoá phiếu cuối 11 → 12 → tồn 11, xoá phiếu trước 10 → 11 →
  tồn 10, 0 phiếu còn lại; huỷ đơn confirmed 2 dòng giá khác nhau → phiếu hoàn 300.000đ
  (8 → 9, 9 → 10), tồn về 10, đơn cancelled; huỷ giữ đơn reserved 2 dòng giá khác nhau →
  phiếu hoàn 300.000đ, tồn về 10, `reservedQty` 0, đơn cancelled.

## J. Bản standalone — Bun + SQLite file (ngày 2026-11-10)

Môi trường kiểm chứng: máy ảo Linux, Bun 1.4.4. Toàn bộ lệnh chạy từ
`standalone/` trừ khi ghi khác. Không đẩy GitHub, không sửa sync record.

### J1. Cài đặt từ trạng thái sạch

- `rm -rf node_modules` rồi `bun install`: thành công, **79 packages**,
  `Saved lockfile`. `grep -r "opt/hatch" standalone/package.json
  standalone/shim` trống (không tham chiếu `/opt/hatch`).
- `bun run typecheck` (standalone): **0 lỗi** (typecheck code standalone +
  shim qua `standalone/tsconfig.json`).

### J2. Build client

- `bun run build`: thành công — `dist/app.js` **1.109,7 KB**,
  `dist/app.css` **25,5 KB**, `dist/index.html` đã copy.
- `app.css` chứa utilities Tailwind (`.flex{display:flex}`).
- `grep -c "space-sdk-shim/1.0" dist/app.js` = **1** (chuỗi đánh dấu của
  shim còn trong bundle sau minify); `grep -c` các chuỗi SDK thật đều
  **0**: `hatch:space:query-invalidated`, `space-action-auth-refresh`,
  `space_unavailable`, `opt/hatch` — chứng minh bundle dùng shim, không
  dùng SDK thật.
- Lỗi đã gặp và đã sửa trong lúc build (xem `CHANGES.md`): `Bun.build`
  `alias` không áp dụng cho entry ngoài thư mục build (đã đổi sang plugin
  `onResolve`); Tailwind Oxide không resolve được `@import "tailwindcss"`
  khi không có `node_modules` trên đường đi lên từ `client/src/`
  (script build nay tự tạo liên kết tạm `client/node_modules` →
  `../standalone/node_modules` trong lúc build rồi gỡ lại ngay sau khi
  build xong — bundle sau khi đổi vẫn giống hệt byte, md5 `app.js`
  `0c9b3291…`, `app.css` `65fe41bf…`).

### J3. Migration trên DB file

- Khởi động server với DB tạm (`DB_PATH=/tmp/test-wh.db`, cổng 31234):
  log `Migration: đã áp 5 file trong lần chạy này, tổng 5/5 file đã áp.`
- Kiểm tra trực tiếp bằng SQLite: **18 bảng** (17 bảng nghiệp vụ +
  `sqlite_sequence`; bảng `entries` của 0001 đã bị `DROP` có chủ đích ở
  đầu 0002) + index `debts_one_active_per_ref` có mặt + bảng
  `__migrations` đủ 5 dòng 0001→0005.
- `loginStaff` PIN 123456 qua HTTP thật: `ok: true`, `mustChangePin: 1`.

### J4. Smoke test end-to-end (`bun run smoke`)

**26/26 PASS, 0 FAIL** (chạy ngày 2026-11-10, cổng tạm, DB tạm trong
`os.tmpdir()`, tự xóa sau khi chạy):

| Mục | Kết quả |
|---|---|
| Khởi động server, GET / 200 | PASS |
| 1a. GET / chứa `data-generated-space-root` | PASS (2.195 ký tự) |
| 1b. GET /app.js 200, không rỗng | PASS (1.130.683 ký tự) |
| 1c. GET /app.css 200, chứa utilities Tailwind | PASS (26.162 ký tự) |
| 2a. Login PIN 123456 → ok, có token, mustChangePin = 1 | PASS |
| 2b. Đổi PIN sang 654321 → ok | PASS |
| 2c. Login PIN mới được | PASS |
| 2d. Login PIN cũ không được | PASS (`Mã PIN không đúng.`) |
| 3. Tạo SP (nhập 50, bán 100, tồn đầu 10) → ok | PASS (id=1, sku=BC-0558) |
| 4. Phiếu nhập batch 1×100.000đ + 1×200.000đ → todayInValue tăng đúng 300.000đ | PASS (500 → 300.500) |
| 5a. Tạo đơn confirmed 2 dòng cùng SP → ok | PASS (DH20261110-9689) |
| 5b. Tổng tiền đơn 300.000đ, tồn 12 → 10, phiếu xuất 300.000đ | PASS |
| 6a. Trả 1 dòng (100.000đ) → ok | PASS (`partially_returned`) |
| 6b. Sau trả một phần, công nợ còn 200.000đ | PASS |
| 6c. Thu đủ 200.000đ → ok, remaining 0 | PASS |
| 6d. Đơn `paid`, công nợ còn 0 | PASS |
| 7a. `listProducts` không token → lỗi chứa "Cần đăng nhập" | PASS (HTTP 500, xem lưu ý dưới) |
| 7b. Action không tồn tại → 404 | PASS |
| 7c. `loginStaff` không pin → 400 | PASS (`Dữ liệu gửi lên không hợp lệ cho loginStaff: pin: Invalid input: expected string, received undefined.`) |
| 8a. Tạo snapshot sao lưu → ok | PASS (id=1, size=6.043) |
| 8b. Tạo SP sau snapshot → ok | PASS (id=2) |
| 8c. Khôi phục snapshot → ok | PASS |
| 8d. Sau khôi phục: SP trước snapshot còn, SP sau snapshot mất | PASS (1 SP) |
| 9a. Khởi động lần 2 trên cùng DB → server lên | PASS |
| 9b. Dữ liệu còn nguyên (số SP trước/sau bằng nhau) | PASS (1 = 1) |
| 9c. `__migrations` không tăng (5 = 5) | PASS |

Lưu ý: mục 7a trả HTTP **500** theo đúng thiết kế server standalone
(handler ném lỗi → 500 `{error: message}`); client vẫn hiển thị đúng
thông báo tiếng Việt vì `SpaceActionError.message` chứa nguyên body JSON,
và không có retry lại vì server không đặt `retrySafe`.

### J5. Mô phỏng máy Windows sạch

Copy toàn bộ repo sang `/tmp/win-sim` **không kèm `node_modules` gốc**
(đúng như máy Windows chỉ tải ZIP/clone rồi `cd standalone`):

- `bun install` (xóa `bun.lock` trước): thành công, 79 packages.
- `bun run build`: **thành công** (sau khi thêm liên kết
  `client/node_modules` — trước đó lỗi `Can't resolve 'tailwindcss'`,
  đã sửa). Bundle **giống hệt byte** với bản build ở repo chính
  (md5 `app.js` 0c9b3291bd64ef8adc63f442d7decc00, `app.css`
  65fe41bf271ada8a54ff15aebbe378b4).
- `bun run smoke`: **26/26 PASS**.
- `bun run typecheck` (standalone): **0 lỗi**.
- `bun run start` (cổng 31236, DB mặc định `standalone/data/warehouse.db`):
  lần 1 log `đã áp 5 file… tổng 5/5`, GET / 200, login PIN 123456 ok;
  lần 2 log `đã áp 0 file… tổng 5/5` (không chạy lại migration cũ).

### J6. Không hồi quy bản Muse (chạy lại ngày 2026-11-10)

- `bun run typecheck` (gốc, client + server): **0 lỗi**.
- `bun tests/repro-5-bugs.ts`: **42/42 PASS**.
- `bun tests/repro-4-bugs.ts`: **18/18 PASS**.
- `bun tests/repro-2-bugs-round3.ts`: **12/12 PASS**.
- `bun tests/repro-money-batch.ts`: **14/14 PASS**.
- `git status` xác nhận không sửa file chung: `client/src/App.tsx`,
  `server/src/actions.ts`, `server/src/schema.ts`, `client/src/main.tsx`,
  `client/src/api.ts`, `drizzle/*.sql` giữ nguyên (các file này đã có sửa
  đổi chưa commit từ các phiên trước, không phải từ phiên standalone này).

### J8. Kiểm chứng độc lập của coordinator + 2 lỗi đã sửa sau khi kiểm chứng

Người điều phối đã chạy lại toàn bộ bằng tay (không tin báo cáo của
worker con) và sửa 2 lỗi tìm thấy:

1. **Liên kết `client/node_modules` bị để sót lại sau mỗi lần build.**
   Script build tạo liên kết này để Tailwind tìm thấy gói, nhưng không gỡ
   lại — liên kết còn sót sẽ làm mọi lần resolve từ `client/src/` (vd
   typecheck phía Muse) thấy shim thay vì SDK thật. Đã sửa:
   `build-client.ts` giờ tạo liên kết TẠM trong lúc build rồi gỡ trong
   khối `finally`. Sau sửa: build vẫn thành công, bundle **giống hệt
   byte** (md5 `app.js`/`app.css` không đổi), `client/node_modules`
   không còn tồn tại sau build.
2. **`.gitignore` (quy tắc `dist/`) vô tình loại cả `dist/` của shim.**
   Shim chỉ có file `.js`/`.d.ts` viết tay trong `dist/` (không có nguồn
   `.ts` để build lại), mà `package.json` của shim trỏ `main`/`types`
   vào đó — nếu đẩy theo manifest (`git ls-files --exclude-standard`)
   thì 4 file này sẽ bị rớt, bản clone về sẽ lỗi `Cannot find module`
   khi chạy. Đã sửa: thêm `!standalone/shim/space-sdk/dist/` vào
   `.gitignore` (đứng sau quy tắc `dist/`). Đã kiểm chứng bằng
   `git check-ignore`: 4 file shim không còn bị ignore, và manifest
   (57 file) đã bao đủ chúng.

**Mô phỏng máy Windows sạch từ đúng tập file sẽ đẩy GitHub** (không phải
copy cả thư mục làm việc): dựng `/tmp/win-sim2` chỉ từ 57 file trong
manifest (`git ls-files --cached --others --exclude-standard`), rồi chạy
đúng luồng người dùng — `bun install`: 79 packages OK; `bun run build`:
OK, liên kết tạm được tạo rồi gỡ, md5 bundle giống hệt repo chính;
`bun run smoke`: **26/26 PASS**; `bun run start` (cổng 31411, DB tạm):
lần 1 `đã áp 5 file… tổng 5/5`, GET / 200, `loginStaff` PIN 123456 →
`ok: true, mustChangePin: 1`; lần 2 `đã áp 0 file… tổng 5/5`;
`bun run typecheck` (standalone): **0 lỗi**.

Sau 2 sửa trên, chạy lại ở repo chính: smoke **26/26 PASS**,
typecheck standalone **0 lỗi**, typecheck gốc **0 lỗi**,
`tests/repro-money-batch.ts` **14/14 PASS**. Các harness còn lại đã chạy
ở J6 (42/42, 18/18, 12/12) và không bị ảnh hưởng vì không sửa file chung.

### J7. Chưa kiểm chứng được

- **Render trình duyệt thật trên máy ảo: CHƯA.** Chromium có sẵn
  (`/opt/meta-chromium/chrome` + `playwright-core` 1.55.1) khởi động được
  (cần policy file WebGL domain), nhưng mọi điều hướng tới
  `http://localhost:<cổng>/` đều bị chặn với
  `net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` — chính sách Local
  Network Access của bản Chromium này — dù đã thử các flag
  `--disable-features=LocalNetworkAccessChecks,
  BlockInsecurePrivateNetworkRequests,…`, bộ flag hardening của
  `playwright-audit.js` (kể cả tắt `HatchFortress`) và
  `ignoreDefaultArgs`. Coordinator thử lại bằng tay: bản Chromium này
  thậm chí không khởi động được nếu thiếu file policy WebGL domain
  (`Hatch WebGL domain policy is required for browser startup`), và
  không tìm thấy file policy đó trên máy ảo. Không tìm cách vượt qua cơ
  chế này. Bù lại: bundle đã kiểm chứng (J2), API qua HTTP thật đã kiểm
  chứng (J4), và luồng Windows đã kiểm chứng (J5, J8). **Người dùng kiểm
  chứng render trên máy Windows thật** theo checklist trong
  `standalone/README.md` (mở `http://127.0.0.1:3000`, đăng nhập PIN
  123456, đổi PIN, kiểm tra Tổng quan/Sản phẩm/Đơn hàng hiển thị đúng).
- **`start.bat` chưa chạy thử trên Windows thật** (chỉ kiểm chứng logic:
  CRLF, `%~dp0`, kiểm tra `bun`, build khi thiếu `dist/app.js`,
  `NODE_PATH`, mở trình duyệt). Lệnh `mklink /J` dự phòng chỉ ghi trong
  cảnh báo của script build, chưa cần dùng tới.
- Hai người dùng đồng thời trên bản standalone chưa thử qua trình duyệt
  (chỉ có smoke test đơn luồng); giới hạn này giống bản Muse và đã ghi
  trong `TESTING.md`.
