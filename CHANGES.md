# CHANGES.md — Nhật ký thay đổi (bản nâng cấp 2026-11-09, đợt 2 ngày 2026-11-10, đợt 3 ngày 2026-11-10, đợt tiền phiếu ngày 2026-11-10, bản standalone ngày 2026-11-10)

## Bản chạy trực tiếp trên máy tính — standalone (ngày 2026-11-10) — xem `TEST_RESULTS.md` mục J

Thêm thư mục `standalone/` để chạy app trực tiếp trên máy Windows bằng Bun +
file SQLite, không cần Muse, không cần mạng. **Không sửa hành vi bản Muse:**
`client/src/App.tsx`, `server/src/actions.ts`, `server/src/schema.ts`,
`client/src/main.tsx`, `client/src/api.ts`, `drizzle/*.sql` giữ nguyên
(xác minh bằng `git status`: chỉ có các file đã sửa từ trước phiên này).

### Kiến trúc

- **Dùng chung code nghiệp vụ, không copy.** `standalone/` import trực tiếp
  `../../client/src/main.tsx`, `../../server/src/actions` và
  `../../server/src/schema`, chạy migration từ `drizzle/0001..0005.sql`.
- **`standalone/shim/space-sdk/` — package local `@hatch/space-sdk` 0.14.0**
  (`file:./shim/space-sdk` trong `standalone/package.json`), triển khai tối
  thiểu bề mặt SDK mà code dùng, khớp hành vi SDK thật đã đọc từ
  `space-sdk.tgz` (`dist/client.js`, `dist/server-contract.js`,
  `dist/client/safe-area.js`, `styles.css`):
  - Server (`dist/index.js` + `index.d.ts`): `z` (re-export từ zod),
    `defineAction` trả `{ __brand: "@hatch/space-sdk/action/v1", request,
    response, description?, handler }`, `isAction`,
    `actionDescription` (gộp whitespace, cắt 300 ký tự), các type
    `ActionDefinition`, `ActionsModule`, `SpaceDb`
    (= `Pick<LibSQLDatabase, "select"|"insert"|"update"|"delete"|"run"|"all"|"get"|"batch">`),
    `SpaceDbAccessor`, `Ctx`, `PortableCtx`.
  - Client (`dist/client.js` + `client.d.ts`): `createActionClient` khớp
    đúng wire protocol — POST `./actions` (resolve theo `location.href`),
    body `{ action, args, actionCallId }`, header `x-request-id`; 200 trả
    `{ data }` (body 200 có `error` truthy thì ném
    `Error("action <tên> error: ...")`); non-OK ném `SpaceActionError`
    với message `action <tên> failed: <status> <body JSON>`.
    `SpaceActionError` (status, retryAfterMs, retrySafe, code),
    `PERMANENT_ACTION_STATUSES` (400/401/403/404/409/413/415/422),
    `MAX_ACTION_RETRIES = 3`, `shouldRetryAction` (chỉ retry lỗi
    `retrySafe` và `failureCount < 3`, không retry status vĩnh viễn),
    `actionRetryDelay` (backoff mũ + jitter, floor theo `Retry-After`),
    `spaceQueryClient` (`retry: shouldRetryAction`, `retryDelay:
    actionRetryDelay`, `staleTime: 30000`, `refetchOnWindowFocus: false`),
    `SafeAreaTopScrim` (render đúng div fixed như thật: gradient mặc định
    với mask, solid/blur, `zIndex` mặc định 40, `aria-hidden`),
    `getSpaceViewer` → `Promise.resolve(null)`,
    `subscribeSpaceViewer` → unsubscribe no-op, `useSpaceViewer` → `null`,
    `bytesToBase64`/`fileToBase64`. Không import `../styles.css`.
    Có chuỗi đánh dấu `space-sdk-shim/1.0` (`STANDALONE_SHIM_MARKER`,
    kèm gán `globalThis.__standaloneShim` để bundler không tree-shake mất)
    — kiểm chứng bằng `grep` trên bundle.
  - Cố tình KHÔNG triển khai: viewer context (`./_viewer`, broadcast
    invalidate liên-client, auth-refresh qua postMessage, host theme),
    privileged contracts, inference/tool/agent, PDF, icons.
- **`standalone/server/index.ts`** — `Bun.serve` (bind `127.0.0.1`, cổng
  `PORT`, mặc định 3000; DB `standalone/data/warehouse.db`, đổi qua
  `DB_PATH`): chạy migration 0001→0005 với bảng `__migrations` (chỉ chạy
  file chưa chạy, dùng `client.executeMultiple` như harness);
  `POST /actions` tìm action trong `Actions`, validate args bằng request
  zod schema (`safeParse`, lỗi → 400 tiếng Việt ghi rõ tên action + lỗi
  zod đầu tiên), gọi handler với ctx `{ slug, invocationId, spaceDir, db:
  () => db, invalidateQueries: () => {} }`, trả `{ data }`; handler ném
  lỗi → 500 `{error: message}` (không lộ stack); action không tồn tại →
  404. Phục vụ file tĩnh `standalone/dist/` (`/`, `/app.js`, `/app.css`,
  `/assets/*`). Log khi khởi động: cổng, đường dẫn DB, số migration đã áp
  trong lần chạy này + tổng số đã áp.
- **`standalone/client/index.html`** — host page: `<div
  data-generated-space-root class="hatch-space-root"
  data-hatch-space-root>`, nạp `/app.js` + `/app.css` (đường dẫn tuyệt
  đối), kèm `<style>` inline chứa CSS container tương đương SDK
  `styles.css` (biến `--twsa-safe-area-inset-*`, root fixed full-height,
  `.hatch-space-root` dùng `var(--bg)`/`var(--text)`).
- **`standalone/scripts/build-client.ts`** (`bun run build`): `Bun.build`
  entrypoint `../../client/src/main.tsx`, outdir `standalone/dist`,
  `target: "browser"`, `minify`, `define NODE_ENV production`, naming
  `app.[ext]` / `assets/[name]-[hash].[ext]`, plugin `bun-plugin-tailwind`,
  copy `client/index.html` → `dist/index.html`, kiểm tra `app.js`/`app.css`
  tồn tại và không rỗng. Xem mục "Hai phát hiện khi triển khai" bên dưới
  về lý do script dùng plugin `onResolve` thay cho `alias`, và về liên kết
  `client/node_modules`.
- **`standalone/smoke-test.ts`** (`bun run smoke`): spawn server thật trên
  cổng tạm + DB tạm, 26 kiểm tra (trang chủ/bundle, PIN, phiếu nhập batch,
  đơn, trả hàng + thu nợ, auth/404/400, snapshot/khôi phục, migration
  idempotent) — xem `TEST_RESULTS.md` mục J.
- **`standalone/start.bat`** (CRLF, `%~dp0`): kiểm tra `bun`, build nếu
  chưa có `dist/app.js`, chạy server, mở `http://127.0.0.1:3000`.
- **`standalone/package.json`**: chỉ gói npm công khai +
  `"@hatch/space-sdk": "file:./shim/space-sdk"` (không tham chiếu
  `/opt/hatch` — đã kiểm chứng bằng `grep`). Scripts: `build`, `start`,
  `smoke`, `typecheck` (typecheck code standalone + shim qua
  `standalone/tsconfig.json`, 0 lỗi).
- **`.gitignore`**: thêm `standalone/data/*.db`, `standalone/dist/`,
  `standalone/node_modules/`.

### Hai phát hiện khi triển khai (đã xác minh bằng thử nghiệm, không đoán)

