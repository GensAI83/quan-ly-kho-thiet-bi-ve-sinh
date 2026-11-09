# CHANGES.md — Nhật ký thay đổi (bản nâng cấp 2026-11-09)

Triển khai theo 5 bước: (1) số tồn luôn đúng, (2) bảo vệ dữ liệu, (3) hoàn thiện quy trình bán hàng, (4) công cụ hằng ngày, (5) chuẩn bị kiểm thử. Repo đích: `GensAI83/quan-ly-kho-thiet-bi-ve-sinh` (chưa đẩy lên GitHub trong đợt này).

## File đổi / thêm

- `server/src/schema.ts` — thêm cột `version`/`status`/`reservedQty` (products), `requestKey`/`actor` (movements), 8 cột mới + mở rộng trạng thái đơn (orders), `returnedQty`/`costPrice` (orderItems), 11 bảng mới.
- `server/src/actions.ts` — 550 → 2.082 dòng: 10 action cũ được sửa/mở rộng, 23 action mới.
- `drizzle/0003_stock_safety_and_ops.sql` (mới) + `drizzle/meta/_journal.json` (thêm entry idx 2).
- `client/src/App.tsx` — 809 → 1.916 dòng: đăng nhập PIN, phân quyền, 5 tab mới, phiếu nhiều mặt hàng, giữ/giao/trả hàng, cọc, CSV, in phiếu, banner mất mạng, tự sao lưu.
- `client/src/theme.css` — thêm CSS `@media print` chỉ hiện vùng phiếu in (`.print-area`).
- `README.md` — tính năng mới, tài khoản admin mặc định + đổi PIN, sao lưu/khôi phục, cách chạy kiểm tra.
- `TESTING.md` (mới) — checklist chạy thử tại cửa hàng.
- `CHANGES.md` (file này).

## Bước 1 — Số tồn luôn đúng

- `deleteProduct`: chặn xóa khi còn tồn > 0, còn đơn chưa hoàn thành chứa sản phẩm, hoặc còn đợt kiểm kê nháp chứa sản phẩm; trả lỗi tiếng Việt rõ ràng. Sản phẩm đã có lịch sử thì chuyển sang trạng thái `discontinued` (ngưng kinh doanh) thay vì xóa cứng; chỉ xóa cứng khi chưa từng có phiếu/đơn nào.
- Hủy đơn: hoàn kho có tính lũy thừa an toàn qua cờ `stockDeducted` + phiếu hoàn kho; nếu sản phẩm đã bị xóa hoặc đã ngưng kinh doanh thì khoản hoàn kho được ghi vào bảng `pending_restocks` (không bỏ qua im lặng), response báo rõ danh sách chờ xử lý, Tổng quan hiện cảnh báo và có luồng đối chiếu (`resolvePendingRestock`).
- Đổi đơn vị: cấm đổi khi sản phẩm còn tồn hoặc đã có phiếu (lỗi tiếng Việt, gợi ý tạo mã mới); chỉ đổi được khi tồn = 0 và chưa có phiếu, có ghi audit log.
- Đổi giá: chỉ quản trị được đổi (server chặn khi có token non-admin); giá mới chỉ áp dụng cho giao dịch sau đó; mọi lần đổi giá lưu vào `price_history` (giá cũ/mới, nhập/bán, người đổi, lý do, thời gian); client hiện ô lý do đổi giá và link xem lịch sử giá.
- Chống lệch tồn nhiều người dùng: mọi cập nhật tồn kiểm tra `version` (optimistic concurrency — lệch thì báo “Số tồn vừa thay đổi, vui lòng tải lại trang và thử lại.”). Đơn nhiều dòng validate hết trước, trừ tồn từng dòng, lỗi giữa chừng thì bù trừ hoàn lại các dòng đã trừ rồi mới báo lỗi; chỉ ghi phiếu sau khi mọi cập nhật tồn thành công.
- Action mới `reconcileStock`: tính lại tồn từng sản phẩm từ toàn bộ phiếu (nhập − xuất, kiểm kê chốt theo tồn sau), báo danh sách lệch; chỉ admin được chốt lại tồn theo sổ phiếu (ghi audit + phiếu kiểm kê).

## Bước 2 — Bảo vệ dữ liệu

- Bảng `staff` (tên, vai trò admin/thủ kho/nhân viên bán hàng, PIN băm SHA-256 + salt, active) + `staff_sessions` (token ngẫu nhiên, hết hạn 12 giờ). `loginStaff` trả token; mọi action ghi nhận thêm `actorToken` (optional để tương thích client cũ) và kiểm tra quyền server-side.
- Seed admin lười: tài khoản đầu tiên “Chủ cửa hàng”, PIN mặc định `123456`, bắt buộc đổi PIN ở lần đăng nhập đầu. Client: màn hình đăng nhập PIN, token lưu `sessionStorage`, ẩn/khóa nút theo vai trò.
- Bảng `audit_logs`: ghi cho mọi thao tác ghi (tạo/sửa/xóa sản phẩm, phiếu, đơn, đổi giá, đổi trạng thái, khôi phục...). Tab Lịch sử xem + lọc theo người và ngày, xuất CSV.
- Sao lưu: `exportBackup` (JSON toàn bộ dữ liệu, không kèm PIN), `createBackupSnapshot` (lưu snapshot vào bảng `backups`), `listBackups`, `restoreBackup` (chỉ admin, client xác nhận 2 lần, lần 2 gõ `KHOI PHUC`). Tự động: khi mở app sau đăng nhập, nếu snapshot mới nhất quá 24 giờ thì tự tạo snapshot một lần (theo phiên mở app, không phải cron server).

