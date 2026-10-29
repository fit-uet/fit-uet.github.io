# Triển khai bản quản lý học kỳ và nhóm môn

Nguồn vận hành hiện tại: React trên GitHub Pages, Express trên Render, **Turso** cho database, Cloudflare R2 cho báo cáo và tệp trao đổi. D1 trong `wrangler.toml` là một nguồn khác; không dùng bản sao D1 để khôi phục Turso. Worker không chứa API học vụ mới và vẫn để tắt quy trình deploy.

## Sao lưu và diễn tập

Lưu cấu hình xuất từ Render trong file local `internship-api.env`; file này được gitignore. Không đưa file cấu hình, database, bản sao R2 hoặc Excel sinh viên vào repository công khai.

```bash
npm ci
npm run production:backup -- --env-file=internship-api.env --output=.staging/release/turso-before.db
npm run academic:stage -- --source=file:.staging/release/turso-before.db --output=.staging/release/rehearsal
```

`production:backup` chỉ đọc nguồn Turso trong một read transaction, tạo file SQLite mới với quyền `0600`, giữ bảng, index, view, trigger, dữ liệu nhị phân và bộ đếm ID. File đã tồn tại sẽ bị từ chối ghi đè. Báo cáo có kiểm tra toàn vẹn, số dòng, dấu vân tay và lỗi khóa ngoại; không in credentials. Kiểm tra khả năng mở lại bản sao trước khi chuyển dữ liệu. Diễn tập không sửa file backup hoặc gọi R2/email.

Sao lưu R2 vào thư mục riêng kèm manifest: key gốc, dung lượng, ETag, tên file local và SHA-256. Đối chiếu toàn bộ `object_key`/`attachment_key` trong database với manifest; không đổi key hoặc di chuyển tệp khi chuyển học vụ.

Khởi động bản mới chỉ bổ sung schema học vụ. Việc khởi động không làm tròn lại điểm đã lưu. Migration nghiệp vụ giữ nguồn Thực tập cũ, chỉ ánh xạ hồ sơ có MSSV/email/mã học phần rõ ràng vào Hè 2025–2026; phần chưa rõ được xuất thành danh sách đối soát, không đoán học phần.

Khi tiếp nhận Dự án, dùng workbook đã được Khoa đối soát và danh mục mới. Nếu chuyển từ bản nghiệm thu local, phải ánh xạ giảng viên theo email/tên chuẩn thay vì sao chép ID số; giữ ID lớp, lần học, phân công và phiên bản. Chỉ chuyển tài khoản sinh viên cần thiết, không chép tài khoản đăng nhập giả, file hoặc điểm kiểm thử. Giữ nguyên ID và mọi dữ liệu nghiệp vụ đã có trên production. Đối chiếu bộ lọc đủ tám lớp, hai hồ sơ của sinh viên học DACN/DAKH, 408 GVNX và 127 hồ sơ còn thiếu GVHD. Chuyển phân công không tự tạo hoặc gửi thông báo hàng loạt.

## Phát hành

```bash
npm run lint
npm run test:academic
npm run test:staging
npm run test:academic:ui
npm run test:academic:d1
npm run build
```

Push commit đã kiểm tra lên `main` sẽ kích hoạt Render và workflow GitHub Pages. Workflow dùng Node 24 và lockfile, kiểm tra type/nghiệp vụ, build giao diện, rồi chờ backend xác nhận **đúng SHA commit** mới publish Pages. Nếu backend chưa sẵn sàng, workflow thất bại và giao diện đang chạy được giữ lại. Khi Render đã phục hồi, chạy lại workflow trên cùng commit.

Render Blueprint khai báo `/api/ready` làm health check. Với service đã tạo thủ công, kiểm tra mục Health Check Path trong Dashboard vì sửa Blueprint không đồng nghĩa đã cập nhật service đó. Cơ chế [deploy của Render](https://render.com/docs/deploys) và [health check](https://render.com/docs/health-checks) được mô tả trong tài liệu chính thức.

```bash
npm run production:check -- --api=https://internship-api-dplz.onrender.com --release=<sha-commit-day-du>
```

Lệnh chỉ gửi GET: `/api/health`, `/api/ready`, `/api/me/campaigns`. Yêu cầu JSON, environment `production`, schema 2, SHA đúng và HTTP 401 cho danh sách chưa xác thực. Trang HTML trả 200 từ SPA cũ không được coi là API đã sẵn sàng. Có thể dùng `--attempts=60 --interval-ms=10000` để chờ Render.

## Sau phát hành và khôi phục

Kiểm tra giao diện Pages tải được asset, Google client ID thống nhất với backend, người dùng truy cập đúng nhóm/lớp và sinh viên không nhận điểm qua API. Kiểm tra tải một PDF cũ bằng tài khoản có quyền, từ chối tài khoản khác; xác nhận bài Dự án chỉ nộp trong hạn đã chốt. Đăng nhập Google thật cần tài khoản của người nghiệm thu; kiểm tra JWT nội bộ không thay cho bước này. Chỉ thử email thật khi đã có người nhận thử cụ thể.

Nếu deploy thất bại trước khi phát hành Pages, giữ phiên bản giao diện hiện tại và xem log Render. Rollback code về commit trước không tự rollback database. Schema học vụ được bổ sung và nguồn TT cũ còn nguyên; không xóa bảng học vụ hoặc phục hồi đè backup sau khi đã có dữ liệu mới. Khi phải phục hồi database/file, dừng ghi, sao lưu trạng thái sau lỗi, đối soát delta/audit và kiểm tra khôi phục trên bản sao trước.