1. **Resolve phía server cần `NODE_PATH`.** `server/src/actions.ts` import
   `@hatch/space-sdk` và `drizzle-orm` nhưng nằm NGOÀI `standalone/`, nên
   Bun resolve bằng cách đi lên từ `server/src/` và không bao giờ thấy
   `standalone/node_modules`. Trên máy chỉ cài `standalone/`, import này
   lỗi `Cannot find module '@hatch/space-sdk'` (đã tái hiện). `tsconfig
   paths` không cứu được (Bun ưu tiên `server/tsconfig.json` gần file
   import nhất), plugin `Bun.plugin` + `onResolve` cũng không can thiệp
   được runtime resolve của Bun 1.4.4. Cách sửa: script `start` chạy với
   `NODE_PATH=./node_modules` (Bun tôn trọng `NODE_PATH` làm đường tìm
   kiếm dự phòng — đã kiểm chứng cả đường tuyệt đối lẫn tương đối), và
   smoke test truyền `NODE_PATH` tuyệt đối khi spawn server. `start.bat`
   cũng `set NODE_PATH=%~dp0node_modules`.
2. **`Bun.build` `alias` không áp dụng cho entry ngoài thư mục build, và
   Tailwind Oxide không tôn trọng `NODE_PATH`.** Trong Bun 1.4.4, `alias`
   với giá trị là file bị lặng lẽ bỏ qua, với giá trị là thư mục chỉ áp
   dụng cho file nằm dưới thư mục build — entry `../../client/src/main.tsx`
   không được áp alias (đã thử cả `root`, cả đường tương đối/tuyệt đối).
   Vì vậy `build-client.ts` dùng plugin `onResolve`: redirect
   `@hatch/space-sdk(/client)` sang shim, và fallback mọi bare import
   khác về `standalone/node_modules` qua `createRequire` (đảm bảo 1 bản
   copy React). Riêng CSS: Tailwind Oxide resolve `@import "tailwindcss"`
   trong `theme.css` bằng cách đi lên từ `client/src/` và cũng không tôn
   trọng `NODE_PATH`/plugin — build lỗi `Can't resolve 'tailwindcss'`
   trong môi trường mô phỏng Windows (đã tái hiện). Cách sửa: script
   build tự tạo liên kết `client/node_modules` →
   `../standalone/node_modules` (junction trên Windows — không cần quyền
   admin; symlink trên POSIX) khi nó chưa tồn tại, và **gỡ lại ngay sau
   khi build xong** (khối `finally` trong `build-client.ts`). Liên kết chỉ
   tồn tại trong lúc build: nếu để sót lại, mọi lần resolve từ `client/src/`
   (vd typecheck phía Muse) sẽ thấy shim thay vì SDK thật — đã xác minh
   bằng thử nghiệm rằng build vẫn cho ra bundle giống hệt byte (md5
   `app.js`/`app.css` không đổi) sau khi đổi sang gỡ tạm. Thư mục này đã
   gitignore nên không có file tracked nào thay đổi. Đây là lần ghi duy
   nhất của build ra ngoài `standalone/`, và nó được dọn sạch sau mỗi
   lần build.

### Sửa sau khi kiểm chứng độc lập (coordinator, ngày 2026-11-10)

1. **Liên kết `client/node_modules` giờ chỉ tồn tại trong lúc build**
   (tạo → build → gỡ trong `finally`). Trước đó build để sót liên kết,
   làm lần resolve từ `client/src/` thấy shim thay vì SDK thật. Bundle
   sau sửa giống hệt byte (md5 không đổi).
2. **`.gitignore` thêm `!standalone/shim/space-sdk/dist/`**: quy tắc
   `dist/` vô tình loại cả `dist/` viết tay của shim (không có nguồn
   `.ts` để build lại) — nếu không ngoại lệ này, bản đẩy lên GitHub sẽ
   thiếu 4 file shim và bản clone về lỗi `Cannot find module`. Đã kiểm
   chứng bằng mô phỏng dựng từ đúng 57 file trong manifest
   (xem `TEST_RESULTS.md` mục J8): install → build → smoke → start đều
   chạy được.

### Khác biệt hành vi so với bản Muse (đã biết)

- **Lỗi do handler ném (kể cả lỗi auth "Cần đăng nhập…") trả HTTP 500**
  thay vì mã riêng — theo đúng thiết kế đã chốt cho server standalone
  (handler ném lỗi → 500 `{error: message}`). Client hiển thị đúng thông
  báo vì `SpaceActionError.message` chứa nguyên body JSON; chính sách
  retry không retry lại vì server không bao giờ đặt `retrySafe`.
- **`ctx.invalidateQueries()` là no-op phía server**: không có broadcast
  liên-client. Trong thực tế không ảnh hưởng vì client tự
  `qc.invalidateQueries()` trong `onSuccess` của mutation; mở 2 tab cùng
  lúc thì tab kia chỉ cập nhật khi refetch (staleTime 30s hoặc chuyển tab
  — refetchOnWindowFocus vẫn tắt như bản Muse).
- **Không có viewer context / host theme**: `getSpaceViewer()` luôn `null`,
  không có đồng bộ liên-client, không có dark mode theo host — chỉ theo
  `prefers-color-scheme` của trình duyệt (như `theme.css` gốc).
- **Một server = một file DB, một máy**: không đồng bộ với app Muse, không
  chạy 2 máy cùng lúc. Hai tab trên cùng máy dùng chung server nên không
  xung đột như hai máy riêng.
- **Chưa kiểm chứng render trình duyệt thật trên máy ảo** (Chromium có sẵn
  chặn điều hướng tới localhost theo chính sách Local Network Access của
  nó; xem `TEST_RESULTS.md` mục J). Người dùng kiểm chứng trên Windows
  theo checklist trong `standalone/README.md`.

## Sửa lỗi tiền phiếu — gộp theo SP làm mất đơn giá dòng (ngày 2026-11-10) — xem `TEST_RESULTS.md` mục I

Harness tái hiện mới: `tests/repro-money-batch.ts` (`bun tests/repro-money-batch.ts`, Bun + SQLite
trong bộ nhớ, không sửa `tests/repro-4-bugs.ts`, `tests/repro-5-bugs.ts` và
`tests/repro-2-bugs-round3.ts`). Trước sửa: **4 PASS / 8 FAIL** (log ở
`tests/repro-money-before-fix.log`); sau sửa: **14 PASS / 0 FAIL** (log ở
`tests/repro-money-after-fix.log`). Harness cũ chạy lại: đợt 3 **12/12 PASS**, đợt 2 **18/18 PASS**,
đợt 1 **42/42 PASS** (không hồi quy). Không có migration mới (không cần đổi schema).

Lưu ý trung thực: log trước sửa có 12 kiểm tra, log sau sửa có 14 — kiểm tra 3c (huỷ đơn
confirmed 2 dòng cùng SP giá khác nhau) và 3d (huỷ giữ đơn reserved 2 dòng cùng SP giá khác
nhau) được thêm cùng lúc với bản sửa cho nhánh huỷ đơn của `updateOrderStatus` và
`releaseReservation`; hành vi lỗi của chúng trước sửa suy ra từ cùng mẫu "lấy giá dòng đầu"
đã chứng minh FAIL ở 1a/2a/2b/2c-1 (phiếu gộp 2 × 100.000đ = 200.000đ thay vì 300.000đ).

### Gốc rễ — HỒI QUY do đợt 3 gộp phiếu theo sản phẩm (đã xác minh trong code)

Đợt 3 gộp phiếu theo `productId` để mỗi sản phẩm chỉ 1 lần `applyStock` (đúng cho tồn), nhưng
phiếu gộp lấy `unitCost`/`unitPrice` từ DÒNG ĐẦU TIÊN của sản phẩm đó — trước đợt 3 mỗi dòng có
phiếu riêng với đúng đơn giá của nó nên tiền đúng. Ví dụ: phiếu nhập 2 dòng cùng SP, mỗi dòng
1 cái, 100.000đ + 200.000đ → phiếu gộp ghi 2 cái × 100.000đ = **200.000đ** thay vì **300.000đ**.
Tiền phiếu (quantity × unitCost) đi vào dashboard (`getDashboard` dòng ~494-495:
`todayInValue`/`todayOutValue` = Σ quantity × unitCost theo phiếu) nên Tổng quan cũng sai theo.
Các vị trí đã xác minh (đều cùng mẫu `items.find((i) => i.productId === ...)?.unitPrice ?? 0`
hoặc `g.first...unitPrice`):