## Bước 3 — Hoàn thiện quy trình bán hàng

- `createMovementBatch`: phiếu nhập/xuất nhiều mặt hàng, 1 mã phiếu PN/PX chung; 1 dòng lỗi thì cả phiếu không ghi. Phiếu đơn lẻ cũ vẫn hoạt động.
- Giữ hàng: trạng thái đơn `reserved` — trừ kho như đơn xác nhận nhưng cộng thêm `reservedQty` (hiển thị riêng “Đang giữ X”), có hạn giữ `reservedUntil`; `releaseReservation` hoàn kho khi hết hạn/hủy giữ; chuyển reserved → confirmed thì giữ nguyên trừ kho, trừ `reservedQty`.
- Giao hàng: đơn có người giao, phí giao, ngày giao dự kiến; luồng confirmed → delivering → completed.
- Trả hàng: `createReturn` (theo dòng đơn + lý do) tạo phiếu nhập loại trả hàng, cộng lại tồn, giảm công nợ phải thu, đơn thành `returned` (toàn phần) hoặc `partially_returned`; chặn trả quá số đã giao (dựa trên `returnedQty` từng dòng).
- Kiểm kê theo đợt: `createStocktake` / `saveStocktakeItem` (lưu nháp nhiều sản phẩm) / `closeStocktake` (chốt đợt, sinh phiếu điều chỉnh cho từng sản phẩm lệch + báo cáo chênh lệch).

## Bước 4 — Công cụ hằng ngày

- Tiền cọc: `depositAmount` + `paymentStatus` (chưa cọc / cọc một phần / đã thanh toán đủ) trên đơn; `recordDeposit` ghi nhận cọc và trừ công nợ.
- Công nợ: bảng `debts` tự sinh từ đơn bán chịu (phần còn lại sau cọc) + `recordDebtPayment`; tab Công nợ hiển thị phải thu/phải trả, quá hạn.
- Giá vốn: mỗi dòng đơn lưu `costPrice` tại thời điểm bán; báo cáo lãi gộp = doanh thu − giá vốn (theo đơn và theo ngày).
- Excel: xuất CSV có BOM UTF-8 (Excel đọc được) cho tồn kho, lịch sử phiếu, đơn hàng, công nợ, lịch sử thao tác; nhập CSV sản phẩm (mẫu: sku, tên, danh mục, hãng, đơn vị, giá nhập, giá bán, tồn đầu, tồn tối thiểu, vị trí) — dòng lỗi báo riêng từng dòng và không ghi dòng đó.
- In phiếu: xem trước phiếu nhập/xuất/đơn hàng (tên cửa hàng, mã phiếu, bảng dòng hàng, tổng tiền, chữ ký) + `window.print()` với CSS `@media print`.
- Báo cáo: tab Báo cáo — doanh thu theo ngày, top sản phẩm bán chạy, hàng sắp hết, lãi gộp, công nợ tổng hợp, dùng dữ liệu thật từ DB.

## Bước 5 — Chuẩn bị kiểm thử

- `TESTING.md` với checklist chạy thử tại cửa hàng (đối chiếu tồn, mất mạng, thao tác nhầm, nhiều người dùng cùng lúc).
- Idempotency thật: `requestKey` cho `createMovement`/`createOrder`/`createMovementBatch` (unique index trên movements/orders + bảng `idempotency_keys` lưu kết quả; gửi trùng trả lại kết quả cũ, không ghi trùng). Client tự sinh key bằng `crypto.randomUUID()` và truyền `expectedVersion`/`expectedVersions` từ dữ liệu đang hiển thị.
- Mất mạng: banner đỏ + nút thử lại (invalidate queries); mutation lỗi mạng báo rõ “chưa ghi gì — bấm lại sau khi có mạng”; không cache ghi offline, không ghi đè dữ liệu local.

## Những điểm khác so với yêu cầu gốc (quyết định có chủ ý)

