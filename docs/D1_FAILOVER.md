# D1 tạm thời khi Turso hết quota

Nguồn phục hồi được chủ hệ thống chấp nhận: bản sao production lúc **17:32 ngày 29/10/2026, UTC+7**. Thay đổi sau mốc này có thể chưa có trong bản sao; giữ nguyên Turso để đối soát khi khôi phục. Đợt phục hồi ban đầu dùng bản production sau khi xóa GVNX, schema 3; không dùng dữ liệu thử. Ngày 30/10 đã phát hành Danh sách sinh viên/schema 4 và hiệu chỉnh STT như ghi ở cuối tài liệu.

## Đích và chuyển traffic

- Express tiếp tục chạy trên Render `internship-api`; frontend tại `https://fit-uet.github.io/` và Google OAuth giữ nguyên origin.
- Database mới: `internship-turso-failover-20261029`, APAC, ID `bd58a106-1b64-473a-8211-896e84f6072e`.
- Database D1 cũ `866e23b7-3b49-43e4-ab90-59dceb4c4f76` không bị ghi đè; Cloudflare Worker cũ không được dùng làm API học vụ.
- Render dùng `DB_PROVIDER=d1`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID` mới và `CLOUDFLARE_API_TOKEN`. Giữ credentials Turso cho quy trình quay lại; không fallback tự động giữa hai nguồn.
- Chỉ cập nhật riêng các biến kết nối trên Render, giữ JWT, OAuth, email và R2. Deploy đúng commit đã kiểm tra; `/api/ready` phải xác nhận `databaseProvider=d1`, schema tương ứng (lúc phục hồi là 3, hiện tại là **4**) và SHA bản ứng dụng đã phát hành.

R2 không di chuyển hoặc đổi khóa tệp. Bản sao trước hiệu chỉnh STT có 644 báo cáo, 675 bản ghi điểm, 701 phân công Thực tập và 1.226 lần học, gồm 535 Dự án; 98 giảng viên và 1.157 tài khoản. Dự án có 532 sinh viên duy nhất trong tám lớp, GVNX hiện tại bằng 0. Giữ 208 hồ sơ Thực tập chưa ánh xạ.

## Nhập và kiểm chứng

`database:failover-d1` chỉ đọc SQLite nguồn, mặc định preview; `--apply` chỉ chấp nhận database D1 trống. Công cụ từ chối ID D1 cũ và không có lệnh ghi đè/xóa nguồn. Nếu nhập dở, không đưa database đó vào vận hành; tạo đích trống khác hoặc đối soát riêng trước khi tiếp tục.

```sh
npm run database:failover-d1 -- --source=file:/absolute/path/verified-backup.db --env-file=/private/deployment.env --target=NEW-D1-ID --report=/private/plan.json
npm run database:failover-d1 -- --source=file:/absolute/path/verified-backup.db --env-file=/private/deployment.env --target=NEW-D1-ID --report=/private/import.json --apply
```

Đợt phục hồi này nhập **33 bảng, 16.385 dòng**. Công cụ tạo bảng trước, nạp theo thứ tự khóa ngoại, giữ ID/bộ đếm AUTOINCREMENT, rồi tạo index/view/trigger sau cùng để lịch sử command không chạy lại. Dòng audit dài được truyền qua tham số để không vượt giới hạn chiều dài SQL. Đối soát SHA-256 từng hàng theo khóa chính, số dòng, khóa ngoại, bộ đếm và SHA file nguồn trước/sau; báo cáo và dữ liệu chỉ lưu riêng, không commit.

Truy vấn học vụ dùng các nhóm CTE materialized tối đa bốn nhánh UNION mỗi nhóm, vẫn giữ một SELECT/snapshot. Tìm kiếm Unicode dài dùng các đoạn GLOB nhỏ và kiểm vị trí liền nhau để giữ nghĩa tìm kiếm tên/đề tài, tránh giới hạn pattern của D1. Không đổi công thức điểm, quyền, thời hạn hay hợp đồng API.

Nghiệm thu gồm khởi động thực tế trên D1, Tổng quan/danh sách hai nhóm, SQL phân trang/export, phân quyền GV/SV, hai hồ sơ DACN/DAKH, tìm tên tiếng Việt, PDF R2 và command stale bị rollback. Các kiểm tra không gửi email hoặc tạo điểm/bài nộp giả trong dữ liệu vận hành.

## Quay lại Turso

Không chỉ đổi `DB_PROVIDER` về Turso sau khi tài khoản được mở lại: D1 đã nhận các thay đổi mới. Thực hiện một đợt cutover riêng:

1. Tạm dừng ghi, sao lưu D1 và lấy snapshot mới của Turso; giữ cả bản mốc 17:32 và manifest R2.
2. Đối soát theo ID/khóa nghiệp vụ, phân biệt dữ liệu có trước và thay đổi sau mốc; giải quyết xung đột trên cả hai nguồn, giữ các thay đổi phát sinh ở D1. Không phục hồi đè một bản cũ hoặc tự khôi phục lần học đã xóa.
3. Diễn tập dữ liệu đã hợp nhất trên bản sao, đối chiếu tài khoản/lần học/phân công/điểm/bài/tin nhắn/thông báo và sequence.
4. Cập nhật cả `render.yaml` và Environment Render về Turso đã đối soát, deploy, kiểm tra readiness/ba vai trò/PDF; chỉ mở ghi ở một nguồn. Giữ D1 và các backup để đối soát, không tự xóa sau cutover.

Sao lưu D1 dùng cấu hình quản trị riêng, không deploy Worker:

```sh
npx wrangler d1 export internship-turso-failover-20261029 --remote --config wrangler.failover.toml --output=/private/d1-before-return.sql
```

Đã phát hành Render/Pages ở commit `d049e9e`, readiness trả `databaseProvider=d1`. Báo cáo chi tiết nằm trong thư mục vận hành riêng, không chứa trong repo công khai. Bổ sung chỉ mục không unique theo `lower(users.email)` và `lower(trim(lecturers.email))` bằng `scripts/maintenance/d1-failover-indexes.sql` để các API xác thực dùng đúng index thay vì quét danh mục người dùng.

## Hiệu chỉnh danh sách theo STT sau khôi phục

Bản phục hồi 17:32 chứa số lịch sử 535 hồ sơ Dự án. Khoa đã xác nhận chỉ lấy dòng có STT: **408 hồ sơ / 405 sinh viên**, gồm 215 DACN và 193 DAKH. Trước hiệu chỉnh cần xuất D1 đầy đủ, thử phục hồi backup và chạy xem trước. Công cụ `scripts/correct-project-roster.ts` chỉ loại hồ sơ ngoài roster khi hoàn toàn chưa có đề tài/phân công/bài/điểm/chat riêng; gặp dữ liệu phát sinh phải dừng. Giữ tài khoản, mọi lần học được chọn và toàn bộ nguồn Thực tập. Lệnh ghi dùng command/CAS, kiểm lại revision, scope, dữ liệu bảo vệ và audit trong cùng statement. Không truy cập/xóa tệp R2; import thông thường không tự xóa người vắng danh sách.

Khi quay lại Turso phải mang theo hiệu chỉnh này; không nhập lại 127 hồ sơ ngoài STT từ bản cũ. Báo cáo preview, backup và đối soát ở thư mục vận hành riêng, không commit dữ liệu sinh viên.


## Đã áp dụng ngày 30/10/2026

Bản ứng dụng `68d9548` đã chạy trên Render và GitHub Pages, readiness xác nhận D1/schema 4. Backup mới trước phát hành có 1.226 lần học; phục hồi thử đạt integrity và không có lỗi khóa ngoại. Sau migration bỏ status riêng Dự án và command hiệu chỉnh STT có CAS, đã loại **127 hồ sơ trống**, còn **408 Dự án / 405 SV**, tổng **1.099 lần học**. DACN có 215 hồ sơ, phân bổ 44/51/60/60; DAKH có 193, phân bổ 50/58/47/38.

Đối soát xác nhận chỉ metadata status/revision Dự án thay đổi theo thiết kế; các hồ sơ còn lại, 691 hồ sơ TT, 1.157 tài khoản, 98 GV, 701 phân công legacy, 675 điểm, 644 báo cáo và lịch sử cũ được giữ. Không ghi/xóa R2; đọc PDF legacy đạt. Có đúng hai command mới cho migration membership và hiệu chỉnh roster. Các báo cáo/backup chứa dữ liệu thật được giữ riêng, không commit vào repository công khai.

Kiểm tra production đạt: bảng gộp Khoa/GV trên desktop/mobile không còn Tư cách/Thao tác/Mở hồ sơ; export đúng cả tám lớp và đủ các trang; hai hồ sơ DACN/DAKH độc lập, SV không nhận điểm; GV không được đọc hồ sơ ngoài phân công, SV bị loại không còn quyền Dự án. JSON trả 200 lần đầu, 304 khi nội dung chưa đổi. Không gửi email nghiệm thu trong đợt này.