- `createMovementBatch` (~dòng 1503-1531): phiếu gộp lấy unitCost/reason/partner/note từ dòng
  đầu tiên của SP, số lượng = tổng → 2 × 100.000đ = 200.000đ.
- `createOrder` (~dòng 1122): `unitCost: args.items.find((i) => i.productId === m.prod.id)?.unitPrice ?? 0`.
- `updateOrderStatus` — 3 nhánh trong hàm (~dòng 1257 giữ hàng pending → reserved, ~dòng 1345
  xác nhận pending → confirmed, ~dòng 1418 huỷ đơn/bỏ giữ hoàn kho): cùng mẫu trên, `items` ở
  đây là `orderItems` của đơn (đọc từ `schema.orderItems`), `unitPrice` là giá bán của từng
  dòng trên đơn. Nhánh reserved → confirmed chỉ trừ `reservedQty`, không sinh phiếu nên không
  có lỗi tiền; nhánh confirmed → reserved chỉ cộng `reservedQty`, không sinh phiếu.
- `releaseReservation` (~dòng 1747, ngoài `updateOrderStatus` nhưng cùng mẫu): phiếu hoàn giữ
  hàng lấy giá dòng đầu.
- `createReturn` (~dòng 1589-1625): phiếu nhập trả hàng gộp lấy `unitPrice: g.first.item.unitPrice`.
  Đã kiểm chứng: `refundTotal` và công nợ ở đây tính đúng theo từng dòng (`reduce` theo
  `lineItems`, `qty × item.unitPrice`) nên GIỮ NGUYÊN, chỉ sửa phiếu.
- Cùng mẫu ở nhánh huỷ đơn: khoản chờ hoàn kho (`pendingRestocks`) cho sản phẩm ngưng bán cũng
  ghi 1 lần theo tổng netQty với `unitPrice` của dòng đầu — sửa luôn: tách theo giá (xem dưới),
  vì khi xử lý khoản chờ (`resolvePendingRestock`) phiếu hoàn sẽ mang đơn giá đó.

### Cách sửa — tách phiếu theo GIÁ, giữ nguyên 1 lần applyStock cho mỗi sản phẩm

- Helper mới `chainStock(start, splits, dir)` (gần `insertMovements`): nhận tồn trước thao tác
  và danh sách các phần tách theo giá, trả về before/after NỐI CHUỖI theo đúng thứ tự dòng —
  phiếu đầu before = tồn trước thao tác, phiếu sau before = after của phiếu trước, phiếu cuối
  after = tồn sau lần apply duy nhất (vd tồn 10, nhập 1 × 100k + 1 × 200k → phiếu 1: 10 → 11,
  phiếu 2: 11 → 12; tổng tiền phiếu = 300.000đ đúng).
- `createMovementBatch`: gộp theo bộ đầy đủ (productId, đơn giá hiệu dụng, reason, partner, note)
  — đơn giá hiệu dụng tính TRƯỚC khi gộp (unitCost > 0 thì dùng, không thì fallback
  costPrice/sellPrice như code hiện tại) — nên dòng nào khác lý do/đối tác/ghi chú cũng không bị
  nuốt mất. Tồn vẫn áp 1 lần/SP; `results` vẫn 1 mục cho mỗi sản phẩm, `newStock` = tồn sau cùng.
- `createOrder` / `updateOrderStatus` (giữ hàng, xác nhận, huỷ đơn) / `releaseReservation` /
  `createReturn`: reason/partner đồng nhất theo đơn nên gộp theo (productId, unitPrice) là đủ.
  Nhánh huỷ đơn: phần chưa trả (netQty) tách theo giá — dòng đã trả hết (netQty 0) không sinh
  phiếu; `afterReserved` khi là đơn giữ hàng vẫn dùng TỔNG số lượng giữ của sản phẩm (không đổi);
  khoản chờ hoàn kho tách theo giá, kiểm tra trùng nay gồm cả `unitPrice`.
- KHÔNG lấy đơn giá bình quân gia quyền rồi làm tròn: cột `movements.unit_cost` là INTEGER
  (schema.ts ~dòng 32) nên làm tròn sẽ lệch tiền phiếu. KHÔNG sửa `compensateStock` (guard
  version giữ nguyên) và không đụng logic trừ/hoàn tồn đợt 3.
- Không sửa client: lịch sử/in/CSV hiển thị theo từng phiếu (mỗi phiếu 1 dòng, tiền =
  quantity × unitCost — `App.tsx` dòng ~1661 CSV, ~1681 in phiếu), tách phiếu chỉ làm phiếu
  xuất hiện thành 2 dòng đúng tiền. Đã grep kiểm tra: client không có chỗ nào gộp phiếu theo
  refCode + SP để tính tiền.

### Các nơi tiêu thụ movements — đã xác minh lại (không cần sửa)

- `reconcileStock` (~dòng 1780): tính tồn kỳ vọng từ SỐ LƯỢNG theo type (in +, out −, adjust =
  afterStock) → tách phiếu theo giá không đổi tổng số lượng nên không ảnh hưởng. Chứng minh
  bằng harness 3a: đối chiếu sau phiếu nhập tách giá cho diffs rỗng.
- `deleteMovement` (~dòng 821-876): chỉ cho xoá phiếu GẦN NHẤT của SP và hoàn tồn theo delta
  (afterStock − beforeStock) so với tồn hiện tại; phiếu "Xuất theo đơn hàng" và "Hoàn kho do
  huỷ đơn" gắn đơn thì không cho xoá riêng. Với chuỗi phiếu nối nhau (10 → 11, 11 → 12), xoá
  phiếu cuối rồi xoá phiếu trước vẫn đúng. Chứng minh bằng harness 3b: xoá phiếu cuối → tồn
  11, xoá phiếu trước → tồn 10, 0 phiếu còn lại. (Lưu ý: `deleteMovement` không kiểm tra
  reason "Giữ hàng theo đơn" / "Hủy giữ hàng" — phiếu giữ/huỷ giữ vẫn xoá riêng được như
  trước đợt này; hành vi đó không đổi, xem "Giới hạn còn lại".)
- `getReports`: tiền doanh thu/lợi nhuận tính từ `orderItems` (từng dòng, `soldQty × unitPrice`,
  trừ phần trả), KHÔNG dùng `movements.unitCost` → tách phiếu không ảnh hưởng.
- `getDashboard`: `todayInValue`/`todayOutValue` = Σ quantity × unitCost theo phiếu → tách phiếu
  làm các số này ĐÚNG (trước sửa thiếu 100.000đ trong kịch bản báo). Chứng minh bằng harness
  1b/1b-in: todayOutValue/todayInValue tăng đúng 300.000đ.
- `closeStocktake` và `reconcileStock` (phiếu adjust): `unitCost = costPrice` — 1 giá duy nhất
  cho mỗi sản phẩm nên không có lỗi lấy giá dòng đầu; không sửa. `createMovement` (phiếu 1
  dòng), `createProduct`/`importProductsCsv` (tồn đầu kỳ), `resolvePendingRestock` (1 khoản
  chờ) đều chỉ có 1 dòng/1 giá nên không bị lỗi này.

### Giới hạn còn lại