1. **SDK không có transaction.** `ctx.db()` chỉ expose `select/insert/update/delete/run/all/get/batch` (ghi chú trong SDK: D1 từ chối transaction của Drizzle). Thay bằng: `db.batch()` cho nhóm ghi phụ, cập nhật tồn có điều kiện theo `version`, và cơ chế bù trừ (saga) cho đơn nhiều dòng. Hệ quả: vẫn còn cửa sổ cực nhỏ giữa cập nhật tồn và ghi phiếu nếu tiến trình chết đúng lúc đó — giảm thiểu bằng validate kỹ trước khi trừ tồn; `reconcileStock` là lưới an toàn cuối cùng để phát hiện và sửa lệch.
2. **SQLite không cho `ALTER TABLE ADD COLUMN ... UNIQUE`** nên `request_key` thêm dạng cột thường + `CREATE UNIQUE INDEX` riêng (nhiều NULL vẫn được phép, trùng key vẫn bị chặn — đã kiểm chứng).
3. Yêu cầu nói “12 bảng mới” nhưng chỉ liệt kê 11 tên — đã tạo đủ 11 bảng đó.
4. **Công nợ khi tạo đơn:** tạo debt phải thu khi còn dư `tổng − cọc > 0` (kể cả khi đã cọc một phần), thay vì chỉ khi chưa cọc — vì nếu chỉ tạo khi chưa cọc thì `recordDeposit` không bao giờ có công nợ để trừ khi khách đã cọc một phần.
5. **Hủy đơn không tự đóng/xóa debt phải thu** của đơn đó (yêu cầu không nói rõ) — công nợ còn lại phải xử lý thủ công qua tab Công nợ hoặc trả hàng.
6. **Không có action tạo công nợ phải trả cho nhà cung cấp** (yêu cầu không yêu cầu) — debt loại `payable` hiện chỉ xuất hiện qua khôi phục backup.
7. **Đổi giá khi không có token:** server vẫn cho phép (tương thích client cũ chưa đăng nhập), nhưng app luôn bắt đăng nhập nên tài khoản non-admin bị chặn cả ở client lẫn server. `createProduct` không chặn giá theo vai trò (giá ban đầu khi tạo mới).
8. **`closeStocktake` chốt tồn về `countedQty` theo tồn hiện tại**, vì `systemQty` lưu lúc đếm có thể đã cũ nếu có người nhập/xuất xen vào.
9. **`createMovementBatch` chỉ nhận nhập/xuất** (`in`/`out`), không nhận kiểm kê — chế độ nhiều mặt hàng ở client chỉ bật cho nhập/xuất.

## Kết quả kiểm chứng (chạy ngày 2026-11-09)

- `bun run typecheck`: **0 lỗi** (client + server).
- `bun run build:server`: thành công (`server/dist/actions.js`, 0,31 MB).
- `bun run build`: bước `build:client` bị SDK chặn có chủ đích (“cannot be built by hand… call the `artifact.edit` tool”) — không phải lỗi code. Kiểm chứng riêng bằng `bun build ./client/src/main.tsx --outdir=/tmp/smoke-out`: thành công (`main.js` ~2,2 MB; cảnh báo `@utility`/`@theme` của Tailwind khi build không qua plugin là bình thường).
- Migration: chạy lần lượt 0001 → 0002 → 0003 lên SQLite trống bằng sqlite3 CLI: thành công, **17 bảng**, đủ cột mới và 2 unique index; kiểm chứng trùng `request_key` bị chặn `UNIQUE constraint failed`, nhiều NULL được phép.
- `bun install` trong môi trường này lỗi `Integrity check failed for tarball: @hatch/space-sdk` (sha512 trong `bun.lock` không khớp file tgz hiện tại — vấn đề có sẵn, không do code mới). Khắc phục tạm: giải nén tgz SDK vào `node_modules/@hatch/space-sdk` (thư mục này được gitignore) rồi typecheck mới chạy được.

## Cố tình chưa làm / giới hạn còn tồn tại

- **Chưa kiểm thử end-to-end trên server thật / trình duyệt.** Chỉ mới typecheck + build + migration test; logic saga/idempotency/audit/khôi phục chưa được chạy thử với dữ liệu thật. Cần chạy theo `TESTING.md` trước khi dùng cho cửa hàng thật.
- **Offline thật sự chưa có.** App cần mạng để chạy; mất mạng thì báo rõ và không ghi trùng khi bấm lại (nhờ idempotency key), nhưng không có hàng đợi ghi offline hay đồng bộ sau khi có mạng.
- **Không có cron sao lưu trên server.** Sao lưu tự động chỉ chạy khi mở app (phiên mở app); nhiều ngày không mở app thì không có snapshot mới.
- **Xác thực PIN chỉ ở mức cửa hàng nhỏ.** PIN 4–8 số + SHA-256/salt, token lưu `sessionStorage`, không có chống brute-force (khóa sau nhiều lần sai), không có 2FA, không mã hóa dữ liệu. Đủ cho cửa hàng gia đình, không đủ cho hệ thống nhiều chi nhánh.
- **Không có phân quyền ở mức từng kho/chi nhánh** và không có log chống sửa/xóa nhật ký audit (admin xem được toàn bộ).
- **Giá vốn dùng giá nhập hiện tại** tại thời điểm bán (không tính FIFO theo từng lô nhập); báo cáo lãi gộp vì vậy là ước tính theo giá vốn hiện hành, không phải lãi theo từng lô hàng cụ thể.
- **Đồng thời thật sự (race) vẫn dựa vào version-check**, không có khóa hàng (row lock) vì SQLite + SDK không hỗ trợ; hai người xuất cùng 1 mặt hàng đến giới hạn tồn: người sau sẽ nhận lỗi version/tồn và phải tải lại — đúng theo thiết kế, nhưng cần thử theo `TESTING.md` mục 4.
