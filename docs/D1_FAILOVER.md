# D1 tạm thời khi Turso hết quota

Nguồn phục hồi được chủ hệ thống chấp nhận: bản sao production lúc **17:32 ngày 29/10/2026, UTC+7**. Thay đổi sau mốc này có thể chưa có trong bản sao; giữ nguyên Turso để đối soát khi khôi phục. Dùng bản production sau khi xóa GVNX, không dùng bản dữ liệu thử hoặc bản đã chuyển metadata của nhánh Danh sách sinh viên chưa phát hành.

## Đích và chuyển traffic

- Express tiếp tục chạy trên Render `internship-api`; frontend tại `https://fit-uet.github.io/` và Google OAuth giữ nguyên origin.
- Database mới: `internship-turso-failover-20261029`, APAC, ID `bd58a106-1b64-473a-8211-896e84f6072e`.
- Database D1 cũ `866e23b7-3b49-43e4-ab90-59dceb4c4f76` không bị ghi đè; Cloudflare Worker cũ không được dùng làm API học vụ.
- Render dùng `DB_PROVIDER=d1`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID` mới và `CLOUDFLARE_API_TOKEN`. Giữ credentials Turso cho quy trình quay lại; không fallback tự động giữa hai nguồn.
- Chỉ cập nhật riêng các biến kết nối trên Render, giữ JWT, OAuth, email và R2. Deploy đúng commit đã kiểm tra; `/api/ready` phải xác nhận `databaseProvider=d1`, schema 3 và SHA tương ứng.

R2 không di chuyển hoặc đổi khóa tệp. Bản sao có 644 báo cáo, 675 bản ghi điểm, 701 phân công Thực tập và 1.226 lần học, gồm 535 Dự án; 98 giảng viên và 1.157 tài khoản. Dự án có 532 sinh viên duy nhất trong tám lớp, GVNX hiện tại bằng 0. Giữ 208 hồ sơ Thực tập chưa ánh xạ.

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