- Dữ liệu CŨ đã ghi sai tiền trước đợt này không tự sửa: các phiếu gộp cũ vẫn mang đơn giá
  dòng đầu (vd 2 × 100.000đ) — dashboard/báo cáo theo phiếu của ngày cũ vẫn thiếu tiền đó.
  Muốn sửa số liệu cũ phải đối chiếu thủ công từng mã phiếu (so tiền phiếu với đơn gốc) rồi
  sửa trực tiếp DB; không có migration/tool tự sửa vì không phân biệt được phiếu nào gộp
  sai giá với phiếu nào vốn chỉ có 1 giá.
- Hai lần chốt kiểm kê đồng thời vẫn có thể điều chỉnh trùng, và người chen ngang đổi tồn
  giữa lúc áp và lúc bù vẫn làm bù thất bại theo thiết kế (cần đối chiếu thủ công) — như đã
  ghi từ đợt 2/3, đợt này không thay đổi.
- `deleteMovement` vẫn cho xoá riêng phiếu "Giữ hàng theo đơn" / "Hủy giữ hàng" (chỉ chặn
  "Xuất theo đơn hàng" / "Hoàn kho do huỷ đơn"): xoá phiếu giữ hàng làm tồn hoàn theo delta
  nhưng cờ `stockDeducted`/số lượng giữ của đơn không đổi theo — giống hành vi trước đợt này,
  chưa có test riêng; nên tránh xoá tay các phiếu gắn đơn, hãy huỷ đơn/huỷ giữ qua đúng chức
  năng.
- Tách phiếu làm Lịch sử/In/CSV có thêm dòng cho cùng một mã phiếu (2 dòng thay vì 1) khi
  cùng SP khác giá — đúng tiền nhưng người dùng cũ có thể thắc mắc vì sao 1 mã PN/PX hiện
  2 dòng; đã ghi chú trong `README.md` và `TESTING.md` mục 7d.

## Sửa 2 lỗi — đợt 3 (ngày 2026-11-10) — xem `TEST_RESULTS.md` mục H

Harness tái hiện mới: `tests/repro-2-bugs-round3.ts` (`bun tests/repro-2-bugs-round3.ts`, Bun + SQLite
trong bộ nhớ, không sửa `tests/repro-4-bugs.ts` và `tests/repro-5-bugs.ts`). Trước sửa: **0 PASS / 11 FAIL**
(log ở `tests/repro-2-before-fix.log`); sau sửa: **12 PASS / 0 FAIL** (log ở
`tests/repro-2-after-fix.log`). Harness cũ chạy lại: đợt 2 **18/18 PASS**, đợt 1 **42/42 PASS** (không hồi quy).
Không có migration mới (không cần đổi schema).

Lưu ý trung thực: log trước sửa có 11 kiểm tra, log sau sửa có 12 — kiểm tra 2f (huỷ giữ đơn reserved
2 dòng cùng SP) được thêm cùng lúc với bản sửa cho `releaseReservation` (xem dưới) nên không có
trong lần chạy trước sửa; hành vi lỗi của nó trước sửa suy ra từ cùng cơ chế xung đột version
đã chứng minh ở 2d-3/2d-4 (cùng vòng lặp áp tồn theo dòng).

### Lỗi 1 — Trả một phần rồi thanh toán đủ, màn hình Đơn hàng vẫn báo còn nợ
(gốc: server đã đúng từ đợt 2 — `netPayable = totalAmount − refundedTotal`, `paymentStatus` tính
theo `netPayable`, tab Công nợ dùng `d.remaining` từ server — nhưng client tính "Còn phải thu"
theo công thức cũ không trừ tiền hoàn hàng)

- Vị trí duy nhất sửa: `client/src/App.tsx` dòng 1715 (tab Đơn hàng). Đã xác minh shape:
  `orderItemShape` trong `server/src/actions.ts` có `returnedQty` và `unitPrice`,
  `toOrderItem`/`listOrders` trả đủ cả hai trường (giao diện đã hiển thị `(đã trả ${i.returnedQty})`
  và dùng `i.unitPrice` khi in phiếu) — không cần sửa server cho lỗi này.
- Sửa: tính `refunded = o.items.reduce((s, i) => s + (i.returnedQty || 0) * i.unitPrice, 0)` rồi
  `remaining = Math.max(0, o.totalAmount - refunded - o.depositAmount)`. Số này vừa hiển thị
  "Còn phải thu" (dòng ~1744) vừa điền trước khi bấm "Ghi nhận cọc" (dòng ~1757).
- Rà soát toàn bộ `App.tsx` (grep `totalAmount - ` và `remaining`): không còn chỗ nào khác tính
  "còn phải thu"/"còn lại" cho đơn hàng theo tổng gốc. Dòng ~697 là form tạo đơn mới — đơn chưa
  có hàng trả nên giữ nguyên `total − cọc`. Tab Công nợ dùng `d.remaining` từ server — giữ nguyên.

### Lỗi 2 — Đơn có nhiều dòng cùng sản phẩm vẫn hoàn tồn thiếu khi gặp lỗi
(gốc: `compensateStock` dùng guard version là ĐÚNG — không sửa; vấn đề là các vòng lặp trừ kho
duyệt theo từng dòng và gọi `applyStock` riêng cho mỗi dòng: 2 dòng cùng SP ×2 và ×1 trên tồn 10
tạo applied = [A1(before 10, after 8, afterVersion 6), A2(before 8, after 7, afterVersion 7)];
khi bù ngược, A2 khớp v7 → tồn về 8 (v8), A1 cần v6 nhưng hiện tại là v8 → bù thất bại, tồn kẹt ở 8.
Phát hiện thêm khi tái hiện: `createReturn` 2 dòng cùng SP lỗi NGAY CẢ KHI KHÔNG tiêm lỗi —
lần áp thứ 2 xung đột version vì 2 đối tượng sản phẩm đọc riêng đều mang version cũ.)

- Cách sửa chung (áp dụng cho MỌI vòng lặp `applyStock` duyệt theo dòng): **GỘP THEO SẢN PHẨM
  trước khi trừ kho** — mỗi sản phẩm chỉ đúng 1 lần `applyStock` trong một thao tác. Movement
  cũng gộp theo sản phẩm (1 phiếu cho 1 sản phẩm, số lượng = tổng, before = tồn trước thao tác,
  after = tồn sau). `orderItems` vẫn giữ nguyên từng dòng (không gộp dòng trên đơn).
- `createOrder`: vòng lặp trừ kho dùng `qtyByProduct` (đã có sẵn từ bước validate); `unitCost`
  lấy theo sản phẩm (dòng đầu tiên của sản phẩm đó).
- `updateOrderStatus`:
  - confirmed → reserved: cộng `reservedQty` theo dòng → gộp: `reservedQty +=` tổng số lượng của SP.
  - pending → reserved: trừ kho + cộng giữ theo dòng → gộp theo `qtyByProduct` (đã có sẵn ở nhánh này).
  - reserved → confirm/delivering/completed: trừ `reservedQty` theo dòng → gộp: `reservedQty −=`
    tổng số lượng của SP.
  - pending → confirm/delivering/completed: trừ kho theo dòng → gộp theo `qtyByProduct` (đã có sẵn).
    Movements gộp theo sản phẩm.
  - Hủy đơn / bỏ giữ: gộp `netQty` (phần chưa trả) theo sản phẩm; `afterReserved` khi là đơn
    reserved dùng TỔNG số lượng giữ của sản phẩm (sum `quantity`), không dùng netQty. 2 dòng cùng
    SP nhưng 1 dòng đã trả hết (netQty 0) và 1 dòng chưa trả → gộp đúng tổng netQty.
    `pendingRestocks` cho sản phẩm ngưng bán ghi 1 lần theo tổng netQty của sản phẩm (không ghi trùng).
- `createMovementBatch`: gộp theo `productId` (tổng quantity). Movement gộp dùng reason/partner/
  note/unitCost của dòng đầu tiên của sản phẩm đó. `results` trả về theo sản phẩm (đã gộp).
