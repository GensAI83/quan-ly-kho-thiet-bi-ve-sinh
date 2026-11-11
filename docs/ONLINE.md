# Dùng kho online trên điện thoại và máy tính

Mục tiêu: mở cùng một địa chỉ HTTPS bằng Safari/Chrome, dùng qua 4G/5G hoặc Wi-Fi, kể cả khi máy tính ở cửa hàng đã tắt.

## Tình trạng

Mã nguồn có bản chạy trên máy chủ và cấu hình triển khai. Chưa có máy chủ/tài khoản hosting hoặc địa chỉ kho online được tạo. Không có khoản phí nào được đăng ký trong bước chuẩn bị.

## Nơi triển khai

Gói này chạy một server Bun với một ổ SQLite lưu lâu dài. Có thể dùng Render, Railway hoặc VPS hỗ trợ Docker. Không đặt database trên ổ tạm hoặc chạy nhiều bản server cùng lúc.

Phương án đã cấu hình trong `render.yaml`: vùng Singapore, gói `0.5c-512mb`, một server và một ổ 1 GB. Đây là tài nguyên trả phí; xác nhận giá đang hiển thị trên Render trước khi tạo. Bản miễn phí không đáp ứng cách lưu SQLite lâu dài này. Nguồn: [persistent disks](https://render.com/docs/disks), [Blueprint](https://render.com/docs/blueprint-spec), [giá](https://render.com/pricing).

1. Tạo tài khoản Render bằng GitHub. Đưa nhánh `codex/cloud-online` đã kiểm tra lên repo trước khi kết nối Blueprint; bản chuẩn bị trên D chưa tự đẩy lên GitHub.
2. Tạo Blueprint từ đúng nhánh. Kiểm tra chỉ một server và một ổ dữ liệu, không thêm PostgreSQL.
3. Đặt `KHO_ACCESS_PASSWORD` là mật khẩu truy cập từ xa riêng, tối thiểu 16 ký tự. Không dùng PIN nhân viên hoặc ghi mật khẩu vào repo/chat. `KHO_SESSION_SECRET` được Render sinh tự động.
4. Render cung cấp HTTPS và `RENDER_EXTERNAL_URL`; ứng dụng chỉ chấp nhận địa chỉ đó. Nếu đổi sang tên miền riêng, đặt `KHO_PUBLIC_URL=https://ten-mien-cua-ban` rồi triển khai lại.
5. Chờ `/health` trả `{ "app": "quan-ly-kho-online", "ok": true }`. Mở URL sẽ thấy trang mật khẩu truy cập từ xa.

## Chuyển dữ liệu hiện có trên D

Chuyển trước lần đăng nhập PIN đầu tiên trên server; app không ghi đè kho online đã có dữ liệu.

1. Hoàn tất công việc nhập/xuất đang làm. Chạy `D:\QuanLyKho\ChuyenDuLieuOnline.cmd` trên máy tính.
2. Nhập URL HTTPS thật và mật khẩu truy cập từ xa trong cửa sổ của công cụ. Mật khẩu được che, gửi qua stdin, không ghi ra file hay dòng lệnh.
3. Công cụ tắt bản offline an toàn, tạo ảnh SQLite nhất quán (gồm cả dữ liệu WAL), rồi chuyển qua HTTPS vào server mới. Database gốc trên D được giữ nguyên. Tài khoản/PIN được giữ; các phiên đăng nhập cũ không chuyển theo.
4. Chờ báo thành công. Đăng nhập kho online bằng mật khẩu truy cập từ xa và PIN nhân viên hiện tại. Kiểm tra số sản phẩm, tồn, đơn hàng và công nợ trước khi nhập/xuất tiếp.
5. Tắt Wi-Fi trên điện thoại, dùng 4G/5G mở URL; kiểm tra lại khi máy tính đã tắt.

Từ lúc chuyển thành công, dùng **kho online làm dữ liệu chính trên mọi thiết bị**. Bản chạy offline trên D là bản riêng; không tự đồng bộ hai chiều. Tránh tiếp tục nhập/xuất vào cả hai bản.

## Sao lưu và khôi phục

- Server chụp toàn bộ SQLite khi khởi động, mỗi giờ và khi dừng an toàn, dưới `backups` trên ổ đã gắn. Không cần mở trình duyệt hoặc để máy tính cửa hàng bật. Giữ tối đa 48 bản tự động, theo ngân sách lớn hơn giữa 128 MB và 3 lần kích thước DB; giữ ít nhất hai bản mới nhất và dự phòng chỗ trống trước khi tạo bản tiếp theo. Bản giữ thủ công và bản trước nhập dữ liệu không bị dọn tự động.
- Trong app, quản trị viên vẫn có `Nhân viên → Sao lưu & khôi phục → Sao lưu ngay / Xuất JSON`. Trên điện thoại, JSON tải về thiết bị đó; trên máy tính tải theo cài đặt trình duyệt.
- Các bản `.sqlite` có cả dữ liệu tài khoản/PIN đã băm: giữ kín. File JSON trong app không có PIN.
- Bản sao trên cùng máy chủ chưa phải sao lưu ở nơi khác. Tải JSON thường xuyên và giữ một bản ngoài server (ổ ngoài hoặc kho cloud riêng). Chưa cấu hình tự sao chép sang dịch vụ khác; dung lượng bản sao cần được theo dõi.
- Khôi phục snapshot trong app sẽ đưa dữ liệu về thời điểm chọn. Khôi phục file `.sqlite` cần dừng server, giữ lại bản hiện tại, thay file trên ổ lâu dài và chỉ mở lại sau khi kiểm tra. Không thay file DB khi server đang chạy.

## Nếu dùng VPS khác

Build image từ `Dockerfile`; gắn thư mục bền vững vào `/var/lib/quan-ly-kho`. Đặt `KHO_DATA_DIR`, `KHO_PUBLIC_URL`, `KHO_ACCESS_PASSWORD`, `KHO_SESSION_SECRET` (tối thiểu 32 ký tự) và `PORT`. Đặt reverse proxy HTTPS trước cổng app; chỉ công khai cổng HTTPS. Khi cập nhật, giữ nguyên ổ dữ liệu và các secret để phiên đăng nhập không bị mất.

Build tại D: `D:\QuanLyKho\tools\bun.exe run build:cloud`. Kết quả ở `D:\QuanLyKho\source\dist\cloud`; không chứa dữ liệu kho hay mật khẩu. File cấu hình Docker không được coi là đã chạy thành công nếu chưa có Docker/host thực tế.