- `createReturn`: gộp theo `productId` (tổng qty). Cập nhật `returnedQty` vẫn theo từng orderItem
  (giữ nguyên code hiện tại, tách khỏi phần áp tồn). Movement gộp theo sản phẩm (unitCost lấy dòng
  đầu). `refundTotal` tính từ `lineItems` — giữ nguyên.
- `closeStocktake`: gộp phòng thủ theo `productId`, cộng dồn `diffQty`. Lưu ý: bảng
  `stocktake_items` KHÔNG có unique constraint trên (stocktakeId, productId), nhưng
  `saveStocktakeItem` upsert theo (stocktakeId, productId) nên thực tế không trùng dòng.
  Kiểm tra "đã có phiếu adjust" và `diffs` hiển thị vẫn theo sản phẩm (metadata của dòng đầu,
  `appliedDiff` = tổng diffQty).
- Thêm ngoài danh sách 5 chỗ trên (cùng mẫu lỗi, phát hiện khi rà soát toàn bộ `applyStock`):
  `releaseReservation` cũng duyệt theo dòng — đã gộp theo sản phẩm (`reservedQty −=` tổng số
  lượng giữ của SP, 1 phiếu hoàn gộp); kiểm tra 2f trong harness mới bao phủ luồng này.
- KHÔNG sửa: `compensateStock` (guard version đúng, giữ nguyên); `createMovement`, `deleteMovement`,
  `reconcileStock`, `resolvePendingRestock` — mỗi lần chỉ 1 sản phẩm, không có vòng lặp theo dòng.
- Hệ quả: sau khi gộp, `recordCompensationFailure` tính `fixQty = beforeStock − afterStock` trở
  thành đúng tuyệt đối cho từng sản phẩm (trước đây sai khi có 2 lần áp cùng sản phẩm — ví dụ
  2e: trước sửa ghi 2 bản sửa chữa fixQty 2 và 1, sau sửa ghi đúng 1 bản fixQty 3) — không cần
  sửa hàm đó.

### File thay đổi (đợt 3)
- `client/src/App.tsx` — công thức `remaining` ở tab Đơn hàng trừ thêm tiền hoàn hàng.
- `server/src/actions.ts` — gộp theo sản phẩm ở `createOrder`, `updateOrderStatus` (5 nhánh),
  `createMovementBatch`, `createReturn`, `closeStocktake`, `releaseReservation`.
- `tests/repro-2-bugs-round3.ts` (mới) + `tests/repro-2-before-fix.log` / `tests/repro-2-after-fix.log` (mới).
- `CHANGES.md`, `TESTING.md` (thêm mục 7d: kiểm tra 2 lỗi đợt 3 trên trình duyệt thật),
  `TEST_RESULTS.md` (thêm mục H + cập nhật mục G), `README.md` (thêm harness đợt 3).
- Không có migration mới. Không đẩy GitHub, không sửa sync record (theo yêu cầu đợt này).

### Giới hạn còn lại (đợt 3 — bổ sung, các giới hạn đợt 2 vẫn còn nguyên)
- **Nếu có người khác thay đổi tồn chen ngang giữa lúc áp và lúc bù thì bù vẫn thất bại đúng
  như thiết kế** (guard version) và vẫn cần đối chiếu thủ công — đó là giới hạn do không có
  transaction thật, không được quảng cáo là đã hết. Harness 2e chứng minh đúng hành vi này:
  đơn lỗi nêu rõ "đối chiếu tồn kho", có đúng 1 bản ghi sửa chữa với fixQty đúng tuyệt đối
  (3 = 10 − 7), tồn giữ nguyên 7 không ghi đè thay đổi của người kia; cần chạy Đối chiếu tồn
  kho sau sự cố (xem `TESTING.md` mục 7c).
- **Chốt kiểm kê đồng thời 2 tab/máy** vẫn có thể điều chỉnh trùng (giới hạn đợt 2, chưa sửa
  trong đợt này); gộp theo sản phẩm chỉ xử lý trùng dòng trong MỘT lần chốt.
- Chưa kiểm thử trên trình duyệt thật: trả một phần → thu đủ → xem màn hình Đơn hàng, và
  tạo đơn 2 dòng cùng SP rồi ngắt mạng lúc xác nhận → tồn phải tự về đúng — xem `TESTING.md`
  mục 7d và `TEST_RESULTS.md` mục G (ghi "Chưa chạy được", không ghi Đạt).

## Sửa 4 nhóm lỗi — đợt 2 (ngày 2026-11-10) — xem `TEST_RESULTS.md` mục E–G

Harness tái hiện mới: `tests/repro-4-bugs.ts` (`bun tests/repro-4-bugs.ts`, Bun + SQLite
trong bộ nhớ, không sửa `tests/repro-5-bugs.ts`). Trước sửa: **4 PASS / 14 FAIL** (log ở
`tests/repro-4-before-fix.log`); sau sửa: **18 PASS / 0 FAIL** (log ở
`tests/repro-4-after-fix.log`). Harness cũ chạy lại: **42/42 PASS** (không hồi quy).
Kiểm chứng phụ thêm 6 mục (`tests/verify-extra-4.ts`, log `tests/verify-extra-4.log`):
migration 0001→0005, khôi phục backup có công nợ trùng, hủy-mở lại sau khi trả một phần,
hủy giữ hàng, hủy đơn 2 lần, đổi PIN.

Lưu ý trung thực: 4 mục trong harness mới đã PASS cả trước khi sửa (1b xung đột version
kiểm kê, 2b thu nợ sau khi trả một phần, 4b xuất cùng lúc, 4c xác nhận cùng lúc trong một
tiến trình) — chúng được giữ làm guard hồi quy; bản sửa bổ sung phòng thủ cho các cửa sổ
lỗi mà harness đơn tiến trình không ép được (xem "Giới hạn còn lại" bên dưới).

### Nền tảng chung — saga bù trừ (áp dụng cho TẤT CẢ chỗ dùng `applyStock`)

Đã kiểm tra mã nguồn SDK: `db.batch()` của `@libsql/client` (client local, file
`lib-esm/sqlite3.js`) chỉ chạy lần lượt từng câu lệnh, câu sau lỗi thì câu trước vẫn
giữ; `drizzle-orm/libsql` chỉ gọi `client.batch()` mà không bọc `BEGIN`/`COMMIT` — tức
**`db.batch()` KHÔNG phải transaction**. Vì vậy đây là saga có bù trừ, KHÔNG phải
transaction nguyên tử thật (xem "Giới hạn còn lại").

- `compensateStock` giờ trả về danh sách các lần áp bù thất bại (kiểm tra từng update
  có khớp hàng không) thay vì im lặng; `rollbackApplied` bù trừ + ghi bản ghi sửa chữa
  nếu bù không được; `recordCompensationFailure` ghi khoản chờ hoàn kho (số lượng = số
  cần cộng vào tồn để về đúng) + audit; `sagaFailed` dọn dẹp (xóa phiếu vừa ghi, hoàn
  tồn) rồi trả lỗi rõ ràng, nêu rõ cần đối chiếu tồn kho khi bù không được.
- `insertMovements` ghi phiếu lần lượt và trả về id từng phiếu để khi bước sau lỗi thì
  xóa đúng các phiếu đó (không đụng phiếu cũ cùng `refCode`); audit trong các bước saga
  chuyển thành best-effort (ghi lỗi cũng không làm hỏng phiếu đã ghi xong).
- Áp dụng cho: `createMovement`, `deleteMovement`, `createOrder` (lỗi ghi thì xóa cả
  đơn/dòng/phiếu vừa tạo), `updateOrderStatus` (mọi nhánh), `createMovementBatch`,
  `createReturn` (ghi tuần tự + hoàn lại cả `returnedQty`/trạng thái đơn/công nợ khi
  lỗi), `releaseReservation`, `reconcileStock`, `resolvePendingRestock`, `closeStocktake`.
  `recordDebtPayment` cũng được bọc: ghi phiếu thu lỗi thì hoàn lại công nợ.
- Thất bại không lưu `requestKey` (chỉ lưu khi thành công) nên bấm lại sau thất bại là an
  toàn; tồn đã hoàn về đúng số trước đó.

### Lỗi 1 — Kiểm kê nhiều mặt hàng lỗi giữa chừng (gốc: `closeStocktake` return lỗi giữa vòng lặp mà không bù các dòng đã áp; `batchAll` không có try/catch; `compensateStock` không kiểm tra)
- Validate TOÀN BỘ dòng trước khi áp bất kỳ dòng nào (sản phẩm tồn tại/còn kinh doanh,
  tồn sau điều chỉnh không âm); vòng lặp áp lại kiểm tra tồn âm với số mới nhất.
- Bọc toàn bộ áp tồn + ghi phiếu + đóng phiếu trong try/catch saga (xem nền tảng chung).
- Chốt lại lũy đẳng: trước khi áp một dòng, kiểm tra đã có phiếu `adjust` với `refCode`
  == mã phiếu kiểm kê cho sản phẩm đó chưa — có thì bỏ qua dòng đó (`appliedDiff: 0`),
  nếu tất cả đã áp thì chỉ đóng phiếu.

### Lỗi 2 — Trả hàng làm sai số tiền đã thu (gốc: `syncOrderPaymentFromDebt` cộng tiền hoàn hàng vào cọc và đặt `paid` chỉ vì công nợ còn 0; `recordDeposit` so với tổng gốc)
- Tách khái niệm: tiền đã thu (`depositAmount`) CHỈ tăng khi thực sự thu tiền
  (`recordDeposit`/`recordDebtPayment`), KHÔNG bao giờ cộng tiền hoàn hàng.
- `netPayable = tổng đơn − tiền đã hoàn hàng` (tính từ `orderItems` vừa đọc lại);
  `paymentStatus` tính thống nhất mọi nơi theo `netPayable`: cọc > 0 và cọc >=
  `netPayable` → `paid`; cọc > 0 → `partial`; ngược lại `unpaid`. (Đơn trả hết hàng mà
  chưa thu đồng nào thì `unpaid`, không phải `paid`.)
- `refreshOrderPaymentStatus` (chỉ tính lại trạng thái) dùng chung cho `createReturn`;
  `addCollectedAndRefresh` (cộng tiền thu thực rồi tính lại) dùng cho `recordDebtPayment`;
  `recordDeposit` chặn cọc vượt `netPayable` (trước đây so với tổng gốc).
- Bất biến giữ sau mọi thao tác: `công nợ còn lại == max(0, netPayable − cọc)` và
  `cọc == tiền thực thu` (harness kiểm tra cả hai sau mỗi thao tác).
- Đã xóa helper cũ `syncOrderPaymentFromDebt`.

### Lỗi 3 — Mở lại đơn đã hủy làm nhân công nợ (gốc: `createReceivableDebtIfNeeded` chỉ kiểm tra `.limit(1)` không `ORDER BY`, không lọc `kind`, và khoản `cancelled` không chặn insert mới)
- Xét TẤT CẢ công nợ phải thu của đơn (mới nhất trước): đã có khoản đang hoạt động
  (`open`/`overdue`) thì không làm gì; chỉ có khoản `cancelled` thì KÍCH HOẠT LẠI khoản
  mới nhất đó (`status` open, `totalAmount` = số còn phải trả theo `netPayable − cọc`,
  `paidAmount` = 0, ghi chú rõ "mở lại đơn"), KHÔNG insert mới; chưa có khoản nào thì
  insert mới. Hai thao tác đua nhau tạo cùng lúc: bên thua bắt lỗi unique rồi kiểm tra lại.
- Migration 0005: unique index có điều kiện `debts_one_active_per_ref` trên
  `(ref_code, kind)` khi `status IN ('open', 'overdue')` — tối đa 1 công nợ đang hoạt
  động cho mỗi đơn. Migration dọn trùng trước (chỉ giữ khoản mới nhất, khoản cũ thành
  `cancelled`, khoản `paid` giữ nguyên để xử lý hoàn tiền thủ công như trước).
  `restoreBackup` cũng dedup công nợ trùng trong bản sao lưu cũ (khoản thừa khôi phục
  dạng `cancelled`) để không phá luồng khôi phục.

### Lỗi 4 — Ghi dữ liệu thất bại vẫn làm mất tồn (gốc: mẫu "áp tồn trước, ghi chứng từ sau bằng `batchAll`" không có try/catch ở mọi action; `compensateStock` không được xác minh)
- Áp dụng mẫu saga nền tảng chung cho tất cả chỗ dùng `applyStock` (xem trên).
- Chống xác nhận/giữ hàng trùng: `updateOrderStatus` claim nguyên tử khi chuyển từ
  chưa trừ kho sang đã trừ (`UPDATE orders SET status=..., stockDeducted=1 WHERE id=...
  AND stockDeducted=0`); bên thua đọc lại — nếu đơn đã đúng trạng thái đích thì coi
  như xong (lũy đẳng), còn không thì báo xung đột để tải lại. Khi claim thành công mà
  bước sau lỗi thì đơn được hoàn về trạng thái/cờ cũ trong catch.
- Nhánh hủy đơn: chỉ hoàn kho khi thực sự có phiếu xuất cho đơn (chống cộng thừa trong
  cửa sổ giữa claim và áp tồn); ghi phiếu chờ hoàn kho tránh trùng khi thử lại.

### File thay đổi (đợt 2)
- `server/src/actions.ts` — helpers saga + tiền/công nợ + sửa mọi action nêu trên.
- `drizzle/0005_debt_unique_active.sql` (mới) + `drizzle/meta/_journal.json` (thêm entry idx 4).
- `tests/repro-4-bugs.ts` (mới) + `tests/repro-4-before-fix.log` / `tests/repro-4-after-fix.log`
  (mới) + `tests/verify-extra-4.ts` (mới) + `tests/verify-extra-4.log` (mới).
- `CHANGES.md`, `TESTING.md` (thêm mục 7: kiểm thử trình duyệt mất mạng + 2 người cùng
  lúc), `TEST_RESULTS.md` (thêm mục E–G), `README.md` (thêm harness đợt 2).
- Không đổi `client/src/App.tsx`: giao diện đã truyền `actorToken` đầy đủ; các sửa đợt
  này đều ở server + migration.

### Giới hạn còn lại (đợt 2)
- **Không có transaction thật.** Saga bù trừ che được lỗi ghi sau khi áp tồn, nhưng vẫn
  còn cửa sổ lỗi: (a) sập tiến trình/mất điện đúng giữa áp tồn và bù trừ — tồn lệch cho
  đến khi chạy Đối chiếu tồn kho; (b) bù trừ thất bại thì tồn lệch và chỉ còn bản ghi
  sửa chữa trong Chờ hoàn kho (harness 4d chứng minh đúng hành vi này); (c) ghi sửa
  chữa lỗi thì cũng không còn dấu vết nào ngoài audit (nếu audit còn ghi được). Cần
  chạy Đối chiếu tồn kho sau mọi sự cố mất mạng (xem `TESTING.md` mục 7c).
- **Chốt kiểm kê đồng thời 2 tab/máy** vẫn có thể điều chỉnh trùng: kiểm tra phiếu
  adjust trước khi áp chỉ an toàn khi chốt lại TUẦN TỰ (đã kiểm chứng 1d/1e); hai lần
  chốt cùng lúc vẫn đua nhau được vì không có khóa hàng. Tương tự, hai lần tạo đơn cùng
  `requestKey` cùng lúc vẫn có thể tạo trùng (kiểm tra idempotency trước khi ghi không
  khóa được nhau) — cần chạy theo `TESTING.md` mục 7b và đối chiếu sau đó.
- **Xác nhận vs hủy cùng đơn cùng lúc** (một máy xác nhận, một máy hủy trong vài ms):
  claim chống được xác nhận trùng, guard chứng từ xuất chống được hoàn kho thừa, nhưng
  thứ tự cuối cùng vẫn tùy bên nào thắng — kiểm tra thủ công theo `TESTING.md` mục 7b.
- **Kích hoạt lại công nợ đã void** ghi đè `paidAmount` về 0: lịch sử "đã thu bao nhiêu
  trước khi hủy" chỉ còn trong `depositAmount` của đơn và bảng `debt_payments`, không
  còn trong chính hàng công nợ đó.
- Chưa kiểm thử trên trình duyệt thật: ngắt mạng giữa lúc bấm Lưu/Xác nhận/Chốt và
  2 máy/2 tab cùng lúc — xem `TESTING.md` mục 7 và `TEST_RESULTS.md` mục G (ghi
  "Chưa chạy được", không ghi Đạt).

## Sửa 5 lỗi (ngày 2026-11-09) — xem `TEST_RESULTS.md` để biết kết quả kiểm thử

Harness tái hiện: `tests/repro-5-bugs.ts` (`bun tests/repro-5-bugs.ts`, Bun + SQLite trong bộ nhớ,
không nhúng vào bundle app). Trước sửa: **21 PASS / 20 FAIL** (cả 5 nhóm đều FAIL, log ở
`tests/repro-before-fix.log`); sau sửa: **42 PASS / 0 FAIL** (log ở `tests/repro-after-fix.log`).
Kiểm chứng phụ thêm 36 mục (`tests/verify-extra.log`): migration 0001→0004, đổi PIN, hủy đơn với
sản phẩm ngưng bán, nhập CSV, ma trận phân quyền đầy đủ, action đọc không token.

### Lỗi 1 — Vượt quyền (gốc: `resolveActor` trả null khi không có token, `requireRole(null, …)` cho qua; nhiều action không kiểm tra quyền)
- Thêm `requireAuth(db, token)`: thiếu/trống token → lỗi `Cần đăng nhập để thực hiện thao tác này.`;
  token sai/hết hạn/tài khoản bị vô hiệu → lỗi `Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.`
- Mọi action trừ `loginStaff` đều gọi `requireAuth` đầu tiên (kể cả action đọc), rồi kiểm tra vai trò
  server-side theo ma trận dưới đây. Client truyền `actorToken` trong mọi lời gọi `api.*`
  (đã vá các chỗ thiếu: `ordersQ`/`suppliersQ`/`categoriesQ`, `deleteSupplier`/`deleteCategory`,
  `createCategory`, `listPriceHistory`, `listDebts`, `listStocktakes`, `listAuditLogs`,
  `listReports`/`getReports`, `getPendingRestocks`, `SupplierForm`).
- Chống dò PIN: thêm cột `failed_attempts`/`locked_until` cho bảng `staff` (migration 0004);
  5 lần sai liên tiếp thì khóa đăng nhập 15 phút (đăng nhập chỉ dùng PIN nên lần sai được đếm
  chung cho mọi tài khoản đang hoạt động; đăng nhập đúng reset bộ đếm). Hết hạn khóa thì đếm lại từ đầu.
- `ensureAdminSeed` giữ nguyên (chỉ tạo admin mặc định khi bảng staff trống); tạo nhân viên sau đó
  vẫn phải qua admin đã đăng nhập. Đã bỏ hết ghi chú "tương thích cũ" cho phép không đăng nhập.
- `changePin` giữ nguyên dùng `token` (bản thân token là chứng thực) và vẫn yêu cầu phiên hợp lệ.

#### Ma trận phân quyền (duy nhất, áp dụng server-side)
| Nhóm | Action |
|---|---|
| Chỉ admin | `createStaff`, `setStaffActive`, `listStaff`, `deleteProduct`, đổi giá (`updateProduct` khi đổi giá), `reconcileStock` khi `apply=true`, `restoreBackup`, `exportBackup`, `deleteCategory` |
| Admin + thủ kho | `createProduct`, `updateProduct` (không đổi giá), `createMovement`, `createMovementBatch`, `deleteMovement`, kiểm kê (`createStocktake`/`saveStocktakeItem`/`closeStocktake`), `importProductsCsv`, `createSupplier`/`updateSupplier`/`deleteSupplier`, `createCategory`, `createBackupSnapshot`, `resolvePendingRestock` |
| Admin + thủ kho + sales | `createOrder`, `updateOrderStatus`, `createReturn`, `recordDeposit`, `recordDebtPayment`, `releaseReservation` |
| Mọi tài khoản đã đăng nhập (chỉ đọc) | `getDashboard`, `listProducts`, `listMovements`, `listOrders`, `listSuppliers`, `listCategories`, `listDebts`, `listAuditLogs`, `listBackups`, `listStocktakes`, `listPriceHistory`, `getPendingRestocks`, `getReports`, `reconcileStock` khi `apply=false` |
| Không cần đăng nhập | Chỉ `loginStaff` |

Sales tuyệt đối không được: phiếu nhập/xuất trực tiếp, xóa phiếu, xóa sản phẩm, đổi giá,
quản lý nhân viên, khôi phục backup, đối chiếu tồn (apply). `changePin` cần phiên đăng nhập hợp lệ.

### Lỗi 2 — Kiểm kê làm mất hàng trên sổ (gốc: `closeStocktake` áp số đếm tuyệt đối, bỏ qua nhập/xuất giữa lúc đếm và lúc chốt)
- Khi chốt, mỗi dòng `diff != 0` áp delta lúc đếm (`diffQty = đếm − sổ lúc đếm`) vào tồn hiện tại lúc chốt:
  `after = currentStock + diffQty`, phiếu điều chỉnh ghi `quantity = |diffQty|`,
  `beforeStock = tồn lúc chốt`, `afterStock = after`. VD: sổ lúc đếm 4, đếm 9 (diff +5),
  nhập thêm 5 (tồn 9) → chốt ghi tồn **14** (trước sửa: 9).
- Diffs trả về tính lại theo tồn hiện tại lúc chốt (`systemQty` = tồn lúc chốt,
  `diff` = đếm − tồn lúc chốt), kèm thêm `systemQtyAtCount`, `systemQtyAtClose`, `appliedDiff`;
  ghi chú phiếu + audit log ghi đủ 3 số (đếm, sổ lúc đếm, sổ lúc chốt). Bỏ qua dòng `diff = 0`.
  Giao diện tab Kiểm kê hiển thị cả 3 số + số điều chỉnh đã áp.
- Giữ nguyên lỗi khi sản phẩm đã xóa/ngưng kinh doanh; thêm chặn khi tồn sau điều chỉnh sẽ âm.

### Lỗi 3 — Trả hàng rồi hủy đơn cộng thừa; trả lần 2 sau trả một phần bị chặn
- Gốc A: nhánh hủy cộng lại toàn bộ `it.quantity`, bỏ qua `it.returnedQty`.
  Sửa: khi hủy, mỗi dòng chỉ hoàn lại net = `quantity − returnedQty` (cả tồn kho và
  `pendingRestocks` đều dùng số net; net = 0 thì không sinh phiếu cho dòng đó).
  VD: tồn 10 → bán 2 (còn 8) → trả 1 (còn 9) → hủy đơn: tồn **10** (trước sửa: 11).
- Gốc B: `createReturn` chỉ cho `["confirmed","delivering","completed"]` nên đơn
  `partially_returned` không trả tiếp được. Sửa: cho phép thêm `"partially_returned"`.
  Vẫn chặn trả khi đơn đã `"cancelled"` hoặc `"returned"`.

### Lỗi 4 — Công nợ sai trạng thái
- Gốc A: hủy đơn không đụng tới bảng `debts`. Sửa: khi hủy đơn (cả `updateOrderStatus` →
  `cancelled` và `releaseReservation`), void công nợ phải thu gắn với đơn (`refCode` = orderCode):
  `remaining` về 0, trạng thái `"cancelled"`, ghi chú thêm `Đã hủy đơn — công nợ đã xóa`,
  ghi audit (`void_debt_on_cancel`). Đã thu một phần trước khi hủy: giữ `paidAmount` làm lịch sử,
  đặt `totalAmount = paidAmount`. Công nợ đã thu đủ (`paid`) giữ nguyên để xử lý hoàn tiền thủ công.
  `debts.status` trong `0003` là cột TEXT thường (không có CHECK constraint enum) nên không cần
  rebuild bảng — migration 0004 chỉ ghi chú việc này, enum mở rộng ở `schema.ts`.
  `createReceivableDebtIfNeeded` bỏ qua công nợ đã `"cancelled"` để đơn hủy rồi xác nhận lại
  vẫn sinh công nợ mới. `isOverdueDebt` không tính công nợ đã hủy là quá hạn; tab Công nợ
  hiển thị nhãn `Đã hủy` và ẩn nút ghi thanh toán cho công nợ đã hủy.
- Gốc B: `recordDebtPayment` chỉ cập nhật bảng `debts`, không đồng bộ đơn hàng.
  Sửa: thêm helper chung `syncOrderPaymentFromDebt(db, orderCode, amountJustCollected, debtRemainingAfter)`:
  sau mỗi `recordDebtPayment` (chỉ với công nợ phải thu gắn đơn) và sau `createReturn` khi
  công nợ về 0: `depositAmount += số tiền vừa thu` (không vượt `totalAmount`);
  `paymentStatus = paid` khi công nợ còn 0, `partial` khi đã cọc > 0, `unpaid` khi chưa cọc.
  `recordDeposit` giữ nguyên luồng đồng bộ sẵn có.

### Lỗi 5 — Hooks sau nhánh return ở màn hình đăng nhập (gốc: `App()` gọi `useQuery`/`useMemo`/`useMutation` sau 2 lần early return)
- Chuyển toàn bộ hook của `App()` lên trước cả 2 lần early return (`!staff` → `LoginScreen`,
  `needPinChange` → `ChangePinScreen`); 7 `useQuery` dữ liệu thêm `enabled: !!staff && !needPinChange`.
  2 lần return có điều kiện giữ nguyên sau tất cả hook.
- Rà soát toàn bộ component trong `App.tsx`: các component khác (`ProductForm`, `MovementForm`,
  `OrderForm`, `LoginScreen`, `ChangePinScreen`, `AdminTab`, …) đều gọi hook trước mọi return —
  không còn chỗ nào vi phạm (kể cả `PendingRestockBox`: `return null` nằm sau mọi hook).

### File đổi / thêm trong đợt sửa 5 lỗi
- `server/src/actions.ts` — `requireAuth` + ma trận phân quyền cho 44 action, `closeStocktake` theo delta,
  hủy đơn theo net, `createReturn` cho `partially_returned`, `voidReceivableDebtForOrder`,
  `syncOrderPaymentFromDebt`, chống dò PIN ở `loginStaff`.
- `server/src/schema.ts` — `staff.failedAttempts`/`lockedUntil`, `debts.status` thêm `"cancelled"`.
- `drizzle/0004_auth_and_debt_status.sql` (mới) + `drizzle/meta/_journal.json` (thêm entry idx 3).
- `client/src/App.tsx` — hook `App()` lên trước early return + `enabled`, `actorToken` cho mọi lời gọi
  `api.*`, nhãn `Đã hủy` cho công nợ, hiển thị chi tiết chênh lệch kiểm kê lúc chốt.
- `tests/repro-5-bugs.ts` (mới), `tests/repro-before-fix.log`, `tests/repro-after-fix.log`,
  `tests/verify-extra.log` — harness + log kiểm chứng.
- `README.md`, `TESTING.md`, `TEST_RESULTS.md` (mới) — cập nhật quy tắc đăng nhập/kiểm kê/công nợ.

### Những gì chưa kiểm thử được trong đợt này
- Chưa chạy end-to-end trên trình duyệt thật / Muse runtime (đăng nhập, tab, in phiếu, mất mạng thật,
  2 máy cùng lúc, đếm hàng thật tại cửa hàng). Xem `TEST_RESULTS.md` — các mục này ghi
  `Chưa chạy được`, không ghi `Đạt`.
- Chống dò PIN khóa chung mọi tài khoản sau 5 lần sai (do đăng nhập chỉ dùng PIN, không có tên
  đăng nhập để phân biệt ai đang dò). Với cửa hàng gia đình thì chấp nhận được; nếu cần khóa
  theo từng người thì phải thêm tên đăng nhập vào luồng đăng nhập.

## Bản nâng cấp 2026-11-09 (5 bước — nội dung gốc, xem thêm mục sửa 5 lỗi ở trên)

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
5. **Hủy đơn không tự đóng/xóa debt phải thu** của đơn đó (yêu cầu không nói rõ) — công nợ còn lại phải xử lý thủ công qua tab Công nợ hoặc trả hàng. *(Đã thay đổi ngày 2026-11-09 — xem mục "Sửa 5 lỗi", lỗi 4: hủy đơn nay void công nợ phải thu của đơn.)*
6. **Không có action tạo công nợ phải trả cho nhà cung cấp** (yêu cầu không yêu cầu) — debt loại `payable` hiện chỉ xuất hiện qua khôi phục backup.
7. **Đổi giá khi không có token:** server vẫn cho phép (tương thích client cũ chưa đăng nhập), nhưng app luôn bắt đăng nhập nên tài khoản non-admin bị chặn cả ở client lẫn server. `createProduct` không chặn giá theo vai trò (giá ban đầu khi tạo mới). *(Đã thay đổi ngày 2026-11-09 — xem mục "Sửa 5 lỗi", lỗi 1: mọi action đều yêu cầu đăng nhập, đổi giá chỉ admin.)*
8. **`closeStocktake` chốt tồn về `countedQty` theo tồn hiện tại**, vì `systemQty` lưu lúc đếm có thể đã cũ nếu có người nhập/xuất xen vào. *(Đã thay đổi ngày 2026-11-09 — xem mục "Sửa 5 lỗi", lỗi 2: chốt theo delta, không ghi đè số đếm tuyệt đối.)*
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
- **Xác thực PIN chỉ ở mức cửa hàng nhỏ.** PIN 4–8 số + SHA-256/salt, token lưu `sessionStorage`, không có 2FA, không mã hóa dữ liệu. Từ 2026-11-09 có chống dò PIN đơn giản: 5 lần sai liên tiếp khóa đăng nhập 15 phút (khóa chung mọi tài khoản, xem mục "Sửa 5 lỗi", lỗi 1). Đủ cho cửa hàng gia đình, không đủ cho hệ thống nhiều chi nhánh.
- **Không có phân quyền ở mức từng kho/chi nhánh** và không có log chống sửa/xóa nhật ký audit (admin xem được toàn bộ).
- **Giá vốn dùng giá nhập hiện tại** tại thời điểm bán (không tính FIFO theo từng lô nhập); báo cáo lãi gộp vì vậy là ước tính theo giá vốn hiện hành, không phải lãi theo từng lô hàng cụ thể.
- **Đồng thời thật sự (race) vẫn dựa vào version-check**, không có khóa hàng (row lock) vì SQLite + SDK không hỗ trợ; hai người xuất cùng 1 mặt hàng đến giới hạn tồn: người sau sẽ nhận lỗi version/tồn và phải tải lại — đúng theo thiết kế, nhưng cần thử theo `TESTING.md` mục 4.
